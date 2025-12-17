// etl/load_excel.mjs
import "dotenv/config";
import fs from "fs";
import xlsx from "xlsx";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { Client } from "pg";

dayjs.extend(utc);

const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL;

// Exact Column Names from your Image
const COLS = {
  topic: "Topic Code",            // Col A
  domain: "Domain",               // Col B
  class: "Class",                 // Col C
  classRegion: "Class Region",    // Col D
  firstName: "First Name",        // Col E
  lastName: "Last Name",          // Col F
  instrRegion: "Instructor Region",// Col G
  date: "Session Date",           // Col H
  average: "Average",             // Col I
  responses: "responses",         // Col J
  attended: "No of Students Attended", // Col K
  ratedPct: "% Rated"             // Col L
};

async function main() {
  // --- RESTORED ARGUMENT PARSING HERE ---
  const fileArg = process.argv.find((a) => a.startsWith("--file="));
  const file = fileArg ? fileArg.split("=")[1] : "data/sessions.xlsx"; 
  // --------------------------------------

  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);

  const db = new Client({ connectionString: NEON_DATABASE_URL });
  await db.connect();
  
  const wb = xlsx.readFile(file, { cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws);

  console.log(`Processing ${rows.length} rows from ${file}...`);

  for (const row of rows) {
    // 1. Extract Values
    const topicVal = (row[COLS.topic] || "").trim();
    const domainVal = (row[COLS.domain] || "").trim();
    const classVal = (row[COLS.class] || "").trim();
    const classRegionVal = (row[COLS.classRegion] || "").trim();
    const firstNameVal = (row[COLS.firstName] || "").trim();
    const lastNameVal = (row[COLS.lastName] || "").trim();
    const instrRegionVal = (row[COLS.instrRegion] || "").trim();
    const dateRaw = row[COLS.date];

    // Skip invalid rows
    if (!firstNameVal || !dateRaw) continue;

    // 2. Normalize Date (Force YYYY-MM-DD)
    let dateStr;
    if (typeof dateRaw === 'number') {
      const dateObj = xlsx.SSF.parse_date_code(dateRaw);
      dateStr = `${dateObj.y}-${String(dateObj.m).padStart(2, '0')}-${String(dateObj.d).padStart(2, '0')}`;
    } else {
       dateStr = dayjs(dateRaw).format("YYYY-MM-DD");
    }

    // 3. Insert Dimensions

    // Domain
    const domainRes = await db.query(`
      INSERT INTO dim_domain (domain_name) VALUES ($1)
      ON CONFLICT (domain_name) DO UPDATE SET domain_name = EXCLUDED.domain_name
      RETURNING domain_id`, [domainVal]
    );

    // Topic
    const topicRes = await db.query(`
      INSERT INTO dim_topic (topic_code) VALUES ($1)
      ON CONFLICT (topic_code) DO UPDATE SET topic_code = EXCLUDED.topic_code
      RETURNING topic_id`, [topicVal]
    );

    // Instructor (Using Split Names)
    const instrRes = await db.query(`
      INSERT INTO dim_instructor (first_name, last_name, region) 
      VALUES ($1, $2, $3)
      ON CONFLICT (first_name, last_name, region) DO UPDATE SET region = EXCLUDED.region
      RETURNING instructor_id`, 
      [firstNameVal, lastNameVal, instrRegionVal]
    );

    // Class (With Region)
    const classRes = await db.query(`
      INSERT INTO dim_class (class_name, region) VALUES ($1, $2)
      ON CONFLICT (class_name, region) DO UPDATE SET region = EXCLUDED.region
      RETURNING class_id`, 
      [classVal, classRegionVal]
    );

    // 4. Insert Fact
    // Handle Percentage (0.5 vs 50)
    let ratedPct = parseFloat(row[COLS.ratedPct] || 0);
    if (ratedPct <= 1 && ratedPct > 0) ratedPct = ratedPct * 100;

    await db.query(`
      INSERT INTO fact_sessions 
      (instructor_id, class_id, domain_id, topic_id, pst_date, average_rating, responses, attended, rated_pct)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (instructor_id, class_id, pst_date, topic_id) DO UPDATE SET
        average_rating = EXCLUDED.average_rating,
        responses = EXCLUDED.responses,
        attended = EXCLUDED.attended,
        rated_pct = EXCLUDED.rated_pct`,
      [
        instrRes.rows[0].instructor_id,
        classRes.rows[0].class_id,
        domainRes.rows[0].domain_id,
        topicRes.rows[0].topic_id,
        dateStr, // Normalized Date
        row[COLS.average] || 0,
        row[COLS.responses] || 0,
        row[COLS.attended] || 0,
        ratedPct
      ]
    );
  }
  
  console.log("✅ ETL Complete.");
  await db.end();
}

main().catch(console.error);