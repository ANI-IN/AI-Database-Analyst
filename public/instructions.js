document.addEventListener("DOMContentLoaded", () => {
  const instructorsList = document.getElementById("instructors-list");
  const domainsList = document.getElementById("domains-list");
  const classesList = document.getElementById("classes-list");
  const topicsList = document.getElementById("topics-list");

  // Reusable function to fetch and populate
  const populateList = async (element, endpoint, fieldName) => {
    try {
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error("Failed to fetch");
      const data = await response.json();

      element.innerHTML = ""; // Clear loading state

      if (data.length === 0) {
        element.innerHTML = "<li class='text-gray-400 italic p-1'>No data found</li>";
        return;
      }

      data.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item[fieldName];
        li.className = "px-2 py-1 hover:bg-gray-100 rounded cursor-default break-words";
        element.appendChild(li);
      });
    } catch (error) {
      console.error(error);
      element.innerHTML = "<li class='text-red-500 p-1'>Error loading data</li>";
    }
  };

  // Execute Fetches
  populateList(instructorsList, "/api/instructors", "full_name");
  populateList(domainsList, "/api/domains", "domain_name");
  populateList(classesList, "/api/classes", "class_name");
  
  // New Topic Codes Fetch
  if (topicsList) {
      populateList(topicsList, "/api/topics", "topic_code");
  }
});