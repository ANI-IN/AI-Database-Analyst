// ai.js - Fixed version
const Groq = require("groq-sdk");
require("dotenv").config();

const groq = new Groq({
 apiKey: process.env.GROQ_API_KEY,
});

const getSystemPromptForSql = () => `
You are an expert PostgreSQL query writer. Convert user's natural language questions into valid PostgreSQL queries.

Query the view: v_sessions

Schema:
- session_id (BIGSERIAL, PK)
- topic_code (TEXT): Contains session format/type info like 'Live Class', 'Test Review Session', 'Training Session'
- domain (TEXT): track/program like 'backend', 'data science', 'tpm'
- class (TEXT): class name
- instructor (TEXT): instructor full name
- session_date (TIMESTAMPTZ): session datetime in UTC
- pst_date (DATE): session date in America/Los_Angeles timezone
- pst_year (INT): year in PST
- pst_quarter (INT): quarter 1-4 in PST
- pst_month (INT): month 1-12 in PST
- average (NUMERIC): average rating 1-5
- responses (INT): number of ratings
- students_attended (INT): number of students attended
- rated_pct (NUMERIC): percentage who rated

**NEW FEATURE: Alias/Fuzzy Matching**
You can use the helper function lookup_canonical_value(entity TEXT, alias TEXT) to find the correct, canonical name when the user provides a short or partial name.
- entity must be 'instructor' or 'class'
- This is mainly for human names or class titles where there can be many variants.
- If no match is found, the function returns the original alias.

RULES:
1. Use PST columns for date filtering: pst_year, pst_quarter, pst_month, pst_date.
2. Round all simple averages as: ROUND(AVG(average), 2).
3. For weighted average over responses: ROUND((SUM(average * responses) / NULLIF(SUM(responses), 0))::numeric, 2).
4. Handle trends with LAG() window function.
5. Use CASE statements for period comparisons when comparing two months/periods in one query.
6. For multi-domain instructors: GROUP BY instructor HAVING COUNT(DISTINCT domain) > 1.
7. Use lookup_canonical_value() only for instructor (and class if needed), for example:
   instructor = lookup_canonical_value('instructor', 'Konstantinos').
   Do NOT use lookup_canonical_value() for domain or type.
8. When filtering by domain or type, use case-insensitive partial matches, for example:
   LOWER(domain) LIKE '%backend%'
   LOWER(domain) LIKE '%data science%'
   LOWER(type)   LIKE '%live class%'.
9. Only filter by pst_year or pst_quarter when the user explicitly mentions a specific year or quarter.
   If no year is mentioned, aggregate across all years.

EXAMPLE PATTERNS:

Alias Lookup for an instructor (e.g., "Konstantinos"):
SELECT
  instructor,
  ROUND(AVG(average), 2) AS avg_rating,
  COUNT(*) AS sessions
FROM v_sessions
WHERE instructor = lookup_canonical_value('instructor', 'Konstantinos')
GROUP BY instructor
ORDER BY avg_rating DESC;

Month-over-month trend for a specific domain (example: Backend):
WITH monthly_data AS (
  SELECT
    pst_year,
    pst_month,
    ROUND(AVG(average), 2) AS avg_rating
  FROM v_sessions
  WHERE LOWER(domain) LIKE '%backend%'
  GROUP BY pst_year, pst_month
)
SELECT
  pst_year,
  pst_month,
  avg_rating,
  LAG(avg_rating) OVER (ORDER BY pst_year, pst_month) AS prev_month,
  ROUND(
    avg_rating - LAG(avg_rating) OVER (ORDER BY pst_year, pst_month),
    2
  ) AS change
FROM monthly_data
ORDER BY pst_year, pst_month;

What is the weighted average for live classes:
SELECT
  ROUND(
    (SUM(average * responses) / NULLIF(SUM(responses), 0))::numeric,
    2
  ) AS weighted_avg
FROM v_sessions
WHERE LOWER(type) LIKE '%live class%';

Compare weighted average for live classes vs assignment review:
SELECT
  type,
  ROUND(
    (SUM(average * responses) / NULLIF(SUM(responses), 0))::numeric,
    2
  ) AS weighted_avg
FROM v_sessions
WHERE LOWER(type) LIKE '%live class%'
   OR LOWER(type) LIKE '%assignment review%'
GROUP BY type;


Highest-rated instructor (weighted average) in a given domain:

When the user asks something like:
"Find the instructor with the highest weighted average in the <Domain> domain
 for Live Classes in <Year>"

Generate a query that at minimum filters by domain and computes the weighted average
over all matching sessions. To avoid empty results, do NOT hard-require the
session type or year; prefer returning a result over being overly strict.

Use this pattern:

SELECT
  instructor,
  ROUND(
    (SUM(average * responses) / NULLIF(SUM(responses), 0))::numeric,
    2
  ) AS weighted_avg
FROM v_sessions
WHERE
  LOWER(domain) LIKE '%' || LOWER('<Domain>') || '%'
  -- Optionally, if the data model truly uses a generic "live class" type
  -- for this domain and year, you may add:
  -- AND LOWER(type) LIKE '%live class%'
  -- AND pst_year = <Year>
GROUP BY
  instructor
ORDER BY
  weighted_avg DESC
LIMIT 1;

Example for Data Science (no year / type filter to keep it robust):

SELECT
  instructor,
  ROUND(
    (SUM(average * responses) / NULLIF(SUM(responses), 0))::numeric,
    2
  ) AS weighted_avg
FROM v_sessions
WHERE
  LOWER(domain) LIKE '%data science%'
GROUP BY
  instructor
ORDER BY
  weighted_avg DESC
LIMIT 1;


Period comparison (Jan vs Feb in a given year):
WITH comparison AS (
  SELECT
    class,
    ROUND(AVG(CASE WHEN pst_month = 1 THEN average END), 2) AS jan_avg,
    ROUND(AVG(CASE WHEN pst_month = 2 THEN average END), 2) AS feb_avg
  FROM v_sessions
  WHERE pst_year = 2025
    AND pst_month IN (1, 2)
  GROUP BY class
)
SELECT
  class,
  jan_avg,
  feb_avg,
  ROUND(feb_avg - jan_avg, 2) AS improvement
FROM comparison
WHERE jan_avg IS NOT NULL
  AND feb_avg IS NOT NULL
ORDER BY improvement DESC;

Multi-domain instructors with high ratings:
SELECT
  instructor,
  domain,
  ROUND(AVG(average), 2) AS avg_rating,
  SUM(responses) AS responses
FROM v_sessions
WHERE pst_year = 2025
GROUP BY instructor, domain
HAVING instructor IN (
  SELECT instructor
  FROM v_sessions
  WHERE pst_year = 2025
  GROUP BY instructor
  HAVING COUNT(DISTINCT domain) > 1
     AND AVG(average) >= 4.4
)
ORDER BY instructor, domain;

OUTPUT: Return ONLY the SQL query. No explanations, no markdown, no comments.
`;

async function getAiSql(userQuery, maxRetries = 3) {
 for (let attempt = 1; attempt <= maxRetries; attempt++) {
  try {
   console.log(
    `[DEBUG] AI attempt ${attempt}/${maxRetries} for query: "${userQuery}"`
   );

   const chatCompletion = await groq.chat.completions.create({
    messages: [
     {
      role: "system",
      content: getSystemPromptForSql(),
     },
     {
      role: "user",
      content: `Convert this to SQL: "${userQuery}"`,
     },
    ],
    model: "llama-3.3-70b-versatile",
    temperature: 0,
    max_tokens: 1024,
   });

   const sqlQuery =
    chatCompletion.choices[0]?.message?.content?.trim() || "";

   if (!sqlQuery) {
    throw new Error("Empty SQL response from AI");
   }

   // Clean up the response (remove any markdown if present)
   let cleanSql = sqlQuery;
   if (cleanSql.includes("```sql")) {
    cleanSql = cleanSql
     .replace(/```sql\n?/g, "")
     .replace(/```\n?/g, "")
     .trim();
   }
   if (cleanSql.includes("```")) {
    cleanSql = cleanSql.replace(/```/g, "").trim();
   }

   console.log(
    `[DEBUG] AI generated SQL (${
     cleanSql.length
    } chars): ${cleanSql.substring(0, 100)}...`
   );
   return cleanSql;
  } catch (error) {
   console.error(`[ERROR] AI attempt ${attempt} failed:`, error.message);

   if (error.status === 503 && attempt < maxRetries) {
    const delay = attempt * 2000;
    console.log(`[INFO] Retrying in ${delay}ms...`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    continue;
   }

   if (attempt === maxRetries) {
    throw new Error(
     `Failed to generate SQL after ${maxRetries} attempts: ${error.message}`
    );
   }
  }
 }
}

async function getAiSummary(userQuery, sqlQuery, data, maxRetries = 2) {
 if (!data || data.length === 0) {
  return "Query executed successfully but returned no results.";
 }

 for (let attempt = 1; attempt <= maxRetries; attempt++) {
  try {
   const summaryPrompt = `
Question: "${userQuery}"

SQL: ${sqlQuery}

Results (${data.length} rows):
${JSON.stringify(data.slice(0, 5), null, 2)}${
    data.length > 5 ? "\n... and more rows" : ""
   }

Provide a clear 1-2 sentence summary of these results.`;

   const chatCompletion = await groq.chat.completions.create({
    messages: [
     {
      role: "system",
      content:
       "You are a data analyst. Summarize query results clearly and concisely.",
     },
     {
      role: "user",
      content: summaryPrompt,
     },
    ],
    model: "openai/gpt-oss-120b",
    temperature: 0,
    max_tokens: 1024,
   });

   return (
    chatCompletion.choices[0]?.message?.content?.trim() ||
    `Query found ${data.length} result(s). See the data table for details.`
   );
  } catch (error) {
   console.error(
    `[ERROR] Summary attempt ${attempt} failed:`,
    error.message
   );

   if (attempt === maxRetries) {
    return `Query executed successfully and returned ${data.length} result(s). Please review the data below.`;
   }

   if (error.status === 503 && attempt < maxRetries) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
   }
  }
 }
}

module.exports = { getAiSql, getAiSummary };