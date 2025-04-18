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

console.log("🏷️ runDailySync.js Version: v1.14 – Fix workout consistency calculation");

console.log(`📧 Email configuration - From: ${EMAIL_USER}, Password set: ${EMAIL_PASS ? 'Yes' : 'No'}`);

/**
 * Normalizes a date to YYYY-MM-DD format, supporting multiple input formats.
 * @param {string|Date} date - The date to normalize.
 * @returns {string|null} - Normalized date or null if invalid.
 */
function normalizeDate(date) {
  if (!date) {
    console.warn("normalizeDate: Date is null or undefined");
    return null;
  }

  try {
    let d;
    if (date instanceof Date) {
      d = date;
    } else {
      // Try parsing as ISO format (YYYY-MM-DD) or other common formats
      const isoMatch = String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const usMatch = String(date).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      const shortIsoMatch = String(date).match(/^(\d{4})(\d{2})(\d{2})$/);

      if (isoMatch) {
        d = new Date(date);
      } else if (usMatch) {
        // Handle MM/DD/YYYY format
        d = new Date(`${usMatch[3]}-${usMatch[1]}-${usMatch[2]}`);
      } else if (shortIsoMatch) {
        // Handle YYYYMMDD format
        d = new Date(`${shortIsoMatch[1]}-${shortIsoMatch[2]}-${shortIsoMatch[3]}`);
      } else {
        // Try parsing as a general date string
        d = new Date(date);
      }
    }

    if (isNaN(d.getTime())) {
      console.warn(`normalizeDate: Invalid date format: ${date}`);
      return null;
    }
    return d.toISOString().split('T')[0];
  } catch (e) {
    console.warn(`normalizeDate: Error parsing date: ${date}, Error: ${e.message}`);
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

  const calorieValues = sortedData.map(d => ({ date: d.date, value: d.calories ? d.calories.replace(/[^0-9.]/g, '') : null }));
  console.log("🔍 Calorie data for chart:", calorieValues.filter(v => v.value !== null && v.value !== ""));
  const calorieAverage = computeAverage(calorieValues.map(d => d.value));
  const calorieTrend = calculateTrendSlope(calorieValues);

  // Enhanced logging for workout dates
  console.log("🔍 Raw workout entries:", workouts.map(w => ({ id: w.id, date: w.date })));
  const workoutDates = new Set(
    workouts
      .filter(w => {
        const normalized = normalizeDate(w.date);
        if (!normalized) {
          console.warn(`Skipping workout with invalid date: ${JSON.stringify(w)}`);
        }
        return normalized;
      })
      .map(w => normalizeDate(w.date))
  );
  console.log(`Workout dates available: ${workoutDates.size} unique days`, Array.from(workoutDates));

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
  const workoutAverage = totalDays > 0 ? (daysLogged / totalDays) * 7 : null;
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
    await fetchAllWorkouts();
    await fetchAllExercises();
    await fetchAllRoutines();

    console.log("📂 Reading cache files...");
    const workouts = JSON.parse(fs.readFileSync("data/workouts-30days.json"));
    const templates = JSON.parse(fs.readFileSync("data/exercise_templates.json"));
    const routines = JSON.parse(fs.readFileSync("data/routines.json"));
    console.log(`📂 Cache files read - Workouts: ${workouts.length}, Templates: ${templates.length}, Routines: ${routines.length}`);

    console.log("⚙️ Running autoplan...");
    const autoplanResult = await autoplan({ workouts, templates, routines });
    console.log('autoplanResult in runDailySync.js:', JSON.stringify(autoplanResult));

    let todaysWorkout = autoplanResult?.todaysWorkout;
    console.log('Raw todaysWorkout from autoplanResult:', JSON.stringify(todaysWorkout));

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
    let calorieChartBase;
    try {
      calorieChartBase = await generateCaloriesChart(allMacros);
      console.log("🔍 Calorie chart buffer generated:", calorieChartBase?.buffer ? "Buffer exists" : "Buffer is null");
      // Temporary workaround: Check buffer size and validity
      if (calorieChartBase?.buffer && calorieChartBase.buffer.length < 1000) {
        console.warn("Warning: Calorie chart buffer is suspiciously small. Setting to null as workaround.");
        calorieChartBase.buffer = null;
      }
    } catch (err) {
      console.error("❌ Error generating calorie chart:", err.message);
      calorieChartBase = { buffer: null };
    }

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