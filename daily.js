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
const generateHtmlSummary = require('./generateEmail');

async function runDailySync() {
  try {
    console.log('🔁 Running daily sync... [daily.js]');

    // Step 1: Refresh all cache files
    const workouts = await fetchRecentWorkouts();
    const templates = await fetchExerciseTemplates();
    const routines = await fetchRoutines();
    const trends = analyzeLongTermTrends();

    const historyAnalysis = analyzeHistory(workouts);
    const trainerInsights = historyAnalysis.progressionAnalysis;
    const lastWorkout = workouts[0];
    
    // Step 2: Build new routine
    const routineResult = await autoplan({ workouts, templates, routines });
    // Use the full routine object, not just exercises
    const todaysWorkout = routineResult?.routine || { title: 'Rest Day', exercises: [] };
    console.log('todaysWorkout after autoplan in daily.js:', JSON.stringify(todaysWorkout));

    // Step 3: Load yesterday's workout if available
    const yesterdayWorkout = lastWorkout || { title: 'No workout found', exercises: [] };

    // Step 4: Load macros/weight/steps from Google Sheet
    const macroRow = await getMacrosFromSheet();
    const macros = {
      date: macroRow?.date || new Date().toISOString().split("T")[0],
      protein: Number(macroRow?.protein || 0),
      fat: Number(macroRow?.fat || 0),
      carbs: Number(macroRow?.carbs || 0),
      calories: Number(macroRow?.calories || 0),
      weight: Number(macroRow?.weight || 0), // Added missing fields
      steps: Number(macroRow?.steps || 0)
    };

    // Step 5: Generate and send email
    const charts = {}; // ⏳ Placeholder if charts aren't implemented yet
    const quoteText = "“Without struggle, no progress and no result. Every breaking of habit produces a change in the machine.” – G.I. Gurdjieff";
    const emailBody = generateHtmlSummary(
      [yesterdayWorkout], // workouts (1-day history for "Yesterday's Workout")
      macros,
      [], // allMacrosData (for trend calc – can be empty if not fetched yet)
      trainerInsights,
      "TBD", // todayTargetDay (can be split name like "Pull" later)
      charts,
      todaysWorkout, // Pass the full routine object
      quoteText
    );

    await sendEmail('🎯 Hevy Daily Summary', emailBody);

    console.log('✅ Daily summary sent!');
  } catch (err) {
    console.error('❌ Daily.js - Daily sync failed:', err.message);
  }
}

if (require.main === module) {
  runDailySync();
}

module.exports = runDailySync;