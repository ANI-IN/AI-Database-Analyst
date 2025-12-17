document.addEventListener("DOMContentLoaded", () => {
  console.log("Script Loaded v5.0 - Final Fix");

  const form = document.getElementById("query-form");
  const input = document.getElementById("query-input");
  const submitBtn = document.getElementById("submit-btn");

  const loader = document.getElementById("loader-container");
  const errorContainer = document.getElementById("error-container");
  const errorMessage = document.getElementById("error-message");
  
  const summarySection = document.getElementById("summary-section");
  const summaryText = document.getElementById("summary-text");
  
  const chartSection = document.getElementById("chart-section");
  const chartCanvas = document.getElementById("results-chart");
  
  const tableSection = document.getElementById("table-section");
  const resultsTable = document.getElementById("results-table");
  
  const sqlSection = document.getElementById("sql-section");
  const sqlCode = sqlSection.querySelector("code");

  let chartInstance = null;

  // =========================================================
  // 1. CHART RENDERER
  // =========================================================
  function renderChart(data) {
    if (!data || data.length === 0) {
      chartSection.style.display = "none";
      return;
    }

    const ctx = chartCanvas.getContext("2d");
    const headers = Object.keys(data[0]);

    // Detect Columns
    let labelKey = headers.find(k => /date|month|year|quarter|day/i.test(k));
    if (!labelKey) labelKey = headers.find(k => /name|class|domain|instructor|topic|region/i.test(k));
    if (!labelKey) labelKey = headers.find(k => typeof data[0][k] === "string");

    let valueKey = headers.find(k => /rating|avg|score|percent|pct/i.test(k));
    if (!valueKey) valueKey = headers.find(k => /count|sum|total|responses|attended/i.test(k));
    if (!valueKey) valueKey = headers.find(k => typeof data[0][k] === "number");

    if (!labelKey || !valueKey) {
      chartSection.style.display = "none";
      return;
    }

    // Format Data
    const labels = data.map(row => {
      const val = row[labelKey];
      if (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}/)) {
        const d = new Date(val);
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return `${d.getDate()} ${months[d.getMonth()]}`; 
      }
      return val;
    });

    const values = data.map(row => row[valueKey]);
    const isTrend = /date|month|year|quarter/i.test(labelKey);
    const chartType = isTrend ? 'line' : 'bar';

    // Show Chart
    chartSection.style.display = "block";

    if (chartInstance) {
      chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
      type: chartType,
      data: {
        labels: labels,
        datasets: [{
          label: valueKey.toUpperCase().replace(/_/g, " "),
          data: values,
          backgroundColor: isTrend ? 'rgba(59, 130, 246, 0.1)' : 'rgba(59, 130, 246, 0.7)',
          borderColor: '#2563eb',
          borderWidth: 2,
          tension: 0.3,
          fill: isTrend,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => ` ${context.dataset.label}: ${context.raw}`
            }
          }
        },
        scales: {
          y: {
            beginAtZero: valueKey.includes("rating") ? false : true,
            grid: { borderDash: [2, 4], color: '#f3f4f6' }
          },
          x: { grid: { display: false } }
        }
      }
    });
  }

  // =========================================================
  // 2. DATE FORMATTER
  // =========================================================
  function formatFriendlyDate(dateStr) {
    if (!dateStr) return "-";
    if (typeof dateStr !== 'string') dateStr = String(dateStr);
    
    const cleanStr = dateStr.split('T')[0];
    const parts = cleanStr.split('-');
    
    if (parts.length !== 3) return dateStr;

    const year = parseInt(parts[0], 10);
    const monthIndex = parseInt(parts[1], 10) - 1; 
    const day = parseInt(parts[2], 10);

    const date = new Date(year, monthIndex, day);
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const getOrdinal = (n) => {
      const s = ["th", "st", "nd", "rd"];
      const v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    };

    return `${getOrdinal(day)} ${months[monthIndex]} ${days[date.getDay()]} ${year}`;
  }

  // =========================================================
  // 3. MAIN LOGIC
  // =========================================================
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
    chartSection.style.display = "none"; 
    tableSection.style.display = "none";
    sqlSection.style.display = "none";
    resultsTable.innerHTML = "";
    
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
  }

  function displayError(message) {
    errorMessage.textContent = message;
    errorContainer.style.display = "block";
  }

  function displayResults({ data, summary, sql }) {
    if (summary) {
        summaryText.innerHTML = summary.replace(/\n/g, "<br>");
        summarySection.style.display = "block";
    }

    if (sql) {
        sqlCode.textContent = sql;
        sqlSection.style.display = "block";
    }

    if (data && data.length > 0) {
      // 1. Try to Render Chart
      try {
        renderChart(data);
      } catch (e) {
        console.error("Chart failed to render:", e);
        chartSection.style.display = "none";
      }

      // 2. Render Table (ALWAYS)
      tableSection.style.display = "block";
      generateTable(data);
    }
  }

  function generateTable(data) {
    const headers = Object.keys(data[0]);
    const thead = document.createElement("thead");
    thead.className = "bg-gray-50";
    let headerRow = "<tr>";
    headers.forEach((header) => {
      const cleanHeader = header.replace(/_/g, " ").toUpperCase();
      headerRow += `<th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">${cleanHeader}</th>`;
    });
    headerRow += "</tr>";
    thead.innerHTML = headerRow;

    const tbody = document.createElement("tbody");
    tbody.className = "bg-white divide-y divide-gray-200";
    
    data.forEach((row) => {
      let tableRow = "<tr>";
      headers.forEach((header) => {
        let value = row[header];

        if (header.includes("date") || (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}/))) {
             value = formatFriendlyDate(value);
        } else if (typeof value === "number" && !Number.isInteger(value)) {
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