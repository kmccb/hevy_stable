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
console.log("🏷️ runDailySync.js Version: v1.11 – Fixed todaysWorkout extraction");

console.log(`📧 Email configuration - From: ${EMAIL_USER}, Password set: ${EMAIL_PASS ? 'Yes' : 'No'}`);

/**
 * Normalizes a date to YYYY-MM-DD format.
 * @param {string|Date} date - The date to normalize.
 * @returns {string|null} - Normalized date or null if invalid.
 */
function normalizeDate(date) {
  if (!date) return null;
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
  } catch (e) {
    console.warn(`Invalid date format: ${date}`);
    return null;
  }
}

/**
 * Calculates the linear regression slope for a dataset.
 * @param {Array} data - Array of { date: string, value: number } objects.
 * @returns {number} - Slope in units per day.
 */
function calculateTrendSlope(data) {
  if (!data || data.length < 2) return null;

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

  const sortedData = allMacros
    .filter(m => m.date && normalizeDate(m.date))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (!sortedData.length) {
    console.warn("No valid macro entries with dates");
    return {
      weight: { average: null, trend: null },
      steps: { average: null, trend: null },
      macros: { average: { protein: null, carbs: null, fat: null }, trend: { protein: null, carbs: null, fat: null } },
      calories: { average: null, trend: null },
      workouts: { average: null, trend: null }
    };
  }

  const computeAverage = (values) => {
    const valid = values.filter(v => !isNaN(parseFloat(v)) && parseFloat(v) >= 0).map(v => parseFloat(v));
    return valid.length ? valid.reduce((sum, v) => sum + v, 0) / valid.length : null;
  };

  const weightValues = sortedData.map(d => ({ date: d.date, value: d.weight }));
  const weightAverage = computeAverage(weightValues.map(d => d.value));
  const weightTrend = calculateTrendSlope(weightValues);

  const stepsValues = sortedData.map(d => ({ date: d.date, value: d.steps.replace(/[^0-9.]/g, '') }));
  const stepsAverage = computeAverage(stepsValues.map(d => d.value));
  const stepsTrend = calculateTrendSlope(stepsValues);

  const proteinValues = sortedData.map(d => ({ date: d.date, value: d.protein }));
  const carbsValues = sortedData.map(d => ({ date: d.date, value: d.carbs }));
  const fatValues = sortedData.map(d => ({ date: d.date, value: d.fat }));
  const proteinAverage = computeAverage(proteinValues.map(d => d.value));
  const carbsAverage = computeAverage(carbsValues.map(d => d.value));
  const fatAverage = computeAverage(fatValues.map(d => d.value));
  const proteinTrend = calculateTrendSlope(proteinValues);
  const carbsTrend = calculateTrendSlope(carbsValues);
  const fatTrend = calculateTrendSlope(fatValues);

  const calorieValues = sortedData.map(d => ({ date: d.date, value: d.calories.replace(/[^0-9.]/g, '') }));
  const calorieAverage = computeAverage(calorieValues.map(d => d.value));
  const calorieTrend = calculateTrendSlope(calorieValues);

  const workoutDates = new Set(
    workouts
      .filter(w => w.date && normalizeDate(w.date))
      .map(w => normalizeDate(w.date))
  );
  console.log(`Workout dates available: ${workoutDates.size} unique days`);
  const workoutValues = sortedData.map(d => {
    const normalizedDate = normalizeDate(d.date);
    if (!normalizedDate) {
      console.warn(`Skipping macro entry with invalid date: ${JSON.stringify(d)}`);
      return null;
    }
    return {
      date: d.date,
      value: workoutDates.has(normalizedDate) ? 1 : 0
    };
  }).filter(v => v !== null);
  const daysLogged = workoutValues.reduce((sum, v) => sum + v.value, 0);
  const totalDays = sortedData.length;
  const workoutAverage = totalDays > 0 ? (daysLogged / totalDays) * 7 : null;
  const workoutTrend = calculateTrendSlope(workoutValues);

  return {
    weight: { average: weightAverage, trend: weightTrend ? weightTrend * 7 : null },
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
      trend: workoutTrend ? workoutTrend * 7 : null
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

    // Correctly extract todaysWorkout from autoplanResult
    let todaysWorkout = autoplanResult?.todaysWorkout;
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
    const weightChartBase = await generateWeightChart(allMacros);
    const stepsChartBase = await generateStepsChart(allMacros);
    const macrosChartBase = await generateMacrosChart(allMacros);
    const calorieChartBase = await generateCaloriesChart(allMacros);

    const metrics = computeMetrics(allMacros, workouts);

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
      buffer: null,
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
    throw err;
  } finally {
    console.log("🏁 runDailySync.js - Daily sync completed.");
  }
}

module.exports = runDailySync;