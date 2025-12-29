// ai.js
//const Groq = require("groq-sdk");
const OpenAI = require("openai");
require("dotenv").config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Model Configuration
// Use "gpt-4o" for best performance or "gpt-4o-mini" for lower cost
const MODEL_NAME = "gpt-4o"; // Upgraded to 70b for complex SQL logic
 

const getExtractionPrompt = () => `
You are a Named Entity Recognition (NER) system.
Your goal is to extract **Key Search Terms** from the user's query.
Look for:
- Person Names (Instructors)
- Technical Topics (Domains like "Backend", "Data Science")
- Class Titles (e.g. "DSA", "API Design")
- Session Types (e.g. Career Skills Class', 'Career Skills Review', 'Coding Class', 'Coding Test Review', 
    -- 'Floater Session', 'India Career Skills Class', 'India Career Skills Review', 
    -- 'India Coding Class', 'India Coding Test Review', 'India System Design Class', 
    -- 'India System Design Test Review', 'Live Class', 'Switchup Career Skills Class', 
    -- 'Switchup Career Skills Review Class', 'System Design Class', 
    -- 'System Design Test Review', 'Test Review Session', 'Training Session')

Rules:
1. Return a JSON object with a single key "entities" containing an array of strings.
2. If nothing found, return {"entities": []}.
3. Cleanup: Remove "about", "how", "stats for". Keep the core term.

Examples:
- "How did Udit perform in Data Science?" -> {"entities": ["Udit", "Data Science"]}
- "Stats for Live Classes" -> {"entities": ["Live Classes"]}
`;

async function extractEntities(userQuery) {
  try {
    const completion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: getExtractionPrompt() },
        { role: "user", content: `Query: "${userQuery}"` },
      ],
      model: MODEL_NAME,
      temperature: 0,
      response_format: { type: "json_object" } // Enforce JSON
    });
    
    const content = completion.choices[0]?.message?.content;
    const parsed = JSON.parse(content);
    return parsed.entities || [];
  } catch (error) {
    console.error("[AI] Extraction error:", error);
    return [];
  }
}

const getSystemPrompt = () => `
You are an expert SQL Analyst for an EdTech platform. Your goal is to generate accurate, robust PostgreSQL queries based on natural language questions.

### **1. DATABASE SCHEMA (Star Schema)**

**Fact Table: fact_sessions (alias: fs)**
- \`session_id\` (UUID)
- \`pst_date\` (DATE): The session date in PST (e.g., '2024-01-15').
- \`average_rating\` (NUMERIC): Session rating (1.0-5.0).
- \`responses\` (INT): Number of ratings received.
- \`attended\` (INT): Number of students present.
- \`rated_pct\` (NUMERIC): % of attendees who rated.
- Foreign Keys: \`instructor_id\`, \`class_id\`, \`domain_id\`, \`topic_id\`

**Dimension Tables:**
- **dim_instructor (alias: di):** \`instructor_id\`, \`full_name\`, \`first_name\`, \`last_name\`, \`region\`
- **dim_class (alias: dc):** \`class_id\`, \`class_name\`, \`region\`
- **dim_domain (alias: dd):** \`domain_id\`, \`domain_name\`
- **dim_topic (alias: dt):** \`topic_id\`, \`topic_code\` (e.g., 'Live Class', 'Test Review')

### **2. CRITICAL RULES**

1.  **Join Logic:** Always JOIN \`fact_sessions\` with relevant dimensions to filter by name or region.
    - \`JOIN dim_instructor di ON fs.instructor_id = di.instructor_id\`
    - \`JOIN dim_class dc ON fs.class_id = dc.class_id\`
    - \`JOIN dim_domain dd ON fs.domain_id = dd.domain_id\`
    - \`JOIN dim_topic dt ON fs.topic_id = dt.topic_id\`

2.  **Date Filtering:** - Use the **PST** column \`fs.pst_date\`.
    - Extract Year/Month dynamically: \`EXTRACT(YEAR FROM fs.pst_date) = 2024\`.
    - **NEVER** use \`session_ts_utc\` or timezone conversions.
    - Example: "Jan 2024" -> \`WHERE fs.pst_date >= '2024-01-01' AND fs.pst_date <= '2024-01-31'\`

3.  **Robust Partial Matching (The "ILIKE" Rule):**
    - Users rarely provide exact names. **NEVER** use \`=\` for text comparisons unless specifically instructed by Context.
    - **Instructors:** \`WHERE di.full_name ILIKE '%Parivesh%'\`
    - **Classes:** \`WHERE dc.class_name ILIKE '%System Design%'\`
    - **Domains:** \`WHERE dd.domain_name ILIKE '%Data Science%'\`
    - **Topics:** \`WHERE dt.topic_code ILIKE '%Live Class%'\`

4.  **Metric Calculation (Decimal Precision):**
    - **ALL numeric outputs must be rounded to 2 decimal places.**
    - **Simple Average:** \`ROUND(AVG(fs.average_rating), 2)\`
    - **Weighted Average:** \`ROUND((SUM(fs.average_rating * fs.responses) / NULLIF(SUM(fs.responses), 0))::numeric, 2)\`
    - **Response Rate:** \`ROUND(AVG(fs.rated_pct), 2)\`

5.  **Grouping Safety:**
    - If you select a non-aggregated column (e.g., \`di.full_name\`), you **MUST** include it in the \`GROUP BY\` clause.

6.  **"Full Details" Rule:**
    - If user asks for "details", "list", or "show me" sessions:
    - **DO NOT** use \`SELECT *\`.
    - **ALWAYS** select human-readable columns:
      \`SELECT fs.pst_date, dc.class_name, di.full_name, dd.domain_name, dt.topic_code, fs.average_rating, fs.students_attended\`

7.  **No IDs:** - Never include \`instructor_id\`, \`class_id\`, etc. in the final output unless explicitly asked.

### **3. MENTAL MODELS & EXAMPLES**

**User:** "How many students attended System Design classes in Jan 2024?"
\`\`\`sql
SELECT SUM(fs.attended)
FROM fact_sessions fs
JOIN dim_class dc ON fs.class_id = dc.class_id
WHERE dc.class_name ILIKE '%System Design%'
  AND fs.pst_date >= '2024-01-01' AND fs.pst_date <= '2024-01-31';
\`\`\`

**User:** "Who is the highest rated instructor?"
\`\`\`sql
SELECT di.full_name, ROUND(AVG(fs.average_rating), 2) as avg_rating
FROM fact_sessions fs
JOIN dim_instructor di ON fs.instructor_id = di.instructor_id
GROUP BY di.full_name
ORDER BY avg_rating DESC
LIMIT 1;
\`\`\`

**User:** "Trend for Backend domain"
\`\`\`sql
WITH monthly_data AS (
  SELECT
    EXTRACT(YEAR FROM fs.pst_date) as year,
    EXTRACT(MONTH FROM fs.pst_date) as month,
    ROUND(AVG(fs.average_rating), 2) AS avg_rating
  FROM fact_sessions fs
  JOIN dim_domain dd ON fs.domain_id = dd.domain_id
  WHERE dd.domain_name ILIKE '%Backend%'
  GROUP BY 1, 2
)
SELECT
  year, month, avg_rating,
  LAG(avg_rating) OVER (ORDER BY year, month) AS prev_month,
  ROUND(avg_rating - LAG(avg_rating) OVER (ORDER BY year, month), 2) AS change
FROM monthly_data
ORDER BY year, month;
\`\`\`

**User:** "Highest Rated Instructor (Weighted) in Data Science"
\`\`\`sql
SELECT
  di.full_name,
  ROUND((SUM(fs.average_rating * fs.responses) / NULLIF(SUM(fs.responses), 0))::numeric, 2) AS weighted_avg
FROM fact_sessions fs
JOIN dim_instructor di ON fs.instructor_id = di.instructor_id
JOIN dim_domain dd ON fs.domain_id = dd.domain_id
WHERE dd.domain_name ILIKE '%Data Science%'
GROUP BY di.full_name
ORDER BY weighted_avg DESC
LIMIT 1;
\`\`\`

**User:** "Compare Jan vs Feb 2024 performance"
\`\`\`sql
WITH comparison AS (
  SELECT
    dc.class_name,
    ROUND(AVG(CASE WHEN EXTRACT(MONTH FROM fs.pst_date) = 1 THEN fs.average_rating END), 2) AS jan_avg,
    ROUND(AVG(CASE WHEN EXTRACT(MONTH FROM fs.pst_date) = 2 THEN fs.average_rating END), 2) AS feb_avg
  FROM fact_sessions fs
  JOIN dim_class dc ON fs.class_id = dc.class_id
  WHERE fs.pst_date >= '2024-01-01' AND fs.pst_date <= '2024-02-29'
  GROUP BY dc.class_name
)
SELECT class_name, jan_avg, feb_avg, ROUND(feb_avg - jan_avg, 2) AS improvement
FROM comparison
WHERE jan_avg IS NOT NULL AND feb_avg IS NOT NULL
ORDER BY improvement DESC;
\`\`\`

**OUTPUT:** Return ONLY the SQL query. No markdown, no explanations.
`;

async function getAiSql(prompt) {
  const completion = await openai.chat.completions.create({
    messages: [
      { role: "system", content: getSystemPrompt() },
      { role: "user", content: prompt },
    ],
    model: MODEL_NAME,
    temperature: 0,
  });
  return completion.choices[0]?.message?.content?.replace(/```sql|```/g, "").trim();
}

// =========================================================
// 3. SUMMARY GENERATION (The "Senior Analyst")
// =========================================================
async function getAiSummary(userQuery, sql, data) {
    if (!data || data.length === 0) return "No results found in the database matching your criteria.";

    // SMART SLICING:
    // We want to pass as much data as possible without hitting token limits.
    // Llama 3 70b handles ~8k tokens. 50-60 rows of JSON is usually safe (~2-3k tokens).
    // If data is huge, we truncate but warn the AI.
    let datasetContext = JSON.stringify(data);
    if (data.length > 50) {
        datasetContext = JSON.stringify(data.slice(0, 50));
        datasetContext += `\n...(Dataset truncated. Total rows returned: ${data.length}. Analyze the visible top 50 rows.)`;
    }

    try {
        const completion = await openai.chat.completions.create({
          messages: [
            { 
              role: "system", 
              content: `You are a Senior Data Analyst.
              
              Your Goal: Provide a high-quality, executive summary of the provided dataset in response to the User's Question.

              Guidelines:
              1. **Direct Answer:** Start with the specific answer to the question (e.g., "The highest rated instructor is X with a rating of Y").
              2. **Key Metrics:** Explicitly mention averages, totals, or counts found in the data.
              3. **Trend Analysis:** If the data is time-series, mention the direction (improving, declining).
              4. **Comparisons:** If multiple items are listed, highlight the top performer and the gap to the bottom.
              5. **Conciseness:** Keep it under 4 sentences. Be professional. Do not say "Based on the data".
              ` 
            },
            { 
              role: "user", 
              content: `User Question: "${userQuery}"\n\nSQL Context: ${sql}\n\nDataset:\n${datasetContext}` 
            },
          ],
          model: MODEL_NAME, // Upgraded to 70b for smarter analysis
          temperature: 0.2, // Low temp for factual accuracy
        });

        return completion.choices[0]?.message?.content;
    } catch (error) {
        console.error("[AI] Summary generation failed:", error);
        return "Query executed successfully. Please check the data table for details.";
    }
}

module.exports = { getAiSql, getAiSummary, extractEntities };