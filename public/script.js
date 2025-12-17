document.addEventListener("DOMContentLoaded", () => {
  console.log("Script Loaded v2.0 - Date Formatting Active"); // Check your browser console for this!

  const form = document.getElementById("query-form");
  const input = document.getElementById("query-input");
  const submitBtn = document.getElementById("submit-btn");

  // Result containers
  const loader = document.getElementById("loader-container");
  const errorContainer = document.getElementById("error-container");
  const errorMessage = document.getElementById("error-message");
  const summarySection = document.getElementById("summary-section");
  const summaryText = document.getElementById("summary-text");
  const tableSection = document.getElementById("table-section");
  const resultsTable = document.getElementById("results-table");
  const sqlSection = document.getElementById("sql-section");
  const sqlCode = sqlSection.querySelector("code");

  // 1. DATE FORMATTER (23rd March Sunday 2024)
  function formatFriendlyDate(dateStr) {
    if (!dateStr) return "-";
    
    // Safety: If it's already formatted or just a year, leave it
    if (typeof dateStr !== 'string') dateStr = String(dateStr);
    
    // 1. Clean the input (remove Time components if ISO string)
    // "2024-03-23T00:00:00.000Z" -> "2024-03-23"
    const cleanStr = dateStr.split('T')[0];
    const parts = cleanStr.split('-');
    
    // If we don't have Year-Month-Day, return original
    if (parts.length !== 3) return dateStr;

    // 2. Parse strictly as Local Time (Y, M-1, D) to prevent timezone shifts
    const year = parseInt(parts[0], 10);
    const monthIndex = parseInt(parts[1], 10) - 1; 
    const day = parseInt(parts[2], 10);

    const date = new Date(year, monthIndex, day);
    
    // 3. Definitions
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    // 4. Ordinal Suffix (st, nd, rd, th)
    const getOrdinal = (n) => {
      const s = ["th", "st", "nd", "rd"];
      const v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    };

    // 5. Assemble: "23rd March Sunday 2024"
    return `${getOrdinal(day)} ${months[monthIndex]} ${days[date.getDay()]} ${year}`;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const userQuery = input.value.trim();
    if (!userQuery) return;

    resetUI();
    loader.style.display = "flex";
    submitBtn.disabled = true;

    // Toggle Icons
    const arrowIcon = document.getElementById("arrow-icon");
    const spinnerIcon = document.getElementById("spinner-icon");
    if (arrowIcon) arrowIcon.classList.add("hidden");
    if (spinnerIcon) spinnerIcon.classList.remove("hidden");

    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: userQuery }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "An unknown error occurred.");
      }

      const result = await response.json();
      displayResults(result);
    } catch (error) {
      displayError(error.message);
    } finally {
      loader.style.display = "none";
      submitBtn.disabled = false;
      if (arrowIcon) arrowIcon.classList.remove("hidden");
      if (spinnerIcon) spinnerIcon.classList.add("hidden");
    }
  });

  function resetUI() {
    errorContainer.style.display = "none";
    summarySection.style.display = "none";
    tableSection.style.display = "none";
    sqlSection.style.display = "none";
    resultsTable.innerHTML = "";
  }

  function displayError(message) {
    errorMessage.textContent = message;
    errorContainer.style.display = "block";
  }

  function displayResults({ data, summary, sql }) {
    // Summary
    if (summary) {
        summaryText.innerHTML = summary.replace(/\n/g, "<br>");
        summarySection.style.display = "block";
    }

    // SQL
    if (sql) {
        sqlCode.textContent = sql;
        sqlSection.style.display = "block";
    }

    // Table
    if (data && data.length > 0) {
      tableSection.style.display = "block";
      generateTable(data);
    }
  }

  function generateTable(data) {
    const headers = Object.keys(data[0]);

    // Create Header
    const thead = document.createElement("thead");
    thead.className = "bg-gray-50";
    let headerRow = "<tr>";
    headers.forEach((header) => {
      const cleanHeader = header.replace(/_/g, " ").toUpperCase();
      headerRow += `<th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">${cleanHeader}</th>`;
    });
    headerRow += "</tr>";
    thead.innerHTML = headerRow;

    // Create Body
    const tbody = document.createElement("tbody");
    tbody.className = "bg-white divide-y divide-gray-200";
    
    data.forEach((row) => {
      let tableRow = "<tr>";
      headers.forEach((header) => {
        let value = row[header];

        // --- FORMATTING LOGIC ---
        
        // 1. Date Formatting
        if (header.includes("date") || (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}/))) {
             value = formatFriendlyDate(value);
        }
        // 2. Decimal Formatting (Round to 2 places if it's a number)
        else if (typeof value === "number" && !Number.isInteger(value)) {
             value = value.toFixed(2);
        }

        tableRow += `<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">${
          value !== null ? value : "-"
        }</td>`;
      });
      tableRow += "</tr>";
      tbody.innerHTML += tableRow;
    });

    resultsTable.append(thead, tbody);
  }
});