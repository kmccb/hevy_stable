// fetchEveryWorkout.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { HEVY_API_KEY } = require('./secrets');

const outputPath = path.join(__dirname, 'data', 'workouts-full-history.json');

async function fetchEveryWorkout() {
  let allWorkouts = [];
  let page = 1;
  const perPage = 50; // Increase to fetch more per page
  let totalPages = 1;

  console.log('📦 Fetching ALL Hevy workouts...');

  try {
    while (page <= totalPages) {
      const response = await axios.get(`https://api.hevyapp.com/v1/workouts?page=${page}&per_page=${perPage}`, {
        headers: { 'api-key': HEVY_API_KEY }
      });

      const data = response.data;
      if (Array.isArray(data?.workouts)) {
        allWorkouts = allWorkouts.concat(data.workouts);
        console.log(`📃 Page ${page} retrieved: ${data.workouts.length} workouts`);
      }

      if (data?.pagination?.total_pages) {
        totalPages = data.pagination.total_pages;
      }

      page++;
    }

    fs.writeFileSync(outputPath, JSON.stringify(allWorkouts, null, 2));
    console.log(`✅ All workouts saved to ${outputPath} (${allWorkouts.length} total)`);
  } catch (err) {
    console.error('❌ Error fetching full workout history:', err.message);
  }
}

if (require.main === module) {
  fetchEveryWorkout();
}

module.exports = fetchEveryWorkout;
