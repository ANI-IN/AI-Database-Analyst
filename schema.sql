-- Enable UUID extension for unique IDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- 0. CLEANUP (Only run if you need to reset)
-- ==========================================
DROP TABLE IF EXISTS fact_sessions CASCADE;
DROP TABLE IF EXISTS dim_instructor CASCADE;
DROP TABLE IF EXISTS dim_class CASCADE;
DROP TABLE IF EXISTS dim_domain CASCADE;
DROP TABLE IF EXISTS dim_topic CASCADE;

-- ==========================================
-- 1. DIMENSION TABLES
-- ==========================================

-- INSTRUCTORS
-- We split names for accurate matching but keep a full_name for easy searching.
CREATE TABLE dim_instructor (
    instructor_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    first_name TEXT NOT NULL,          -- e.g. "Udit"
    last_name TEXT NOT NULL,           -- e.g. "Bhatia"
    -- Auto-generated column: effectively caches "Udit Bhatia" for searches
    full_name TEXT GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED, 
    region TEXT,                       -- e.g. "India" or "US"
    
    -- Constraint: Prevent duplicate instructor entries
    UNIQUE(first_name, last_name, region)
);

-- CLASSES
CREATE TABLE dim_class (
    class_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    class_name TEXT NOT NULL,          -- e.g. "Product Management Behavioral"
    region TEXT,                       -- e.g. "US" or "India"
    
    UNIQUE(class_name, region)
);

-- DOMAINS
CREATE TABLE dim_domain (
    domain_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain_name TEXT UNIQUE NOT NULL   -- e.g. "Product Management", "Data Science"
);

-- TOPICS
CREATE TABLE dim_topic (
    topic_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    topic_code TEXT UNIQUE NOT NULL    -- e.g. "Live Class", "Test Review Session"
);

-- ==========================================
-- 2. FACT TABLE (METRICS)
-- ==========================================

CREATE TABLE fact_sessions (
    session_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Foreign Keys linking to dimensions
    instructor_id UUID REFERENCES dim_instructor(instructor_id),
    class_id UUID REFERENCES dim_class(class_id),
    domain_id UUID REFERENCES dim_domain(domain_id),
    topic_id UUID REFERENCES dim_topic(topic_id),

    -- TIMEZONE SAFETY
    -- Stored as strictly DATE (YYYY-MM-DD). 
    -- This prevents time-shifting errors (e.g. Jan 13th 11 PM vs Jan 14th 2 AM).
    pst_date DATE NOT NULL,

    -- PERFORMANCE METRICS
    average_rating NUMERIC(4, 2),     -- 1.00 to 5.00
    responses INTEGER DEFAULT 0,      -- Weighted Average input
    attended INTEGER DEFAULT 0,       -- Attendance count
    rated_pct NUMERIC(5, 2),          -- 0.00 to 100.00

    -- Constraint: Prevent duplicate session data imports
    UNIQUE(instructor_id, class_id, pst_date, topic_id)
);

-- ==========================================
-- 3. INDEXES FOR PERFORMANCE
-- ==========================================

-- Faster Date Range Filtering (e.g., "Q1 2024")
CREATE INDEX idx_fact_sessions_date ON fact_sessions(pst_date);

-- Faster Joins on Instructor
CREATE INDEX idx_fact_sessions_instructor ON fact_sessions(instructor_id);

-- Faster Search on Instructor Names (Optional but good for DB-side debugging)
CREATE INDEX idx_dim_instructor_fullname ON dim_instructor(full_name);