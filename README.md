 # AI Database Analyst

**AI Database Analyst** is a full-stack **RAG (Retrieval-Augmented Generation)** application designed to democratize data access. It allows non-technical users to query complex educational session data using natural language.

Instead of writing SQL, users ask questions like *"Who is the most consistent instructor in Q2 2024?"*. The system uses a multi-stage AI pipeline to resolve entities, generate robust PostgreSQL queries, visualize the results, and provide an executive summary.

---

## Table of Contents

1. [System Architecture](#-system-architecture)
2. [Core Logic & RAG Pipeline](#-Core-Logic-&-RAG-Pipeline)
3. [Database Schema](#-database-schema)
4. [Features](#-features)
5. [Prerequisites & Installation](#-prerequisites--installation)
6. [Configuration](#-configuration)
7. [ETL & Data Ingestion](#-etl--data-ingestion)
8. [API Reference](#-api-reference)
9. [Troubleshooting](#-troubleshooting)

---

## System Architecture

The application is built on a Node.js/Express backend and a Vanilla JS frontend. It leverages **Groq** for high-speed LLM inference and **Neon (PostgreSQL)** for serverless database management.

![System Architecture](./images/System%20Architecture.png)

---

## Core Logic & RAG Pipeline

This is not a simple "text-to-SQL" wrapper. It employs a **Deterministic Guardrail** approach to ensure accuracy.

### The Query Resolution Flow

1. **NER (Named Entity Recognition):** The AI extracts potential entities (e.g., "Udit", "Backend", "Live Class") from the user's prompt.
2. **Fuzzy Resolution (The "Fuzzy" Layer):**
* The server maintains an in-memory cache of all Instructors, Domains, and Classes using **Fuse.js**.
* Extracted entities are fuzzy-matched against this cache.
* *Example:* User types "Konstatinos" -> System resolves to "Konstantinos Pappas".


3. **Context Injection:** The resolved names are injected back into the LLM prompt as system context rules (e.g., `Filter by di.full_name = 'Konstantinos Pappas'`).
4. **SQL Generation:** The LLM generates SQL using the injected context and strict schema rules.
5. **Execution & Summarization:** The SQL is executed, and the results are fed back to the LLM to generate a human-readable summary.

![The Query Resolution Flow](./images/The%20Query%20Resolution%20Flow.png)

---

## Database Schema

The database uses a **Star Schema** optimized for analytical queries. The central `fact_sessions` table links to dimensions for Instructors, Classes, Domains, and Topics.
![Database Schema](./images/Database%20Schema.png)

---

## Features

* **Natural Language Processing:** Converts English questions into complex SQL queries involving Joins, Aggregations, and Window Functions.
* **Smart Visualization:** The frontend automatically detects if the data is time-series (Line Chart) or categorical (Bar Chart) and renders using Chart.js.
* **Timezone Intelligence:** All dates are normalized to **PST** to prevent date-shifting errors during analysis.
* **Ambiguity Handling:** If a user asks about "Backend" (which could be a Class or a Domain), the system attempts to resolve the specific intent or searches both.
* **Performance Optimization:**
* Connection Pooling via `pg`.
* In-memory caching of dimension tables for instant fuzzy matching.
* Database indexing on `pst_date` and Foreign Keys.



---

## Prerequisites & Installation

### Prerequisites

* **Node.js** (v18+)
* **PostgreSQL Database** (Local or Neon)
* **Groq API Key** (for LLM access)

### Installation

1. **Clone the Repository**
```bash
git clone [https://github.com/your-username/ai-database-analyst.git](https://github.com/your-username/ai-database-analyst.git)
cd ai-database-analyst

```


2. **Install Dependencies**
```bash
npm install

```


3. **Database Setup**
Execute the `schema.sql` file in your PostgreSQL instance to create the necessary tables and extensions.
```bash
psql "your_connection_string" -f schema.sql

```


---

## Configuration

Create a `.env` file in the root directory:

```env
# Database Connection (Neon/Postgres)
NEON_DATABASE_URL=postgresql://user:password@host:port/database?sslmode=require

# AI Provider
GROQ_API_KEY=gsk_your_api_key_here

# Server Port (Optional, defaults to 3001)
PORT=3001

```

---

## ETL & Data Ingestion

The system includes a robust ETL pipeline to handle raw Excel data dumps.

### 1. Load Session Data

The `load_excel.mjs` script handles normalization, dimension extraction, and fact insertion. It automatically handles date formats and percentage calculations.

```bash
# Run with default file (data/sessions.xlsx)
node etl/load_excel.mjs

# Run with custom file
node etl/load_excel.mjs --file=./uploads/new_data.xlsx

```

### 2. Generate Aliases (Optional)

The `generate_aliases.mjs` script creates variations of names (e.g., "JD", "John", "Doe" for "John Doe") to improve fuzzy matching accuracy.

```bash
node etl/generate_aliases.mjs

```

---

##  API Reference

### `POST /api/query`

The primary endpoint for the RAG interface.

* **Body:** `{ "query": "Trend of average ratings for System Design in 2024" }`
* **Response:**
* `data`: Array of JSON objects (the rows).
* `sql`: The generated SQL query.
* `summary`: AI-generated insight.



### `GET /api/instructors`

Returns a list of all instructors for the frontend autocomplete/instructions.

### `GET /api/domains`

Returns a list of available domains.

---

## Troubleshooting

### Common Issues

**1. "Generated SQL query is invalid"**

* **Cause:** The AI hallucinated a column or failed to join correctly.
* **Fix:** Check the `ai.js` System Prompt. Ensure the Schema definition in the prompt matches your actual database schema.

**2. Database Connection Error**

* **Cause:** SSL requirements or connection limits.
* **Fix:** Ensure `?sslmode=require` is at the end of your `NEON_DATABASE_URL`. The `db.js` file is configured to reject unauthorized connections (standard for Neon).

**3. "No results found"**

* **Cause:** Date filtering mismatch.
* **Fix:** The system uses strict **PST** dates. Ensure your query includes the year (e.g., "in 2024").

---

### Project Structure

```text
├── etl/
│   ├── generate_aliases.mjs  # Alias generation for fuzzy matching
│   └── load_excel.mjs        # Main data ingestion script
├── public/
│   ├── index.html            # Main UI
│   ├── script.js             # Frontend logic (Chart.js, Fetch)
│   └── instructions.html     # Data dictionary UI
├── server.js                 # Express App, Fuse.js logic, Orchestrator
├── ai.js                     # Groq API integration & Prompts
├── db.js                     # Postgres Connection Pooling
├── schema.sql                # Database definition
└── README.md                 # Documentation

```
