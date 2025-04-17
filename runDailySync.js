const autoplan = require("./autoplan");
const fetchAllWorkouts = require("./fetchAllWorkouts");
const fetchAllExercises = require("./exerciseService");
const fetchAllRoutines = require("./fetchAllRoutines");

const fs = require("fs");
const axios = require("axios");
const { getYesterdaysWorkouts } = require("./getYesterdaysWorkouts");
const { getMacrosFromSheet, getAllMacrosFromSheet } = require("./sheetsService");
const { generateWeightChart, generateStepsChart, generateMacrosChart, generateCaloriesChart } = require("./chartService");
const generateHtmlSummary = require("./generateEmail");
const transporter = require("./transporter");
const { analyzeWorkouts } = require("./trainerUtils");

const { EMAIL_USER } = process.env;

// Add a version log to confirm this file is loaded
console.log("🏷️ runDailySync.js Version: v1.1 – Added isCachePriming logic");

async function runDailySync(isCachePriming = false) {
  try {
    console.log(`🔁 Running daily sync... [runDailySync.js] (isCachePriming: ${isCachePriming})`);

    await fetchAllExercises();
    await fetchAllWorkouts();
    await fetchAllRoutines();

    const workouts = JSON.parse(fs.readFileSync("data/workouts-30days.json"));
    const templates = JSON.parse(fs.readFileSync("data/exercise_templates.json"));
    const routines = JSON.parse(fs.readFileSync("data/routines.json"));

    const autoplanResult = await autoplan({ workouts, templates, routines });
    console.log('autoplanResult in runDailySync.js:', JSON.stringify(autoplanResult));

    // Ensure todaysWorkout has a title and exercises
    let todaysWorkout = autoplanResult?.routine?.routine?.[0];
    if (!todaysWorkout || typeof todaysWorkout !== 'object') {
      console.warn("Warning: todaysWorkout is invalid after autoplan. Using fallback.");
      todaysWorkout = { title: "Rest Day", exercises: [] };
    } else if (!todaysWorkout.title) {
      console.warn("Warning: todaysWorkout is missing a title. Adding fallback title.");
      todaysWorkout.title = "CoachGPT – Planned Workout";
    }
    console.log('todaysWorkout after autoplan in runDailySync.js:', JSON.stringify(todaysWorkout));

    // Skip email generation during cache priming or if todaysWorkout is invalid
    if (isCachePriming) {
      console.log("Skipping email generation during cache priming.");
      return;
    }

    if (!todaysWorkout.title || !todaysWorkout.exercises?.length) {
      console.warn("Skipping email generation: todaysWorkout is not fully populated:", JSON.stringify(todaysWorkout));
      return;
    }

    const recentWorkouts = await getYesterdaysWorkouts();
    const macros = await getMacrosFromSheet();
    if (!macros) throw new Error("No macros found for yesterday.");

    const allMacros = await getAllMacrosFromSheet();

    const weightChart = await generateWeightChart(allMacros);
    const stepsChart = await generateStepsChart(allMacros);
    const macrosChart = await generateMacrosChart(allMacros);
    const calorieChart = await generateCaloriesChart(allMacros);

    const trainerInsights = recentWorkouts.length === 0 ? [] : analyzeWorkouts(recentWorkouts);

    const lastDay = recentWorkouts.find(w => w.title.includes("Day"))?.title.match(/Day (\d+)/);
    const todayDayNumber = lastDay ? parseInt(lastDay[1]) + 1 : 1;

    // ✨ ZenQuotes Only
    let quoteText = "“You are stronger than you think.” – CoachGPT";
    try {
      const res = await axios.get('https://zenquotes.io/api/today');
      const quote = res.data[0];
      quoteText = `“${quote.q}” – ${quote.a}`;
    } catch (err) {
      console.warn("❌ ZenQuote fetch failed, using fallback:", err.message);
    }

    const html = generateHtmlSummary(
      recentWorkouts,
      macros,
      allMacros,
      trainerInsights,
      todayDayNumber > 7 ? 1 : todayDayNumber,
      {
        weightChart,
        stepsChart,
        macrosChart,
        calorieChart
      },
      todaysWorkout,
      quoteText
    );

    await transporter.sendMail({
      from: EMAIL_USER,
      to: EMAIL_USER,
      subject: `🎯 Hevy Daily Summary (${macros.date})`,
      html,
      attachments: [
        { filename: "weight.png", content: weightChart.buffer, cid: "weightChart" },
        { filename: "steps.png", content: stepsChart.buffer, cid: "stepsChart" },
        { filename: "macros.png", content: macrosChart.buffer, cid: "macrosChart" },
        { filename: "calories.png", content: calorieChart.buffer, cid: "caloriesChart" }
      ]
    });

    console.log("✅ Daily summary sent!");
  } catch (err) {
    console.error("❌ runDailySync.js - Daily sync failed:", err.message || err);
    throw err; // Rethrow to ensure the error is visible in the caller
  }
}

module.exports = runDailySync;