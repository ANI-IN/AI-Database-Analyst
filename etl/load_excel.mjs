#!/usr/bin/env node
/**
 * Excel → Neon Postgres loader for IK sessions (PST calendar)
 * - Removed "Type" column processing.
 * - Standardizes 'domain' to lowercase.
 *
 * Usage:
 * DATABASE_URL=postgres://... node load_excel.mjs --file=../data/sessions.xlsx
 */

import "dotenv/config";
import fs from "fs";
import xlsx from "xlsx";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { Client } from "pg";

dayjs.extend(utc);

const TZ = "America/Los_Angeles";

// Maps database fields to Excel column headers
const COLS = {
  topic: ["Topic Code", "Topic code", "Topic", "Type Code"],
  // type: ["Type", "Session Type"], <-- REMOVED
  domain: ["Domain"],
  class: ["Class", "Live Class"], // Added "Live Class" to catch Column D
  instructor: ["Instructor", "Instructor Name"],
  sessionDate: ["Session Date", "Date"],
  average: ["Average", "Overall Average", "Overall Avg", "Avg", "Rating"],
  responses: ["No of Student Responses", "No of", "Responses", "# Responses"],
  attended: [
    "No of Students Attended",
    "Attended",
    "# Attended",
    "No of Students",
  ],
  ratedPct: ["% Rated", "Rated %", "% rated", "Percent Rated"],
};

const t = (v) => (v ?? "").toString().trim();
const normKey = (k) => k.toString().replace(/\s+/g, " ").trim().toLowerCase();

function pick(row, keys) {
  const map = {};
  for (const k of Object.keys(row)) map[normKey(k)] = k;
  for (const want of keys) {
    const real = map[normKey(want)];
    if (real && row[real] !== "" && row[real] != null) return row[real];
  }
  return null;
}
function num(v) {
  if (v === "" || v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = t(v).replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function pct(v) {
  if (v === "" || v == null) return null;
  if (typeof v === "number") return v <= 1 ? v * 100 : v; // Excel 0.25 -> 25
  const s = t(v);
  const n = num(s.endsWith("%") ? s.slice(0, -1) : s);
  if (n == null) return null;
  return n <= 1 ? n * 100 : n;
}
function excelSerialToDate(n) {
  const o = xlsx.SSF.parse_date_code(n);
  if (!o) return null;
  return new Date(Date.UTC(o.y, o.m - 1, o.d));
}
function normalizePstDate(raw) {
  if (raw == null) return null;
  if (raw instanceof Date) {
    return dayjs.utc(raw).format("YYYY-MM-DD");
  }
  if (typeof raw === "number") {
    const d = excelSerialToDate(raw);
    return d ? dayjs.utc(d).format("YYYY-MM-DD") : null;
  }
  const s = t(raw);
  if (!s) return null;
  const formats = [
    "MMMM D, YYYY",
    "MMM D, YYYY",
    "YYYY-MM-DD",
    "D/M/YYYY",
    "DD/MM/YYYY",
    "M/D/YYYY",
    "MM/DD/YYYY",
  ];
  for (const f of formats) {
    const d = dayjs(s, f, true);
    if (d.isValid()) return d.format("YYYY-MM-DD");
  }
  const d2 = dayjs(new Date(s));
  return d2.isValid() ? d2.format("YYYY-MM-DD") : null;
}
const qOf = (m) => Math.floor((m - 1) / 3) + 1;

async function upsertDim(db, table, col, val) {
  const { rows } = await db.query(
    `INSERT INTO ${table}(${col}) VALUES ($1)
      ON CONFLICT (${col}) DO UPDATE SET ${col}=EXCLUDED.${col}
      RETURNING *`,
    [val]
  );
  return rows[0];
}

async function main() {
  const fileArg = process.argv.find((a) => a.startsWith("--file="));
  const file = fileArg ? fileArg.split("=")[1] : "data/sessions.xlsx";
  const sheetArg = process.argv.find((a) => a.startsWith("--sheet="));
  const sheet = sheetArg ? sheetArg.split("=")[1] : null;

  if (!fs.existsSync(file)) {
    console.error(`❌ file not found: ${file}`);
    process.exit(1);
  }
  const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL;
  if (!NEON_DATABASE_URL) {
    console.error("❌ set DATABASE_URL in .env");
    process.exit(1);
  }

  const db = new Client({ connectionString: NEON_DATABASE_URL });
  await db.connect();

  const wb = xlsx.readFile(file, { cellDates: false });
  const sheetName = sheet || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    console.error(`❌ sheet "${sheetName}" not found`);
    process.exit(1);
  }

  const rows = xlsx.utils.sheet_to_json(ws, { defval: "", raw: true });

  let inserted = 0,
    updated = 0,
    skipped = 0,
    badDate = 0;

  for (const r of rows) {
    const topic = t(pick(r, COLS.topic)); // Column A
    
    // 1. Standardize Domain to lowercase
    const domain = t(pick(r, COLS.domain)).toLowerCase();
    
    // Type processing REMOVED
    
    const clazz = t(pick(r, COLS.class)); 
    const instr = t(pick(r, COLS.instructor));

    const dateRaw = pick(r, COLS.sessionDate);
    const average = num(pick(r, COLS.average));
    let responses = num(pick(r, COLS.responses));
    const attended = num(pick(r, COLS.attended));

    let rated = pct(pick(r, COLS.ratedPct));
    if (rated == null && responses != null && attended != null && attended > 0)
      rated = (responses / attended) * 100;

    if (
      (responses == null || Number.isNaN(responses)) &&
      attended != null &&
      rated != null
    ) {
      responses = Math.round(attended * (rated / 100)); 
    }

    // required check (Removed !type)
    if (!domain || !clazz || !instr) {
      skipped++;
      continue;
    }

    const pstDate = normalizePstDate(dateRaw);
    if (!pstDate) {
      badDate++;
      skipped++;
      continue;
    }

    // upsert dims (dim_type removed)
    const di = await upsertDim(db, "dim_instructor", "instructor_name", instr);
    const dc = await upsertDim(db, "dim_class", "class_name", clazz);
    const dd = await upsertDim(db, "dim_domain", "domain_name", domain);

    // calendar fields
    const [y, m, d] = pstDate.split("-").map(Number);
    const q = qOf(m);
    const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;

    // insert/upsert fact
    // Removed type_id from columns and values
    const sql = `
      INSERT INTO fact_session
        (topic_code, domain_id, class_id, instructor_id,
         session_ts_utc, pst_date, pst_year, pst_month, pst_quarter, pst_month_start,
         average, responses, students_attended, rated_pct)
      VALUES
        ($1,$2,$3,$4,
         make_timestamptz($5,$6,$7, 9,0,0, '${TZ}'),
         $8,$9,$10,$11,$12,
         $13,$14,$15,$16)
      ON CONFLICT (topic_code, domain_id, class_id, instructor_id, pst_date)
      DO UPDATE SET
          average = EXCLUDED.average,
          responses    = EXCLUDED.responses,
          students_attended = EXCLUDED.students_attended,
          rated_pct    = EXCLUDED.rated_pct
      RETURNING xmax = 0 AS inserted_flag`;
    const params = [
      topic || null,
      dd.domain_id,
      dc.class_id,
      di.instructor_id,
      y, m, d, // Time
      pstDate, y, m, q, monthStart, // Date
      average, responses, attended, rated, // Metrics
    ];
    
    const { rows: res } = await db.query(sql, params);
    if (res?.[0]?.inserted_flag) inserted++;
    else updated++;
  }

  console.log(`✅ ETL complete from sheet "${sheetName}"`);
  console.log(`   inserted: ${inserted}`);
  console.log(`   updated : ${updated}`);
  console.log(`   skipped : ${skipped} (missing required fields)`);
  console.log(`   badDate : ${badDate} (couldn't parse Session Date)`);

  await db.end();
}

main().catch((e) => {
  console.error("❌ ETL failed:", e.message);
  process.exit(1);
});