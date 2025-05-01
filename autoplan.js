const COACH_GPT_VERSION = 'v1.5 – Balanced pull exercises';
console.log(`🏷️ autoplan.js - CoachGPT Version: ${COACH_GPT_VERSION}`);

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const getNextSplit = require('./getNextSplit');
require('dotenv').config();
const getWeeklyTargetSplit = require('./getWeeklyTargetSplit');
const filterForVariety = require('./filterForVariety');

const API_KEY = process.env.HEVY_API_KEY;
const BASE_URL = 'https://api.hevyapp.com/v1';
const headers = { 'api-key': API_KEY };
const KG_TO_LBS = 2.20462;

const muscleTargets = {
  Push: ['Chest', 'Shoulders', 'Triceps'],
  Pull: ['Lats', 'Upper Back', 'Biceps', 'Rear Delts'],
  Legs: ['Quads', 'Hamstrings', 'Glutes', 'Calves'],
  Core: ['Abdominals', 'Obliques', 'Full Body', 'Lower Back'],
  Cardio: ['Cardio'],
  Abs: ['Abdominals', 'Obliques']
};

const muscleToWorkoutType = {
  chest: 'Push',
  shoulders: 'Push',
  triceps: 'Push',
  lats: 'Pull',
  upper_back: 'Pull',
  biceps: 'Pull',
  rear_delts: 'Pull',
  quads: 'Legs',
  hamstrings: 'Legs',
  glutes: 'Legs',
  calves: 'Legs',
  cardio: 'Cardio',
  full_body: 'Legs'
};

const excludedExercises = new Set([
  "Deadlift (Barbell)", "Deadlift (Dumbbell)", "Deadlift (Smith Machine)", "Deadlift (Trap Bar)",
  "Romanian Deadlift (Barbell)", "Romanian Deadlift (Dumbbell)",
  "Good Morning (Barbell)"
]);

const LAST_SCHEDULED_FILE = path.join(__dirname, 'data', 'last_scheduled.json');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function readLastScheduled() {
  if (fs.existsSync(LAST_SCHEDULED_FILE)) {
    return JSON.parse(fs.readFileSync(LAST_SCHEDULED_FILE, 'utf-8'));
  }
  return { workoutType: null, date: null };
}

function writeLastScheduled(workoutType, date) {
  fs.writeFileSync(LAST_SCHEDULED_FILE, JSON.stringify({ workoutType, date: date.toISOString() }));
}

async function makeApiRequestWithRetry(method, url, data = null, headers = {}, maxAttempts = 5, baseDelayMs = 2000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const config = { method, url, headers };
      if (data) config.data = data;
      const response = await axios(config);
      return response;
    } catch (err) {
      const status = err.response?.status;
      const isRateLimit = status === 429;
      const isServerError = status >= 500;
      if (attempt === maxAttempts || (!isServerError && !isRateLimit)) {
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      const reason = isRateLimit ? 'Rate limit' : 'Server error';
      console.warn(`⏳ Retrying after ${delay}ms due to ${reason} (Attempt ${attempt}/${maxAttempts})...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

let exerciseTemplates = [];
let historyAnalysis = null;

function analyzeHistory(workouts) {
  // Ensure we only analyze the last 30 workouts
  const recentWorkouts = workouts.slice(0, 30);
  const recentTitles = new Set();
  const muscleGroupFrequency = {};
  const exerciseFrequency = {};
  const absMetrics = { totalSessions: 0, exercises: new Set(), totalSets: 0 };
  const progressionData = {};
  // Track weekly split frequency (Push, Pull, Legs, Core)
  const weeklySplitFrequency = { Push: 0, Pull: 0, Legs: 0, Core: 0 };

  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  for (const workout of recentWorkouts) {
    let hasAbs = false;
    const workoutDate = new Date(workout.start_time);
    const isRecent = workoutDate >= oneDayAgo;
    const isThisWeek = workoutDate >= oneWeekAgo;

    // Determine the split type of the workout
    let workoutSplit = null;
    for (const exercise of workout.exercises) {
      const template = exerciseTemplates.find(t => t.id === exercise.exercise_template_id);
      if (template) {
        const primaryMuscle = template.primary_muscle_group.toLowerCase();
        if (['chest', 'shoulders', 'triceps'].some(m => primaryMuscle.includes(m))) workoutSplit = 'Push';
        else if (['lats', 'upper_back', 'biceps', 'rear_delts'].some(m => primaryMuscle.includes(m))) workoutSplit = 'Pull';
        else if (['quads', 'hamstrings', 'glutes', 'calves', 'full_body'].some(m => primaryMuscle.includes(m))) workoutSplit = 'Legs';
        else if (['abdominals', 'obliques', 'core', 'lower_back'].some(m => primaryMuscle.includes(m))) workoutSplit = 'Core';
      }
    }

    if (isThisWeek && workoutSplit) {
      weeklySplitFrequency[workoutSplit]++;
    }

    for (const exercise of workout.exercises) {
      if (isRecent) {
        recentTitles.add(exercise.title);
      }

      const template = exerciseTemplates.find(t => t.id === exercise.exercise_template_id);
      if (template) {
        const primaryMuscle = template.primary_muscle_group.toLowerCase();
        muscleGroupFrequency[primaryMuscle] = (muscleGroupFrequency[primaryMuscle] || 0) + 1;

        if (primaryMuscle.includes('abdominals') || primaryMuscle.includes('obliques')) {
          hasAbs = true;
          absMetrics.exercises.add(exercise.title);
          absMetrics.totalSets += exercise.sets.length;
        }

        exerciseFrequency[exercise.title] = (exerciseFrequency[exercise.title] || 0) + 1;

        if (!progressionData[exercise.title]) {
          progressionData[exercise.title] = [];
        }
        exercise.sets.forEach(set => {
          if (set.weight_kg != null && set.reps != null) {
            const weight_lbs = set.weight_kg * KG_TO_LBS;
            progressionData[exercise.title].push({
              date: workout.start_time,
              weight_kg: set.weight_kg,
              weight_lbs: weight_lbs,
              reps: set.reps,
              volume: weight_lbs * set.reps
            });
          }
        });
      }
    }
    if (hasAbs) absMetrics.totalSessions++;
  }

  const progressionAnalysis = {};
  for (const [title, sets] of Object.entries(progressionData)) {
    if (sets.length >= 2) {
      const lastSet = sets[sets.length - 1];
      const secondLastSet = sets[sets.length - 2];
      const volumeChange = lastSet.volume - secondLastSet.volume;
      let suggestion = "Maintain or increase reps";
      if (volumeChange > 0) {
        const newWeightLbs = lastSet.weight_lbs * 1.05;
        suggestion = `Increase weight to ${newWeightLbs.toFixed(1)} lbs`;
      } else if (lastSet.reps >= 10) {
        const newWeightLbs = lastSet.weight_lbs * 1.05;
        suggestion = `Try increasing weight to ${newWeightLbs.toFixed(1)} lbs`;
      }
      progressionAnalysis[title] = {
        lastWeightLbs: lastSet.weight_lbs.toFixed(1),
        lastReps: lastSet.reps,
        volumeChange: volumeChange,
        suggestion: suggestion
      };
    }
  }

  return {
    recentTitles,
    muscleGroupFrequency,
    exerciseFrequency,
    absMetrics,
    progressionAnalysis,
    weeklySplitFrequency
  };
}

function determineWorkoutTypeByLastHit(workouts = [], exerciseTemplates = []) {
  const splitMap = {
    Push: ['chest', 'shoulders', 'triceps'],
    Pull: ['lats', 'upper_back', 'biceps', 'rear_delts'],
    Legs: ['quads', 'hamstrings', 'glutes', 'calves', 'full_body'],
    Core: ['abdominals', 'obliques', 'core', 'lower_back']
  };

  const lastHit = {
    Push: null,
    Pull: null,
    Legs: null,
    Core: null
  };

  for (const workout of workouts) {
    const workoutDate = new Date(workout.start_time);
    const splitsTouched = new Set();

    for (const exercise of workout.exercises) {
      const template = exerciseTemplates.find(t => t.id === exercise.exercise_template_id);
      if (!template) continue;

      const muscle = (template.primary_muscle_group || '').toLowerCase();
      for (const [split, muscles] of Object.entries(splitMap)) {
        if (muscles.some(m => muscle.includes(m))) {
          splitsTouched.add(split);
        }
      }
    }

    for (const split of splitsTouched) {
      if (!lastHit[split] || workoutDate > lastHit[split]) {
        lastHit[split] = workoutDate;
      }
    }
  }

  const now = new Date();
  const splitAges = Object.entries(lastHit).map(([split, date]) => {
    const daysAgo = date ? Math.floor((now - date) / (1000 * 60 * 60 * 24)) : 99;
    return { split, daysAgo };
  });

  // Get weekly split frequency from history analysis
  const { weeklySplitFrequency } = historyAnalysis;

  // Prioritize splits that haven't been hit this week
  const splitsNotHitThisWeek = Object.keys(weeklySplitFrequency).filter(split => weeklySplitFrequency[split] === 0);
  if (splitsNotHitThisWeek.length > 0) {
    const chosenSplit = splitsNotHitThisWeek[0]; // Pick the first one (e.g., Pull in your case)
    console.log(`📅 Smart Split: ${chosenSplit} (not hit this week)`);
    return chosenSplit;
  }

  // If all splits have been hit this week, prioritize the least frequent split in the last 30 workouts
  const splitFrequencies = Object.entries(weeklySplitFrequency).map(([split, freq]) => ({ split, freq }));
  splitFrequencies.sort((a, b) => a.freq - b.freq); // Least frequent first
  const leastFrequentSplit = splitFrequencies[0].split;
  
  // Ensure we don't repeat a split within 3 days unless necessary
  const recentSplits = splitAges.filter(s => s.daysAgo < 3).map(s => s.split);
  if (!recentSplits.includes(leastFrequentSplit)) {
    console.log(`📅 Smart Split: ${leastFrequentSplit} (least frequent this week, not hit in last 3 days)`);
    return leastFrequentSplit;
  }

  // If all options are recent, pick the most overdue
  splitAges.sort((a, b) => b.daysAgo - a.daysAgo); // Most overdue first
  const chosen = splitAges[0];
  console.log(`📅 Smart Split: ${chosen.split} (last hit ${chosen.daysAgo} days ago)`);
  return chosen.split;
}

function pickExercises(workouts, templates, muscleGroups, recentTitles, progressionAnalysis, varietyFilter, numExercises = 6) {
  const usedTitles = new Set();
  const selectedExercises = [];

  const sortedMuscleGroups = ['Lats', ...muscleGroups.filter(m => m !== 'Lats')];
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const isLegDay = muscleGroups.some(m =>
    ['quads', 'glutes', 'hamstrings', 'calves'].includes(m.toLowerCase())
  );

  const legMuscleGroups = ['quads', 'glutes', 'hamstrings', 'calves'];
  const legKeywords = [
    'press', 'squat', 'lunge', 'extension', 'curl',
    'deadlift', 'rdl', 'step up', 'hip thrust', 'glute bridge', 'calf'
  ];

  const isRealLegExercise = (template) => {
    const title = (template.title || '').toLowerCase();
    const muscle = (template.primary_muscle_group || '').toLowerCase();
    return legKeywords.some(k => title.includes(k)) &&
           legMuscleGroups.some(m => muscle.includes(m));
  };

  const isCoreDay = muscleGroups.every(m =>
    ['abdominals', 'obliques', 'core'].includes(m.toLowerCase())
  );

  const coreKeywords = [
    'crunch', 'plank', 'sit up', 'knee raise', 'leg raise', 'dead bug',
    'ab wheel', 'jackknife', 'russian twist', 'scissors', 'cable crunch',
    'v-up', 'dragon flag', 'woodchopper', 'side bend', 'twist', 'hollow hold'
  ];

  const isGoodCoreExercise = (t) => {
    const title = (t.title || '').toLowerCase();
    const muscle = (t.primary_muscle_group || '').toLowerCase();
    return (
      ['abdominals', 'obliques', 'core'].some(m => muscle.includes(m)) &&
      coreKeywords.some(k => title.includes(k))
    );
  };

  const desiredNumExercises = isCoreDay ? 8 : numExercises;

  for (let i = 0; i < sortedMuscleGroups.length && selectedExercises.length < desiredNumExercises; i++) {
    const muscle = sortedMuscleGroups[i % sortedMuscleGroups.length];

    let candidates = templates.filter(t => {
      const primaryMatch = (t.primary_muscle_group || '').toLowerCase().includes(muscle.toLowerCase());
      let isRecent = recentTitles.has(t.title);
      if (workouts && workouts.length > 0) {
        const lastUsed = workouts.find(w => w.exercises.some(e => e.title === t.title))?.start_time;
        isRecent = lastUsed && new Date(lastUsed) > sevenDaysAgo;
      }
      return primaryMatch && !usedTitles.has(t.title) && varietyFilter(t) && !isRecent;
    });

    if (isLegDay && legMuscleGroups.includes(muscle.toLowerCase())) {
      candidates = candidates.filter(isRealLegExercise);
      if (candidates.length === 0) {
        console.log(`❌ No heavy match for ${muscle} — searching all real leg exercises.`);
        candidates = templates.filter(t =>
          isRealLegExercise(t) && !usedTitles.has(t.title) && varietyFilter(t)
        );
      }
    }

    if (isCoreDay) {
      candidates = candidates.filter(isGoodCoreExercise);
      if (candidates.length === 0) {
        candidates = templates.filter(t =>
          isGoodCoreExercise(t) && !usedTitles.has(t.title) && varietyFilter(t)
        );
      }
    }

    if (candidates.length > 0) {
      const nonBicep = candidates.filter(t => !(t.primary_muscle_group || '').toLowerCase().includes('biceps'));
      const finalCandidates = nonBicep.length > 0 && muscle !== 'Biceps' ? nonBicep : candidates;

      const usedEquipment = new Set(selectedExercises.map(ex => ex.equipment));
      finalCandidates.sort((a, b) => {
        const aNew = usedEquipment.has(a.equipment) ? 1 : 0;
        const bNew = usedEquipment.has(b.equipment) ? 1 : 0;
        return aNew - bNew;
      });

      const selected = finalCandidates[0];
      const progression = progressionAnalysis[selected.title];
      const note = progression
        ? `${progression.suggestion} (last: ${progression.lastWeightLbs} lbs x ${progression.lastReps} reps)`
        : "Start moderate and build";

      console.log(`✅ Selected: ${selected.title} (Muscle: ${muscle}, Equipment: ${selected.equipment}, Note: ${note})`);
      selectedExercises.push({ ...selected, note });
      usedTitles.add(selected.title);
    } else {
      console.log(`⚠️ No usable template for ${muscle}, even after all fallback attempts.`);
    }
  }

  while (selectedExercises.length < desiredNumExercises) {
    const fill = templates.filter(t =>
      !usedTitles.has(t.title) &&
      varietyFilter(t) &&
      (!isCoreDay || isGoodCoreExercise(t))
    );

    if (fill.length === 0) break;

    const selected = fill[0];
    const progression = progressionAnalysis[selected.title];
    const note = progression
      ? `${progression.suggestion} (last: ${progression.lastWeightLbs} lbs x ${progression.lastReps} reps)`
      : "Finish strong";

    console.log(`➕ Added filler: ${selected.title}`);
    selectedExercises.push({ ...selected, note });
    usedTitles.add(selected.title);
  }

  return selectedExercises;
}

function pickAbsExercises(workouts, templates, recentTitles, numExercises = 3) {
  const absMuscles = ['abdominals', 'obliques'];
  const selectedExercises = [];
  const usedTitles = new Set();

  const priorityExercises = [
    { muscle: 'abdominals', note: "Focus on slow reps", mustHave: ['crunch', 'raise', 'sit up', 'leg raise', 'v-up', 'jackknife'] },
    { muscle: 'obliques', note: "Controlled twists", mustHave: ['twist', 'side plank', 'woodchopper', 'russian', 'side bend', 'scissors'] },
    { muscle: 'abdominals', note: "Isometric hold", mustHave: ['plank', 'hold', 'dead bug', 'hollow', 'l-sit', 'dragon flag'] }
  ];

  const fiveDaysAgo = new Date();
  fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

  for (let i = 0; i < numExercises; i++) {
    const { muscle, note, mustHave } = priorityExercises[i % priorityExercises.length];
    let candidates = templates.filter(t => {
      const primaryMatch = t.primary_muscle_group?.toLowerCase().includes(muscle);
      const titleMatch = mustHave.some(k => t.title.toLowerCase().includes(k));
      let isRecent = recentTitles.has(t.title);
      if (workouts && workouts.length > 0) {
        const lastUsed = workouts.find(w => w.exercises.some(e => e.title === t.title))?.start_time;
        isRecent = lastUsed && new Date(lastUsed) > fiveDaysAgo;
      }
      return primaryMatch && titleMatch && !usedTitles.has(t.title) && !isRecent;
    });

    if (candidates.length === 0) {
      console.log(`⚠️ No specific abs template found for ${muscle}. Falling back to any abs exercise.`);
      candidates = templates.filter(t => {
        const primaryMatch = t.primary_muscle_group?.toLowerCase().includes('abdominals') || t.primary_muscle_group?.toLowerCase().includes('obliques');
        let isRecent = recentTitles.has(t.title);
        if (workouts && workouts.length > 0) {
          const lastUsed = workouts.find(w => w.exercises.some(e => e.title === t.title))?.start_time;
          isRecent = lastUsed && new Date(lastUsed) > fiveDaysAgo;
        }
        return primaryMatch && !usedTitles.has(t.title) && !isRecent;
      });
    }

    if (candidates.length > 0) {
      const selected = candidates[Math.floor(Math.random() * candidates.length)];
      console.log(`✅ Selected Abs: ${selected.title} (Muscle: ${muscle})`);
      selectedExercises.push({ ...selected, note });
      usedTitles.add(selected.title);
    } else {
      console.log(`⚠️ No abs template found for ${muscle} even after fallback.`);
    }
  }

  return selectedExercises;
}

function buildRoutinePayload(workoutType, exercises, absExercises) {
  const validExercises = exercises.filter(ex => ex.id && typeof ex.id === 'string');
  const validAbsExercises = absExercises.filter(ex => ex.id && typeof ex.id === 'string');

  console.log(`🔍 Valid main exercises: ${validExercises.map(ex => ex.title).join(', ') || 'None'}`);
  console.log(`🔍 Valid abs exercises: ${validAbsExercises.map(ex => ex.title).join(', ') || 'None'}`);

  if (validExercises.length === 0 && validAbsExercises.length === 0) {
    throw new Error('No valid exercises to create routine');
  }

  const findSimilarExerciseWeight = (exercise, progressionAnalysis) => {
    const progression = progressionAnalysis[exercise.title];
    if (progression?.suggestion.includes("Increase weight to")) {
      return parseFloat(progression.suggestion.match(/Increase weight to (\d+\.\d+)/)[1]) / KG_TO_LBS;
    }
    if (progression) return parseFloat(progression.lastWeightLbs) / KG_TO_LBS;

    const primaryMuscle = exercise.primary_muscle_group?.toLowerCase();
    const equipment = exercise.equipment?.toLowerCase();
    for (const [title, p] of Object.entries(historyAnalysis.progressionAnalysis)) {
      const template = exerciseTemplates.find(t => t.title === title);
      if (template &&
          template.primary_muscle_group?.toLowerCase() === primaryMuscle &&
          template.equipment?.toLowerCase() === equipment) {
        if (p.suggestion.includes("Increase weight to")) {
          return parseFloat(p.suggestion.match(/Increase weight to (\d+\.\d+)/)[1]) / KG_TO_LBS;
        }
        return parseFloat(p.lastWeightLbs) / KG_TO_LBS;
      }
    }
    if (equipment === 'resistance_band') return 10;
    if (equipment === 'dumbbell') return 10;
    if (equipment === 'barbell') return 20;
    if (equipment === 'machine') return 15;
    return 0;
  };

  const isDurationBased = ex => {
    const titleLower = ex.title.toLowerCase();
    const isAbs = ex.primary_muscle_group?.toLowerCase().includes('abdominals') ||
                  ex.primary_muscle_group?.toLowerCase().includes('obliques');
    const isBodyweight = !ex.equipment || ex.equipment.toLowerCase() === 'none';
    const durationKeywords = ['plank', 'hold', 'dead bug', 'side bridge', 'wall sit', 'hanging', 'isometric', 'static', 'bridge', 'superman', 'bird dog', 'l-sit'];
    return durationKeywords.some(k => titleLower.includes(k)) ||
           (isAbs && isBodyweight && !titleLower.includes('crunch') && !titleLower.includes('twist'));
  };

  const routinePayload = {
    title: `CoachGPT – ${workoutType} + Abs`,
    notes: "Core focus + stability + abs finishers. Push your pace 💥",
    exercises: []
  };

  const allExercises = [];
  const usedExerciseIds = new Set();

  const supersetPairs = Math.min(validExercises.length, validAbsExercises.length, 3);
  for (let i = 0; i < supersetPairs; i++) {
    if (i >= validExercises.length || i >= validAbsExercises.length) break;
    const strength = validExercises[i];
    const abs = validAbsExercises[i];
    const supersetId = i;

    const strengthWeight = findSimilarExerciseWeight(strength, historyAnalysis.progressionAnalysis);
    const absWeight = findSimilarExerciseWeight(abs, historyAnalysis.progressionAnalysis);

    const strengthSets = isDurationBased(strength) ? Array(3).fill({ type: 'normal', duration_seconds: 45, weight_kg: 0 }) :
      Array(3).fill({ type: 'normal', reps: 8, weight_kg: strengthWeight });

    const absSets = isDurationBased(abs) ? Array(3).fill({ type: 'normal', duration_seconds: 45, weight_kg: 0 }) :
      Array(3).fill({ type: 'normal', reps: 10, weight_kg: absWeight });

    allExercises.push(
      {
        exercise_template_id: strength.id,
        superset_id: supersetId,
        rest_seconds: 30,
        notes: `Superset with: ${abs.title}`,
        sets: strengthSets
      },
      {
        exercise_template_id: abs.id,
        superset_id: supersetId,
        rest_seconds: 30,
        notes: `Superset with: ${strength.title}`,
        sets: absSets
      }
    );

    usedExerciseIds.add(strength.id);
    usedExerciseIds.add(abs.id);
  }

  const remainingStrengths = validExercises.filter(ex => !usedExerciseIds.has(ex.id)).slice(0, 2);
  for (const ex of remainingStrengths) {
    const weight = findSimilarExerciseWeight(ex, historyAnalysis.progressionAnalysis);
    const sets = isDurationBased(ex) ? Array(3).fill({ type: 'normal', duration_seconds: 45, weight_kg: 0 }) :
      Array(3).fill({ type: 'normal', reps: 8, weight_kg: weight });

    allExercises.push({
      exercise_template_id: ex.id,
      superset_id: null,
      rest_seconds: 90,
      notes: "Finisher – go all in 💪",
      sets
    });

    usedExerciseIds.add(ex.id);
    if (allExercises.length >= 7) break;
  }

  const remainingAbs = validAbsExercises.filter(ex => !usedExerciseIds.has(ex.id)).slice(0, 1);
  for (const abs of remainingAbs) {
    const absWeight = findSimilarExerciseWeight(abs, historyAnalysis.progressionAnalysis);
    const sets = isDurationBased(abs) ? Array(3).fill({ type: 'normal', duration_seconds: 45, weight_kg: 0 }) :
      Array(3).fill({ type: 'normal', reps: 10, weight_kg: absWeight });

    allExercises.push({
      exercise_template_id: abs.id,
      superset_id: null,
      rest_seconds: 60,
      notes: "Abs finisher – controlled reps",
      sets
    });

    usedExerciseIds.add(abs.id);
    if (allExercises.length >= 8) break;
  }

  if (allExercises.length < 6) {
    const extra = validExercises.concat(validAbsExercises)
      .filter(ex => !usedExerciseIds.has(ex.id))
      .slice(0, 6 - allExercises.length);
    for (const ex of extra) {
      const weight = findSimilarExerciseWeight(ex, historyAnalysis.progressionAnalysis);
      const sets = isDurationBased(ex) ? Array(3).fill({ type: 'normal', duration_seconds: 45, weight_kg: 0 }) :
        Array(3).fill({ type: 'normal', reps: 10, weight_kg: weight });
      allExercises.push({
        exercise_template_id: ex.id,
        superset_id: null,
        rest_seconds: 60,
        notes: "Extra – controlled reps",
        sets
      });
      usedExerciseIds.add(ex.id);
      if (allExercises.length >= 8) break;
    }
  }

  if (allExercises.length > 8) {
    allExercises.length = 8;
    console.warn("⚠️ Routine trimmed to 8 exercises.");
  }

  const deduped = [];
  const seenIds = new Set();
  for (const ex of allExercises) {
    if (!seenIds.has(ex.exercise_template_id)) {
      deduped.push(ex);
      seenIds.add(ex.exercise_template_id);
    } else {
      console.warn(`⚠️ Duplicate detected and removed: ${ex.exercise_template_id}`);
    }
  }
  routinePayload.exercises = deduped;

  const payloadTest = { routine: routinePayload };
  console.log("📦 Payload length:", JSON.stringify(payloadTest).length, "chars");
  console.log("📦 Exercise summary:", routinePayload.exercises.map(e => ({
    template_id: e.exercise_template_id,
    superset: e.superset_id,
    sets: e.sets.length,
    rest: e.rest_seconds
  })));

  return routinePayload;
}

async function createRoutine(workoutType, exercises, absExercises) {
  const routinePayload = buildRoutinePayload(workoutType, exercises, absExercises);

  delete routinePayload.routine_folder_id;
  delete routinePayload.folder_id;

  const payload = { routine: routinePayload };
  console.log("📦 Payload length:", JSON.stringify(payload).length, "chars");
  console.log("📦 Exercise summary:", routinePayload.exercises.map(e => ({
    template_id: e.exercise_template_id,
    superset: e.superset_id,
    sets: e.sets.length,
    rest: e.rest_seconds
  })));

  try {
    const response = await makeApiRequestWithRetry('post', `${BASE_URL}/routines`, payload, headers);
    console.log('📥 Routine API response (create):', JSON.stringify(response.data, null, 2));
    const routineTitle = response.data?.routine?.title || response.data?.title || routinePayload.title;
    console.log(`Routine created: ${routineTitle}`);
    return response.data;
  } catch (err) {
    console.error('❌ Failed to create routine:', err.response?.data || err.message);
    throw err;
  }
}

async function validateRoutineId(routineId) {
  return true;
}

async function updateRoutine(routineId, workoutType, exercises, absExercises) {
  const routinePayload = buildRoutinePayload(workoutType, exercises, absExercises);

  console.log(`🔍 First exercise in payload: ${routinePayload.exercises[0]?.exercise_template_id} (Title: ${exercises[0]?.title || absExercises[0]?.title})`);

  const payload = { routine: routinePayload };

  let updateAttempts = 5;
  let backoff = 2000;
  for (let attempt = 1; attempt <= updateAttempts; attempt++) {
    try {
      const response = await makeApiRequestWithRetry('put', `${BASE_URL}/routines/${routineId}`, payload, headers, 3, 1000);
      const routineTitle = response.data?.routine?.title || response.data?.title || routinePayload.title;
      console.log(`✅ Routine updated: ${routineTitle} (ID: ${routineId})`);
      return Array.isArray(response.data) ? response.data[0] : (response.data.routine || response.data);
    } catch (err) {
      console.error(`❌ Attempt ${attempt}/${updateAttempts} - Failed to update routine (ID: ${routineId}):`, err.response?.data || err.message);
      if (attempt === updateAttempts) {
        console.error('❌ All update attempts failed. Throwing error to prevent creating a new routine.');
        throw new Error(`Failed to update routine (ID: ${routineId}) after ${updateAttempts} attempts: ${err.response?.data || err.message}`);
      }
      const delay = backoff * Math.pow(2, attempt - 1);
      console.log(`⏳ Retrying update after ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

async function refreshRoutines() {
  try {
    let allRoutines = [];
    let page = 1;
    let pageCount = 1;

    while (page <= pageCount) {
      console.log(`📃 Fetching routines page ${page} of ${pageCount}...`);
      const response = await makeApiRequestWithRetry('get', `${BASE_URL}/routines?page=${page}`, null, headers);
      const routines = response.data.routines;
      pageCount = response.data.page_count || 1;
      if (!Array.isArray(routines)) {
        throw new Error('Expected an array of routines, but received: ' + JSON.stringify(routines));
      }
      allRoutines.push(...routines);
      console.log(`📃 Retrieved ${routines.length} routines from page ${page}`);
      page++;
    }

    console.log(`🔍 Total routines retrieved: ${allRoutines.length}`);

    const validRoutines = [];
    for (const routine of allRoutines) {
      if (routine.id && routine.title && typeof routine.title === 'string') {
        const isValid = await validateRoutineId(routine.id);
        if (isValid) {
          validRoutines.push(routine);
        }
      }
    }

    if (allRoutines.length !== validRoutines.length) {
      console.warn(`⚠️ Filtered out ${allRoutines.length - validRoutines.length} invalid routines`);
    }

    fs.writeFileSync('data/routines.json', JSON.stringify(validRoutines, null, 2));
    console.log('✅ Refreshed routines.json');
    return validRoutines;
  } catch (error) {
    console.error('❌ Error refreshing routines:', error.message, error.response?.data || '');
    throw error;
  }
}

async function autoplan({ workouts, templates, routines }) {
  try {
    exerciseTemplates = templates.filter(t => !excludedExercises.has(t.title));
    historyAnalysis = analyzeHistory(workouts || []); // Now processes last 30 workouts and tracks weekly splits
    const varietyFilter = filterForVariety(workouts || []);
    const lastCompletedWorkout = workouts && workouts.length > 0 ? workouts[0] : null;
    const workoutType = determineWorkoutTypeByLastHit(workouts, exerciseTemplates); // Now prioritizes Pull

    const muscleGroups = muscleTargets[workoutType];
    console.log("🧠 Split selected:", workoutType);

    if (!muscleGroups || !Array.isArray(muscleGroups)) {
      throw new Error(`❌ Invalid workoutType or missing muscle groups for: ${workoutType}`);
    }

    const today = new Date();
    writeLastScheduled(workoutType, today);

    let updatedRoutines;
    try {
      updatedRoutines = await refreshRoutines();
    } catch (err) {
      console.warn('⚠️ Failed to refresh routines. Falling back to initial routines data and cache file.');
      updatedRoutines = routines;
      try {
        const routinesFilePath = path.join(__dirname, 'data', 'routines.json');
        if (fs.existsSync(routinesFilePath)) {
          const cachedRoutines = JSON.parse(fs.readFileSync(routinesFilePath, 'utf-8'));
          console.log('🔍 Loaded routines from cache file:', JSON.stringify(cachedRoutines, null, 2));
          updatedRoutines = cachedRoutines;
        } else {
          console.warn('⚠️ No routines cache file found at data/routines.json');
        }
      } catch (cacheErr) {
        console.error('❌ Failed to read routines from cache file:', cacheErr.message);
      }
    }

    if (!updatedRoutines || updatedRoutines.length === 0) {
      console.warn('⚠️ Updated routines is empty after refresh. Falling back to initial routines data.');
      updatedRoutines = routines;
    }

    if (!updatedRoutines || updatedRoutines.length === 0) {
      console.warn('⚠️ No routines available after all fallbacks. Proceeding to create a new routine.');
      updatedRoutines = [];
    }

    console.log("🔍 Checking for existing CoachGPT routine. Titles found:");
    updatedRoutines.forEach(r => console.log(`– ${r.title}`));

    let existingRoutine = updatedRoutines.find(r => r.title && typeof r.title === 'string' && r.title.includes('CoachGPT'));
    console.log(`🔍 Existing CoachGPT routine: ${existingRoutine ? `Found (ID: ${existingRoutine.id}, Title: ${existingRoutine.title}, Updated: ${existingRoutine.updated_at})` : 'Not found'}`);

    let isValidRoutine = false;
    if (existingRoutine) {
      console.log(`🔍 Validating existing CoachGPT routine ID: ${existingRoutine.id}`);
      isValidRoutine = await validateRoutineId(existingRoutine.id);
      if (!isValidRoutine) {
        console.warn(`⚠️ Routine ID ${existingRoutine.id} is invalid. Falling back to creating a new routine.`);
        existingRoutine = null;
      } else {
        try {
          const routinesFilePath = path.join(__dirname, 'data', 'routines.json');
          if (fs.existsSync(routinesFilePath)) {
            const cachedRoutines = JSON.parse(fs.readFileSync(routinesFilePath, 'utf-8'));
            const cachedRoutine = cachedRoutines.find(r => r.id === existingRoutine.id);
            if (!cachedRoutine) {
              console.warn(`⚠️ Routine ID ${existingRoutine.id} not found in cache file. Falling back to creating a new routine.`);
              existingRoutine = null;
            } else {
              console.log(`✅ Routine ID ${existingRoutine.id} verified in cache file.`);
            }
          } else {
            console.warn('⚠️ No routines cache file found at data/routines.json. Proceeding with API-provided routine ID.');
          }
        } catch (cacheErr) {
          console.error('❌ Failed to read routines from cache file for validation:', cacheErr.message);
          console.warn('⚠️ Proceeding with API-provided routine ID, but this may cause issues.');
        }
      }
    }

    let routine;
    if (existingRoutine && isValidRoutine) {
      console.log(`🔄 Found existing CoachGPT routine (ID: ${existingRoutine.id}). Updating it.`);
      if (workoutType === 'Cardio') {
        const cardioExercises = pickExercises(workouts, exerciseTemplates, ['Cardio'], historyAnalysis.recentTitles, historyAnalysis.progressionAnalysis, varietyFilter, 1);
        const absExercises = pickAbsExercises(workouts, exerciseTemplates, historyAnalysis.recentTitles, 3);
        routine = await updateRoutine(existingRoutine.id, 'Cardio', cardioExercises, absExercises);
      } else {
        const mainExercises = pickExercises(workouts, exerciseTemplates, muscleTargets[workoutType], historyAnalysis.recentTitles, historyAnalysis.progressionAnalysis, varietyFilter, 6);
        const absExercises = pickAbsExercises(workouts, exerciseTemplates, historyAnalysis.recentTitles, 3);
        routine = await updateRoutine(existingRoutine.id, workoutType, mainExercises, absExercises);
      }
    } else {
      console.log('🆕 No existing CoachGPT routine found or routine ID is invalid. Creating a new one.');
      if (workoutType === 'Cardio') {
        const cardioExercises = pickExercises(workouts, exerciseTemplates, ['Cardio'], historyAnalysis.recentTitles, historyAnalysis.progressionAnalysis, varietyFilter, 1);
        const absExercises = pickAbsExercises(workouts, exerciseTemplates, historyAnalysis.recentTitles, 3);
        routine = await createRoutine('Cardio', cardioExercises, absExercises);
      } else {
        const mainExercises = pickExercises(workouts, exerciseTemplates, muscleTargets[workoutType], historyAnalysis.recentTitles, historyAnalysis.progressionAnalysis, varietyFilter, 6);
        const absExercises = pickAbsExercises(workouts, exerciseTemplates, historyAnalysis.recentTitles, 3);
        routine = await createRoutine(workoutType, mainExercises, absExercises);
      }
    }

    let exercises = [];
    if (Array.isArray(routine)) {
      exercises = routine[0]?.exercises || [];
    } else {
      exercises = routine.exercises || (routine.routine && routine.routine.exercises) || [];
    }
    if (exercises.length < 6 && workoutType !== "Cardio") {
      console.warn(`⚠️ Routine has only ${exercises.length} exercises. Retrying with relaxed filters...`);
      const mainExercises = pickExercises(workouts, exerciseTemplates, muscleTargets[workoutType], new Set(), historyAnalysis.progressionAnalysis, () => true, 6);
      const absExercises = pickAbsExercises(workouts, exerciseTemplates, new Set(), 3);
      routine = existingRoutine && isValidRoutine
        ? await updateRoutine(existingRoutine.id, workoutType, mainExercises, absExercises)
        : await createRoutine(workoutType, mainExercises, absExercises);
      if (Array.isArray(routine)) {
        exercises = routine[0]?.exercises || [];
      } else {
        exercises = routine.exercises || (routine.routine && routine.routine.exercises) || [];
      }
    }

    const todaysWorkout = {
      id: Array.isArray(routine) ? routine[0]?.id : routine.id,
      title: Array.isArray(routine) ? routine[0]?.title : (routine.title || routine.routine?.title),
      exercises: exercises.map(ex => ({
        title: ex.title,
        exercise_template_id: ex.exercise_template_id,
        notes: ex.notes,
        sets: ex.sets,
        superset_id: ex.superset_id,
        rest_seconds: ex.rest_seconds
      }))
    };

    return {
      success: true,
      message: `${workoutType} routine ${existingRoutine ? 'updated' : 'created'}`,
      routine,
      todaysWorkout
    };
  } catch (err) {
    console.error('❌ Error in autoplan:', err.message);
    const detailedError = err.response?.data?.error || err.message;
    return { success: false, error: `Request failed with status code ${err.response?.status || 400}: ${detailedError}` };
  } finally {
    try {
      const finalRoutines = await refreshRoutines();
    } catch (err) {
      console.error('❌ Final refresh of routines failed:', err.message);
    }
  }
}

module.exports = autoplan;