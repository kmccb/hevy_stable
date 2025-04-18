/**
 * runDailySync.js
 * Handles the daily sync process for the Hevy CoachGPT NextGen service.
 * Fetches cache, runs autoplan, generates charts with trends and full-data averages, and sends the daily email.
 */

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

// Add a version log to confirm this file is loaded
console.log("🏷️ runDailySync.js Version: v1.9 – Fixed workout consistency metric");

// Log environment variables (mask password for security)
console.log(`📧 Email configuration - From: ${EMAIL_USER}, Password set: ${EMAIL_PASS ? 'Yes' : 'No'}`);

/**
 * Calculates the linear regression slope for a dataset.
 * @param {Array} data - Array of { date: string, value: number } objects.
 * @returns {number} - Slope in units per day.
 */
function calculateTrendSlope(data) {
  if (!data || data.length < 2) return null;

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
  return isNaN(slope) ? null : slope;
}

/**
 * Computes averages and trends over all macro data, including workout consistency.
 * @param {Array} allMacros - Array of macro entries.
 * @param {Array} workouts - Array of workout entries from workouts-30days.json.
 * @returns {Object} - Averages and trends for weight, steps, macros, calories, workouts.
 */
function computeMetrics(allMacros, workouts) {
  if (!allMacros || !allMacros.length) {
    console.warn("No macro data for computing metrics");
    return {
      weight: { average: null, trend: null },
      steps: { average: null, trend: null },
      macros: { average: { protein: null, carbs: null, fat: null }, trend: { protein: null, carbs: null, fat: null } },
      calories: { average: null, trend: null },
      workouts: { average: null, trend: null }
    };
  }

  // Sort by date to ensure chronological order
  const sortedData = [...allMacros].sort((a, b) => new Date(a.date) - new Date(b.date));

  // Helper to compute average
  const computeAverage = (values) => {
    const valid = values.filter(v => !isNaN(parseFloat(v)) && parseFloat(v) >= 0).map(v => parseFloat(v));
    return valid.length ? valid.reduce((sum, v) => sum + v, 0) / valid.length : null;
  };

  // Weight
  const weightValues = sortedData.map(d => ({ date: d.date, value: d.weight }));
  const weightAverage = computeAverage(weightValues.map(d => d.value));
  const weightTrend = calculateTrendSlope(weightValues); // Slope in lbs/day

  // Steps
  const stepsValues = sortedData.map(d => ({ date: d.date, value: d.steps.replace(/[^0-9.]/g, '') }));
  const stepsAverage = computeAverage(stepsValues.map(d => d.value));
  const stepsTrend = calculateTrendSlope(stepsValues); // Slope in steps/day

  // Macros
  const proteinValues = sortedData.map(d => ({ date: d.date, value: d.protein }));
  const carbsValues = sortedData.map(d => ({ date: d.date, value: d.carbs }));
  const fatValues = sortedData.map(d => ({ date: d.date, value: d.fat }));
  const proteinAverage = computeAverage(proteinValues.map(d => d.value));
  const carbsAverage = computeAverage(carbsValues.map(d => d.value));
  const fatAverage = computeAverage(fatValues.map(d => d.value));
  const proteinTrend = calculateTrendSlope(proteinValues); // Slope in g/day
  const carbsTrend = calculateTrendSlope(carbsValues); // Slope in g/day
  const fatTrend = calculateTrendSlope(fatValues); // Slope in g/day

  // Calories
  const calorieValues = sortedData.map(d => ({ date: d.date, value: d.calories.replace(/[^0-9.]/g, '') }));
  const calorieAverage = computeAverage(calorieValues.map(d => d.value));
  const calorieTrend = calculateTrendSlope(calorieValues); // Slope in kcal/day

  // Workout Consistency: Count days with workouts
  const workoutDates = new Set(workouts.map(w => w.date.split('T')[0])); // Normalize to YYYY-MM-DD
  const workoutValues = sortedData.map(d => ({
    date: d.date,
    value: workoutDates.has(d.date.split('T')[0]) ? 1 : 0
  }));
  const daysLogged = workoutValues.filter(w => w.value === 1).length;
  const totalDays = sortedData.length;
  const workoutAverage = totalDays > 0 ? (daysLogged / totalDays) * 7 : null; // Workouts per week
  const workoutTrend = calculateTrendSlope(workoutValues); // Slope in workouts/day

  return {
    weight: { average: weightAverage, trend: weightTrend ? weightTrend * 7 : null }, // Convert to per week
    steps: { average: stepsAverage, trend: stepsTrend ? stepsTrend * 7 : null },
    macros: {
      average: { protein: proteinAverage, carbs: carbsAverage, fat: fatAverage },
      trend: {
        protein: proteinTrend ? proteinTrend * 7 : null,
        carbs: carbsTrend ? carbsTrend * 7 : null,
        fat: fatTrend ? fatTrend * 7 : null
      }
    },
    calories: { average: calorieAverage, trend: calorieTrend ? calorieTrend * 7 : null },
    workouts: {
      average: workoutAverage,
      trend: workoutTrend ? workoutTrend * 7 : null // Workouts/week
    }
  };
}

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
    const allMacros = await getAllMacrosFromSheet();
    console.log(`📊 All macros fetched: ${allMacros.length} entries`);

    console.log("📈 Generating charts...");
    // Generate charts with original logic (may use 30-day window)
    const weightChartBase = await generateWeightChart(allMacros);
    const stepsChartBase = await generateStepsChart(allMacros);
    const macrosChartBase = await generateMacrosChart(allMacros);
    const calorieChartBase = await generateCaloriesChart(allMacros);

    // Compute full-data averages and trends, passing workouts
    const metrics = computeMetrics(allMacros, workouts);

    // Merge full-data metrics with chart buffers
    const weightChart = {
      buffer: weightChartBase?.buffer || null,
      average: metrics.weight.average ? Math.round(metrics.weight.average) : null,
      trend: metrics.weight.trend
    };
    const stepsChart = {
      buffer: stepsChartBase?.buffer || null,
      average: metrics.steps.average ? Math.round(metrics.steps.average) : null,
      trend: metrics.steps.trend
    };
    const macrosChart = {
      buffer: macrosChartBase?.buffer || null,
      average: {
        protein: metrics.macros.average.protein ? Math.round(metrics.macros.average.protein) : null,
        carbs: metrics.macros.average.carbs ? Math.round(metrics.macros.average.carbs) : null,
        fat: metrics.macros.average.fat ? Math.round(metrics.macros.average.fat) : null
      },
      trend: metrics.macros.trend
    };
    const calorieChart = {
      buffer: calorieChartBase?.buffer || null,
      average: metrics.calories.average ? Math.round(metrics.calories.average) : null,
      trend: metrics.calories.trend
    };
    const workoutChart = {
      buffer: null, // No chart for workouts yet
      average: metrics.workouts.average ? Number(metrics.workouts.average.toFixed(1)) : null,
      trend: metrics.workouts.trend
    };

    console.log("📈 Charts generated successfully");
    console.log("📈 Chart objects:", {
      weightChart: { buffer: !!weightChart.buffer, average: weightChart.average, trend: weightChart.trend },
      stepsChart: { buffer: !!stepsChart.buffer, average: stepsChart.average, trend: stepsChart.trend },
      macrosChart: { buffer: !!macrosChart.buffer, average: macrosChart.average, trend: macrosChart.trend },
      calorieChart: { buffer: !!calorieChart.buffer, average: calorieChart.average, trend: calorieChart.trend },
      workoutChart: { buffer: !!workoutChart.buffer, average: workoutChart.average, trend: workoutChart.trend }
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
        calorieChart,
        workoutChart
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