-- === IK Sessions schema (from scratch) =========================
-- Safe to run multiple times.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

-- ---------- Dimensions -----------------------------------------
CREATE TABLE IF NOT EXISTS dim_instructor (
 instructor_id SERIAL PRIMARY KEY,
 instructor_name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS dim_class (
 class_id SERIAL PRIMARY KEY,
 class_name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS dim_domain (
 domain_id SERIAL PRIMARY KEY,
 domain_name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS dim_type (
 type_id   SERIAL PRIMARY KEY,
 type_name TEXT UNIQUE NOT NULL
);
-- Optional: store synonyms if you ever want fuzzy/canonical mapping
-- THIS TABLE WILL BE USED FOR ALIAS LOOKUP
CREATE TABLE IF NOT EXISTS dim_value_alias (
 entity TEXT CHECK (entity IN ('instructor','class','domain','type')) NOT NULL,
 canonical TEXT NOT NULL,
 alias  TEXT NOT NULL,
 weight NUMERIC DEFAULT 1.0,
 PRIMARY KEY (entity, alias)
);

-- ---------- Fact ------------------------------------------------
-- One row per conducted session (PST calendar)
CREATE TABLE IF NOT EXISTS fact_session (
 session_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

 topic_code TEXT, -- free text
 type_id   INT NOT NULL REFERENCES dim_type(type_id),
 domain_id  INT NOT NULL REFERENCES dim_domain(domain_id),
 class_id  INT NOT NULL REFERENCES dim_class(class_id),
 instructor_id INT NOT NULL REFERENCES dim_instructor(instructor_id),

 -- time (store UTC instant for a canonical 09:00 PST on that date)
 session_ts_utc TIMESTAMPTZ NOT NULL,
 pst_date    DATE NOT NULL,
 pst_year    INT NOT NULL,
 pst_month   INT NOT NULL CHECK (pst_month BETWEEN 1 AND 12),
 pst_quarter  INT NOT NULL CHECK (pst_quarter BETWEEN 1 AND 4),
 pst_month_start DATE NOT NULL,

 -- metrics
 average     NUMERIC,    -- e.g., 4.75
 responses    INT,      -- #students who rated
 students_attended INT,      -- #students attended
 rated_pct    NUMERIC,    -- 0..100 (percentage points)

 -- natural key prevents duplicates across re-loads
 UNIQUE (topic_code, type_id, domain_id, class_id, instructor_id, pst_date)
);

CREATE INDEX IF NOT EXISTS idx_fact_session_time
 ON fact_session (pst_year, pst_quarter, pst_month, pst_date);

CREATE INDEX IF NOT EXISTS idx_fact_session_instr
 ON fact_session (instructor_id);

CREATE INDEX IF NOT EXISTS idx_fact_session_class
 ON fact_session (class_id);

-- ---------- Helper Function for Alias Lookup --------------------
-- This function finds a canonical name by searching for an alias (case-insensitive)
CREATE OR REPLACE FUNCTION lookup_canonical_value(entity_type TEXT, alias_val TEXT)
RETURNS TEXT AS $$
DECLARE
 canonical_name TEXT;
BEGIN
 -- Positional references $1 (entity_type) and $2 (alias_val) fix the ambiguity.
  -- We rely on the ETL script to insert aliases as lowercase.
 SELECT canonical INTO canonical_name
 FROM dim_value_alias
 WHERE entity = $1 
    AND alias = LOWER($2) -- LOWER() ensures case-insensitivity against the lowercase alias table
 LIMIT 1; 

 IF canonical_name IS NOT NULL THEN
 RETURN canonical_name;
 END IF;
 
  -- Fallback: if no alias is found, return the original input
 RETURN alias_val;
END;
$$ LANGUAGE plpgsql;


-- ---------- Analysis view (what the app queries) ----------------
CREATE OR REPLACE VIEW v_sessions AS
SELECT
 fs.session_id,
 fs.topic_code,
 dt.type_name   AS type,
 dd.domain_name  AS domain,
 dc.class_name  AS class,
 di.instructor_name AS instructor,

 fs.session_ts_utc,
 fs.pst_date, fs.pst_year, fs.pst_month, fs.pst_quarter, fs.pst_month_start,

 fs.average, fs.responses, fs.students_attended, fs.rated_pct
FROM fact_session fs
JOIN dim_type   dt ON dt.type_id   = fs.type_id
JOIN dim_domain  dd ON dd.domain_id  = fs.domain_id
JOIN dim_class   dc ON dc.class_id   = fs.class_id
JOIN dim_instructor di ON di.instructor_id = fs.instructor_id;