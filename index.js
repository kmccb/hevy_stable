const COACH_GPT_VERSION = 'v1.4 – Weekly Split + Recovery + Supersets + Variety';
console.log(`🏷️index.js -  CoachGPT Version: ${COACH_GPT_VERSION}`);

// 1. MODULE IMPORTS
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const fetchAllExercises = require("./exerciseService");
const { getYesterdaysWorkouts } = require("./getYesterdaysWorkouts");
const { generateWeightChart, generateStepsChart, generateMacrosChart, generateCaloriesChart } = require("./chartService");
const fetchAllWorkouts = require("./fetchAllWorkouts");
const analyzeWorkoutHistory = require("./analyzeHistory");
const runDailySync = require("./runDailySync");
const autoplan = require("./autoplan");
const { sanitizeRoutine } = require("./trainerUtils");
const { getQuoteOfTheDay } = require("./quoteUtils");
const fetchEveryWorkout = require('./fetchEveryWorkout');

// 2. CONSTANTS AND CONFIGURATION
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 10000;
const HEVY_API_KEY = process.env.HEVY_API_KEY;
const HEVY_API_BASE = "https://api.hevyapp.com/v1";
const EMAIL_USER = "tomscott2340@gmail.com";
const EMAIL_PASS = process.env.EMAIL_PASS;
const KG_TO_LBS = 2.20462;

app.get('/fetch-all-history', async (req, res) => {
  try {
    await fetchEveryWorkout();
    res.send('✅ Full workout history fetched and saved.');
  } catch (err) {
    console.error('❌ Failed to fetch history:', err.message);
    res.status(500).send('Failed to fetch workout history.');
  }
});

// Startup Cache Loader Section
const cacheFiles = {
  workouts: "data/workouts-30days.json",
  templates: "data/exercise_templates.json",
  routines: "data/routines.json",
};

function ensureCacheFilesExist() {
  for (const [label, filepath] of Object.entries(cacheFiles)) {
    const fullPath = path.join(__dirname, filepath);
    if (!fs.existsSync(fullPath)) {
      console.warn(`⚠️ Cache file missing: ${filepath}. Creating empty file...`);
      fs.writeFileSync(fullPath, JSON.stringify({}));
    } else {
      console.log(`✅ Cache file loaded: ${filepath}`);
    }
  }
}

ensureCacheFilesExist();

const fetchAllRoutines = require('./fetchAllRoutines');

// 9. API ENDPOINTS
app.get("/", (req, res) => res.send("🏋️ CoachGPT Middleware is LIVE on port 10000"));

app.get("/debug", (req, res) => {
  res.send(`🔐 Render sees HEVY_API_KEY as: ${process.env.HEVY_API_KEY || 'undefined'}`);
});

app.get("/debug-workouts", (req, res) => {
  try {
    const filePath = path.join(__dirname, "data", "workouts-30days.json");
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "No workout data file found." });
    }
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    res.json({ count: data.length, sample: data.slice(0, 2) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/refresh-routines', async (req, res) => {
  const result = await fetchAllRoutines();
  if (result.success) {
    res.json({ message: `✅ Routines refreshed (${result.count})` });
  } else {
    res.status(500).json({ error: 'Failed to refresh routines' });
  }
});

app.get("/debug-exercises", (req, res) => {
  const filePath = path.join(__dirname, "data", "exercise_templates.json");
  if (fs.existsSync(filePath)) {
    const contents = fs.readFileSync(filePath, "utf-8");
    res.type("json").send(contents);
  } else {
    res.status(404).json({ error: "exercise_templates.json not found" });
  }
});

app.get("/refresh-exercises", async (req, res) => {
  try {
    const exercises = await fetchAllExercises();
    res.json({ success: true, count: exercises.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/fetch-all", async (req, res) => {
  try {
    const data = await fetchAllWorkouts();
    res.json({ message: "✅ Workouts fetched", count: data.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/refresh-exercises", async (req, res) => {
  try {
    await fetchAllExercises();
    res.json({ message: "✅ Exercise templates refreshed" });
  } catch (error) {
    res.status(500).json({ error: "Failed to refresh exercises" });
  }
});

app.post('/autoplan', async (req, res) => {
  try {
    console.log('⚡ /autoplan called from', new Date().toISOString());
    const workouts = await fetchAllWorkouts();
    const templates = await fetchAllExercises();
    const routines = await fetchAllRoutines();
    console.log('🔁 Running autoplan...');
    const result = await autoplan({ workouts, templates, routines });
    if (result.success) {
      res.json({ message: `${result.message}`, workout: result.routine });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (err) {
    console.error('❌ Error in /autoplan:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/daily", async (req, res) => {
  try {
    console.log("⚡ /daily called from", new Date().toISOString());
    await runDailySync(false); // Main sync, allow email generation
    res.status(200).json({ message: "✅ Daily sync complete" });
  } catch (error) {
    console.error("Daily sync error:", error.message);
    res.status(500).json({ error: `Daily sync failed: ${error.message}` });
  }
});

// 10. SERVER START
(async () => {
  try {
    console.log("⏳ Priming cache...");
    await fetchAllExercises();
    await fetchAllWorkouts();
    await fetchAllRoutines();
    console.log("✅ All cache files ready.");

    // Add a small delay to ensure file I/O is complete
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Run the daily sync at startup, but skip email generation
    await runDailySync(true); // Startup sync, skip email

    // Start server only after everything is ready
    app.listen(PORT, () => {
      console.log(`🏋️ CoachGPT Middleware is LIVE on port ${PORT}`);
    });
  } catch (err) {
    console.error("❌ Startup failed:", err.message || err);
    process.exit(1);
  }
})();