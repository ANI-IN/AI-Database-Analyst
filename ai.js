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
- topic_code (TEXT)
- type (TEXT): session type like 'Live Class', 'Test Review Session'
- domain (TEXT): subject domain like 'Backend', 'Data Science' 
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

RULES:
1. Use PST columns for date filtering: pst_year, pst_quarter, pst_month, pst_date
2. Round all averages: ROUND(AVG(average), 2)
3. For weighted average: ROUND((SUM(average * responses) / NULLIF(SUM(responses), 0))::numeric, 2)
4. Handle trends with LAG() window function
5. Use CASE statements for period comparisons
6. For multi-domain: GROUP BY instructor HAVING COUNT(DISTINCT domain) > 1

EXAMPLE PATTERNS:

Month-over-month trend:
WITH monthly_data AS (
  SELECT pst_month, ROUND(AVG(average), 2) AS avg_rating
  FROM v_sessions WHERE pst_year = 2025 AND pst_quarter = 1
  GROUP BY pst_month
)
SELECT pst_month, avg_rating, 
       LAG(avg_rating) OVER (ORDER BY pst_month) AS prev_month,
       ROUND(avg_rating - LAG(avg_rating) OVER (ORDER BY pst_month), 2) AS change
FROM monthly_data ORDER BY pst_month;

Period comparison (Jan vs Feb):
WITH comparison AS (
  SELECT class,
    ROUND(AVG(CASE WHEN pst_month = 1 THEN average END), 2) AS jan_avg,
    ROUND(AVG(CASE WHEN pst_month = 2 THEN average END), 2) AS feb_avg
  FROM v_sessions 
  WHERE pst_year = 2025 AND pst_month IN (1, 2)
  GROUP BY class
  HAVING COUNT(CASE WHEN pst_month = 1 THEN 1 END) > 0 
     AND COUNT(CASE WHEN pst_month = 2 THEN 1 END) > 0
)
SELECT class, jan_avg, feb_avg, ROUND(feb_avg - jan_avg, 2) AS improvement
FROM comparison WHERE feb_avg > jan_avg ORDER BY improvement DESC;

Highest/Lowest in same query:
WITH ratings AS (
  SELECT class, instructor, ROUND(AVG(average), 2) AS avg_rating, COUNT(*) AS sessions
  FROM v_sessions WHERE pst_year = 2025 AND pst_quarter = 2
  GROUP BY class, instructor HAVING COUNT(*) >= 5
)
SELECT 
  CASE 
    WHEN avg_rating = (SELECT MAX(avg_rating) FROM ratings) THEN 'Highest'
    WHEN avg_rating = (SELECT MIN(avg_rating) FROM ratings) THEN 'Lowest'
  END AS type,
  class, instructor, avg_rating, sessions
FROM ratings 
WHERE avg_rating = (SELECT MAX(avg_rating) FROM ratings) 
   OR avg_rating = (SELECT MIN(avg_rating) FROM ratings)
ORDER BY avg_rating DESC;

Multi-domain instructors:
SELECT instructor, domain, ROUND(AVG(average), 2) AS avg_rating, SUM(responses) AS responses
FROM v_sessions WHERE pst_year = 2025
GROUP BY instructor, domain
HAVING instructor IN (
  SELECT instructor FROM v_sessions WHERE pst_year = 2025
  GROUP BY instructor 
  HAVING COUNT(DISTINCT domain) > 1 AND AVG(average) >= 4.4
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
        model: "llama-3.3-70b-versatile",
        temperature: 0.2,
        max_tokens: 200,
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
