// server.js
const express = require("express");
const cors = require("cors");
const Fuse = require("fuse.js"); 
const path = require("path"); // <--- ADD THIS IMPORT
const { Pool } = require("pg");
require("dotenv").config();

const { getAiSql, getAiSummary, extractEntities } = require("./ai");

const app = express();
const PORT = process.env.PORT || 3001; 
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

app.use(express.static(path.join(__dirname, "public")));

// 2. Explicitly serve index.html for the root route "/"
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 3. Explicitly serve instructions.html (just to be safe)
app.get("/instructions", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "instructions.html"));
});

// ==========================================
// 1. MULTI-ENTITY CACHING
// ==========================================
const caches = {
  instructors: null,
  domains: null,
  classes: null,
  topics: null
};

async function initAllCaches() {
  try {
    console.log("[Init] Loading dimension caches...");

    // Instructors
    const resInstr = await pool.query("SELECT first_name, last_name, full_name FROM dim_instructor");
    caches.instructors = new Fuse(resInstr.rows, {
      includeScore: true,
      threshold: 0.4,
      keys: [
        { name: "first_name", weight: 2.0 }, // First Name Match Priority
        { name: "last_name", weight: 2.0 },
        { name: "full_name", weight: 1.0 }
      ]
    });

    // Domains
    const resDomain = await pool.query("SELECT domain_name FROM dim_domain");
    caches.domains = new Fuse(resDomain.rows, { includeScore: true, threshold: 0.4, keys: ["domain_name"] });

    // Classes
    const resClass = await pool.query("SELECT class_name FROM dim_class");
    caches.classes = new Fuse(resClass.rows, { includeScore: true, threshold: 0.4, keys: ["class_name"] });

    // Topics
    const resTopic = await pool.query("SELECT topic_code FROM dim_topic");
    caches.topics = new Fuse(resTopic.rows, { includeScore: true, threshold: 0.4, keys: ["topic_code"] });

    console.log(`[Init] Ready. Loaded ${resInstr.rows.length} Instructors.`);
  } catch (e) {
    console.error("[Init] Error:", e);
  }
}

// ==========================================
// 2. AMBIGUITY-AWARE RESOLVER
// ==========================================
function resolveTerm(term) {
  let allMatches = [];

  // 1. Gather matches from ALL categories
  const collect = (fuse, type, field) => {
    if (!fuse) return;
    const results = fuse.search(term);
    // Keep raw results to sort later
    results.forEach(r => {
      allMatches.push({
        category: type,
        value: r.item[field],
        score: r.score
      });
    });
  };

  collect(caches.instructors, "instructor", "full_name");
  collect(caches.domains, "domain", "domain_name");
  collect(caches.classes, "class", "class_name");
  collect(caches.topics, "topic", "topic_code");

  // 2. Filter garbage (Score > 0.4)
  allMatches = allMatches.filter(m => m.score < 0.4);

  // 3. Sort by relevance (lower score is better)
  allMatches.sort((a, b) => a.score - b.score);

  if (allMatches.length === 0) return [];

  // 4. AMBIGUITY HANDLING
  // We don't just pick the first one. We pick all matches that are "close enough" to the best one.
  // Example: Robert Smith (0.10) vs Robert Jones (0.11) -> Both are valid.
  // Example: Robert Smith (0.10) vs Robert's Class (0.35) -> Drop the class.
  
  const bestScore = allMatches[0].score;
  // We accept matches within a 0.05 margin of the best score
  const threshold = bestScore + 0.05; 
  
  const topCandidates = allMatches.filter(m => m.score <= threshold);

  // Limit to top 5 to prevent prompt overflow
  return topCandidates.slice(0, 5); 
}

// ==========================================
// 3. MAIN API
// ==========================================
app.post("/api/query", async (req, res) => {
  const { query: userQuery } = req.body;
  if (!userQuery) return res.status(400).json({ error: "Query required" });

  try {
    // Step 1: Extract "Robert", "Data Science", etc.
    const entities = await extractEntities(userQuery);
    
    let contextMessages = [];

    // Step 2: Resolve each term
    for (const term of entities) {
      const candidates = resolveTerm(term);
      
      if (candidates.length === 1) {
        // Precise Match
        const match = candidates[0];
        console.log(`[Match] "${term}" -> ${match.value} (${match.category})`);
        
        if (match.category === 'instructor') 
          contextMessages.push(`User means Instructor '${match.value}'. Filter by di.full_name = '${match.value}'`);
        else if (match.category === 'domain') 
          contextMessages.push(`User means Domain '${match.value}'. Filter by dd.domain_name = '${match.value}'`);
        else if (match.category === 'class') 
          contextMessages.push(`User means Class '${match.value}'. Filter by dc.class_name = '${match.value}'`);
        else if (match.category === 'topic') 
          contextMessages.push(`User means Topic '${match.value}'. Filter by dt.topic_code = '${match.value}'`);

      } else if (candidates.length > 1) {
        // Ambiguous Match (e.g., 3 Roberts)
        console.log(`[Ambiguity] "${term}" matched ${candidates.length} items.`);
        
        const names = candidates.map(c => `'${c.value}'`).join(", ");
        // We instruct the AI that it could be ANY of these people
        contextMessages.push(
          `The term '${term}' is ambiguous and matches multiple entities: ${names}. ` +
          `Filter by checking if the name/title is IN (${names}) OR matches the partial term.`
        );
      }
    }

    // Step 3: Build Augmented Query
    const contextString = contextMessages.length > 0 
      ? "\n\n(SYSTEM CONTEXT:\n" + contextMessages.join("\n") + "\n)" 
      : "";
    
    const finalPrompt = userQuery + contextString;
    console.log("------------------------------------------------");
    console.log(contextString);
    console.log("------------------------------------------------");

    // Step 4: Generate SQL
    const sqlQuery = await getAiSql(finalPrompt);
    
    // Step 5: Execute & Summarize
    const client = await pool.connect();
    const { rows } = await client.query(sqlQuery);
    client.release();

    const summary = await getAiSummary(userQuery, sqlQuery, rows);

    res.json({ data: rows, summary, sql: sqlQuery });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/instructors", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT full_name FROM dim_instructor ORDER BY full_name ASC");
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/domains", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT domain_name FROM dim_domain ORDER BY domain_name ASC");
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/classes", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT class_name FROM dim_class ORDER BY class_name ASC");
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/topics", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT topic_code FROM dim_topic ORDER BY topic_code ASC");
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  await initAllCaches();
});