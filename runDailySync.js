const autoplan = require("./autoplan");
const fetchAllWorkouts = require("./fetchAllWorkouts");
const fetchAllExercises = require("./exerciseService");
const fetchAllRoutines = require("./fetchAllRoutines");

const fs = require("fs");
const axios = require("axios");
const { getYesterdaysWorkouts } = require("./getYesterdaysWorkouts");
const { getMacrosFromSheet, getAllMacrosFromSheet } = require("./sheetsService");
const { generateWeightChart, generateStepsChart, generateMacrosChart, generateCaloriesChart } = require("./chartService");
const { sendDailyEmail } = require("./generateEmail");
const { analyzeWorkouts } = require("./trainerUtils");

const { EMAIL_USER, EMAIL_PASS } = process.env;

function calculateTrendSlope(data) {
  if (!data || data.length < 2) return 0;

  // Convert dates to days since earliest date
  const earliestDate = new Date(Math.min(...data.map(d => new Date(d.date))));
  const points = data.map(d => {
    const days = (new Date(d.date) - earliestDate) / (1000 * 60 * 60 * 24);
    return { x: days, y: parseFloat(d.value) || 0 };
  });

  const n = points.length;
  const sumX = points.reduce((sum, p) => sum + p.x, 0);
  const sumY = points.reduce((sum, p) => sum + p.y, 0);
  const sumXY = points.reduce((sum, p) => sum + p.x * p.y, 0);
  const sumXX = points.reduce((sum, p) => sum + p.x * p.x, 0);

  // Slope = (n * Σ(xy) - Σx * Σy) / (n * Σ(x²) - (Σx)²)
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  return isNaN(slope) ? 0 : slope;
}

/**
 * Generates charts and computes averages/trends over all data.
 * @param {Array} allMacrosData - Array of macro entries.
 * @returns {Object} - Chart objects with averages and trends.
 */
function generateCharts(allMacrosData) {
  console.log("📈 Generating charts with full data...");
  if (!allMacrosData || !allMacrosData.length) {
    console.error("No macro data provided for charts");
    return {
      weightChart: { buffer: null, average: null, trend: null },
      stepsChart: { buffer: null, average: null, trend: null },
      macrosChart: { buffer: null, average: { protein: null, carbs: null, fat: null }, trend: { protein: null, carbs: null, fat: null } },
      calorieChart: { buffer: null, average: null, trend: null }
    };
  }

  // Sort by date to ensure chronological order
  const sortedData = [...allMacrosData].sort((a, b) => new Date(a.date) - new Date(b.date));

  // Helper to compute average
  const computeAverage = (values) => {
    const valid = values.filter(v => !isNaN(parseFloat(v)) && parseFloat(v) > 0).map(v => parseFloat(v));
    return valid.length ? valid.reduce((sum, v) => sum + v, 0) / valid.length : null;
  };

  // Weight chart
  const weightValues = sortedData.map(d => ({ date: d.date, value: d.weight }));
  const weightAverage = computeAverage(weightValues.map(d => d.value));
  const weightTrend = calculateTrendSlope(weightValues); // Slope in lbs/day

  // Steps chart
  const stepsValues = sortedData.map(d => ({ date: d.date, value: d.steps.replace(/[^0-9.]/g, '') }));
  const stepsAverage = computeAverage(stepsValues.map(d => d.value));
  const stepsTrend = calculateTrendSlope(stepsValues); // Slope in steps/day

  // Macros chart
  const proteinValues = sortedData.map(d => ({ date: d.date, value: d.protein }));
  const carbsValues = sortedData.map(d => ({ date: d.date, value: d.carbs }));
  const fatValues = sortedData.map(d => ({ date: d.date, value: d.fat }));
  const proteinAverage = computeAverage(proteinValues.map(d => d.value));
  const carbsAverage = computeAverage(carbsValues.map(d => d.value));
  const fatAverage = computeAverage(fatValues.map(d => d.value));
  const proteinTrend = calculateTrendSlope(proteinValues); // Slope in g/day
  const carbsTrend = calculateTrendSlope(carbsValues); // Slope in g/day
  const fatTrend = calculateTrendSlope(fatValues); // Slope in g/day

  // Calorie chart
  const calorieValues = sortedData.map(d => ({ date: d.date, value: d.calories.replace(/[^0-9.]/g, '') }));
  const calorieAverage = computeAverage(calorieValues.map(d => d.value));
  const calorieTrend = calculateTrendSlope(calorieValues); // Slope in kcal/day

  // Placeholder for chart buffers (replace with actual chart generation logic)
  const generateChartBuffer = () => Buffer.from(""); // Stub; replace with real charting library call

  console.log("📈 Charts generated successfully");
  return {
    weightChart: {
      buffer: generateChartBuffer(),
      average: weightAverage ? Math.round(weightAverage) : null,
      trend: weightTrend !== null ? weightTrend * 7 : null // Convert to per week
    },
    stepsChart: {
      buffer: generateChartBuffer(),
      average: stepsAverage ? Math.round(stepsAverage) : null,
      trend: stepsTrend !== null ? stepsTrend * 7 : null // Convert to per week
    },
    macrosChart: {
      buffer: generateChartBuffer(),
      average: {
        protein: proteinAverage ? Math.round(proteinAverage) : null,
        carbs: carbsAverage ? Math.round(carbsAverage) : null,
        fat: fatAverage ? Math.round(fatAverage) : null
      },
      trend: {
        protein: proteinTrend !== null ? proteinTrend * 7 : null,
        carbs: carbsTrend !== null ? carbsTrend * 7 : null,
        fat: fatTrend !== null ? fatTrend * 7 : null
      }
    },
    calorieChart: {
      buffer: generateChartBuffer(),
      average: calorieAverage ? Math.round(calorieAverage) : null,
      trend: calorieTrend !== null ? calorieTrend * 7 : null // Convert to per week
    }
  };
}

// Add a version log to confirm this file is loaded
console.log("🏷️ runDailySync.js Version: v1.6 – Added chart logging");

// Log environment variables (mask password for security)
console.log(`📧 Email configuration - From: ${EMAIL_USER}, Password set: ${EMAIL_PASS ? 'Yes' : 'No'}`);

async function runDailySync(isCachePriming = false) {
  try {
    console.log(`🔁 Running daily sync... [runDailySync.js] (isCachePriming: ${isCachePriming})`);

    console.log("📂 Fetching cache data...");
    await fetchAllExercises();
    await fetchAllWorkouts();
    await fetchAllRoutines();

    console.log("📂 Reading cache files...");
    const workouts = JSON.parse(fs.readFileSync("data/workouts-30days.json"));
    const templates = JSON.parse(fs.readFileSync("data/exercise_templates.json"));
    const routines = JSON.parse(fs.readFileSync("data/routines.json"));
    console.log(`📂 Cache files read - Workouts: ${workouts.length}, Templates: ${templates.length}, Routines: ${routines.length}`);

    console.log("⚙️ Running autoplan...");
    const autoplanResult = await autoplan({ workouts, templates, routines });
    console.log('autoplanResult in runDailySync.js:', JSON.stringify(autoplanResult));

    // Ensure todaysWorkout has a title and exercises
    let todaysWorkout = autoplanResult?.routine?.routine?.[0];
    console.log('Raw todaysWorkout from autoplanResult:', JSON.stringify(todaysWorkout));

    // Strengthened validation
    if (!todaysWorkout || typeof todaysWorkout !== 'object' || !todaysWorkout.id) {
      console.warn("Warning: todaysWorkout is invalid after autoplan (missing object or id). Using fallback.");
      todaysWorkout = { title: "Rest Day", exercises: [], id: "fallback-id" };
    }
    if (!todaysWorkout.title || typeof todaysWorkout.title !== 'string') {
      console.warn("Warning: todaysWorkout is missing a valid title. Adding fallback title.");
      todaysWorkout.title = "CoachGPT – Planned Workout";
    }
    if (!todaysWorkout.exercises || !Array.isArray(todaysWorkout.exercises)) {
      console.warn("Warning: todaysWorkout is missing exercises array. Adding empty array.");
      todaysWorkout.exercises = [];
    }
    console.log('Validated todaysWorkout in runDailySync.js:', JSON.stringify(todaysWorkout));

    // Skip email generation during cache priming or if todaysWorkout is invalid
    if (isCachePriming) {
      console.log("Skipping email generation during cache priming.");
      return;
    }

    if (!todaysWorkout.title || todaysWorkout.exercises.length === 0) {
      console.warn("Skipping email generation: todaysWorkout is not fully populated:", JSON.stringify(todaysWorkout));
      return;
    }

    console.log("📅 Fetching recent workouts...");
    const recentWorkouts = await getYesterdaysWorkouts();
    console.log(`📅 Recent workouts fetched: ${recentWorkouts.length}`);

    console.log("📊 Fetching macros...");
    const macros = await getMacrosFromSheet();
    if (!macros) throw new Error("No macros found for yesterday.");
    console.log(`📊 Macros fetched: ${JSON.stringify(macros)}`);

    console.log("📊 Fetching all macros...");
    const allMacros = await fetchAllMacros();
    console.log(`📊 All macros fetched: ${allMacros.length} entries`);

    console.log("📈 Generating charts...");
    const weightChart = await generateWeightChart(allMacros);
    const stepsChart = await generateStepsChart(allMacros);
    const macrosChart = await generateMacrosChart(allMacros);
    const calorieChart = await generateCaloriesChart(allMacros);
    console.log("📈 Charts generated successfully");
    console.log("📈 Chart objects:", {
      weightChart: { buffer: !!weightChart?.buffer, average: weightChart?.average },
      stepsChart: { buffer: !!stepsChart?.buffer, average: stepsChart?.average },
      macrosChart: { buffer: !!macrosChart?.buffer, average: macrosChart?.average },
      calorieChart: { buffer: !!calorieChart?.buffer, average: calorieChart?.average }
    });

    console.log("🧠 Generating trainer insights...");
    const trainerInsights = recentWorkouts.length === 0 ? [] : analyzeWorkouts(recentWorkouts);
    console.log(`🧠 Trainer insights generated: ${trainerInsights.length} insights`);

    console.log("📅 Calculating day number...");
    const lastDay = recentWorkouts.find(w => w.title.includes("Day"))?.title.match(/Day (\d+)/);
    const todayDayNumber = lastDay ? parseInt(lastDay[1]) + 1 : 1;
    console.log(`📅 Today day number: ${todayDayNumber}`);

    console.log("💬 Fetching quote...");
    let quoteText = "“You are stronger than you think.” – CoachGPT";
    try {
      const res = await axios.get('https://zenquotes.io/api/today');
      const quote = res.data[0];
      quoteText = `“${quote.q}” – ${quote.a}`;
      console.log(`💬 Quote fetched: ${quoteText}`);
    } catch (err) {
      console.warn("❌ ZenQuote fetch failed, using fallback:", err.message);
    }

    console.log("📧 Preparing to send daily email...");
    await sendDailyEmail(
      recentWorkouts,
      macros,
      allMacros,
      trainerInsights,
      todayDayNumber,
      {
        weightChart,
        stepsChart,
        macrosChart,
        calorieChart
      },
      todaysWorkout,
      quoteText
    );
    console.log("📧 Daily email process completed.");
  } catch (err) {
    console.error("❌ runDailySync.js - Daily sync failed:", err.message || err);
    throw err; // Rethrow to ensure the error is visible in the caller
  } finally {
    console.log("🏁 runDailySync.js - Daily sync completed.");
  }
}

module.exports = runDailySync;