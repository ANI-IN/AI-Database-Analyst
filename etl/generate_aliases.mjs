#!/usr/bin/env node
/**
 * Alias Generator: Reads canonical names from dim tables and generates
 * partial-name aliases (first word, last word, lowercase, initials)
 * into the dim_value_alias table for robust fuzzy matching.
 *
 * NOTE: All aliases are inserted in LOWERCASE for case-insensitive lookups.
 *
 * Usage:
 * NEON_DATABASE_URL=postgres://... node etl/generate_aliases.mjs
 */

import "dotenv/config";
import { Client } from "pg";

const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL;

if (!NEON_DATABASE_URL) {
  console.error("❌ set NEON_DATABASE_URL in .env");
  process.exit(1);
}

/**
 * Generates common partial aliases from a full canonical name.
 * @param {string} canonicalName - The full, correct name (e.g., 'Konstantinos Pappas').
 * @returns {Array<string>} An array of generated aliases, guaranteed to be lowercase.
 */
function generatePartialAliases(canonicalName) {
  const aliases = new Set();
  // Split by spaces and filter out empty strings
  const parts = canonicalName.split(/\s+/).filter(p => p.length > 0);

  // 1. All-Lowercase version (Essential for case-insensitivity)
  const lowercaseName = canonicalName.toLowerCase();
  aliases.add(lowercaseName);

  if (parts.length > 1) {
    // 2. First Name/Word (e.g., 'konstantinos')
    aliases.add(parts[0].toLowerCase());
    
    // 3. Last Name/Word (e.g., 'pappas')
    aliases.add(parts[parts.length - 1].toLowerCase());

    // 4. Initials (e.g., 'kp') - simple version
    const initials = parts.map(p => p[0]).join('').toLowerCase();
    if (initials.length >= 2) aliases.add(initials);
  }
  
  // 5. If it's a single word domain and not the canonical name itself, add it.
  if (parts.length === 1 && lowercaseName !== canonicalName.toLowerCase()) {
      aliases.add(lowercaseName);
  }

  // Filter out any aliases identical to the lowercase canonical name itself, as they are redundant
  const canonicalLowercase = canonicalName.toLowerCase();
  return Array.from(aliases)
    .filter(a => a !== canonicalLowercase && a.length > 0);
}

/**
 * Fetches canonical names and inserts generated aliases into dim_value_alias.
 * @param {Client} db - The PostgreSQL client.
 * @param {string} entity - 'instructor' or 'domain'.
 * @param {string} dimTable - Name of the dimension table ('dim_instructor' or 'dim_domain').
 * @param {string} nameCol - Name of the canonical name column ('instructor_name' or 'domain_name').
 */
async function fetchAndGenerateAliases(db, entity, dimTable, nameCol) {
  console.log(`\n-- Generating aliases for ${entity} from ${dimTable} --`);
  
  // 1. Fetch all canonical names
  const { rows } = await db.query(`SELECT ${nameCol} AS name FROM ${dimTable}`);
  
  let insertedCount = 0;
  
  for (const row of rows) {
    const canonicalName = row.name.trim();
    if (!canonicalName) continue;

    const generatedAliases = generatePartialAliases(canonicalName);
    
    for (const alias of generatedAliases) {
        // The alias is already lowercase due to the generatePartialAliases function
        try {
            await db.query(
              `INSERT INTO dim_value_alias (entity, canonical, alias) VALUES ($1, $2, $3)
               ON CONFLICT (entity, alias) DO NOTHING`, // Skip if alias already exists
              [entity, canonicalName, alias]
            );
            insertedCount++;
        } catch (e) {
            // Log specific errors if needed, but DO NOTHING handles most conflicts.
            // console.error(`[WARN] Failed to insert alias "${alias}" for "${canonicalName}": ${e.message}`);
        }
    }
  }

  console.log(`✅ Successfully processed ${rows.length} ${entity}s.`);
  console.log(`   Inserted ${insertedCount} new aliases into dim_value_alias.`);
}

async function main() {
  const db = new Client({ connectionString: NEON_DATABASE_URL });
  try {
    await db.connect();
    console.log("🟢 Database connection successful.");

    // 1. Generate aliases for Instructors (e.g., John Doe -> john, doe, jd)
    await fetchAndGenerateAliases(db, 'instructor', 'dim_instructor', 'instructor_name');

    // 2. Generate aliases for Domains (e.g., Data Science -> data science)
    // The main ETL should standardize this, but this ensures a clean lowercase alias is recorded.
    await fetchAndGenerateAliases(db, 'domain', 'dim_domain', 'domain_name');

  } catch (e) {
    console.error("❌ Alias generation failed:", e.message);
    process.exit(1);
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error("❌ Fatal ETL error:", e.message);
  process.exit(1);
});