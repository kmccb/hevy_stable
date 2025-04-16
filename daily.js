// daily.js – Reconnected with Google Sheets
const fs = require('fs');
const path = require('path');
const fetchRoutines = require('./fetchRoutines');
const fetchExerciseTemplates = require('./fetchExerciseTemplates');
const fetchRecentWorkouts = require('./fetchRecentWorkouts');
const analyzeHistory = require('./analyzeHistory');
const analyzeLongTermTrends = require('./analyzeLongTermTrends');
const autoplan = require('./autoplan');
const sendEmail = require('./sendEmail');
const generateEmail = require('./generateEmail');
const { getMacrosFromSheet } = require('./sheetsService');

async function runDailySync() {
  try {
    console.log('🔁 Running daily sync...');

    // Step 1: Refresh all cache files
    const workouts = await fetchRecentWorkouts();
    const templates = await fetchExerciseTemplates();
    const routines = await fetchRoutines();
    const trends = analyzeLongTermTrends();

    const historyAnalysis = analyzeHistory(workouts);
    const lastWorkout = workouts[0];

    // Step 2: Build new routine
    const routineResult = await autoplan({ workouts, templates, routines });
    const todaysWorkout = routineResult?.routine?.exercises || [];

    // Step 3: Load yesterday's workout if available
    const yesterdayWorkout = lastWorkout || { title: 'No workout found', exercises: [] };

    // Step 4: Load macros/weight/steps from Google Sheet
    const macroRow = await getMacrosFromSheet();
    const macros = {
      date: macroRow?.date || new Date().toISOString().split("T")[0],
      protein: Number(macroRow?.protein || 0),
      fat: Number(macroRow?.fat || 0),
      carbs: Number(macroRow?.carbs || 0),
      calories: Number(macroRow?.calories || 0)
    };
    const weight = Number(macroRow?.weight || 0);
    const steps = Number(macroRow?.steps || 0);

    // Step 5: Generate and send email
    const emailBody = generateEmail({ macros, weight, steps, yesterdayWorkout, todaysWorkout });
    await sendEmail('🎯 Hevy Daily Summary', emailBody);

    console.log('✅ Daily summary sent!');
  } catch (err) {
    console.error('❌ Daily sync failed:', err.message);
  }
}

if (require.main === module) {
  runDailySync();
}

module.exports = runDailySync;
