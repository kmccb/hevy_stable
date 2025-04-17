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
console.log("🏷️ runDailySync.js Version: v1.5 – Strengthened todaysWorkout validation");

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
      console.log(" skipping email generation during cache priming.");
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
    const weightChart = await generateWeightChart(allMacros);
    const stepsChart = await generateStepsChart(allMacros);
    const macrosChart = await generateMacrosChart(allMacros);
    const calorieChart = await generateCaloriesChart(allMacros);
    console.log("📈 Charts generated successfully");

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