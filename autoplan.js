const axios = require('axios');
const fs = require('fs');
const path = require('path');
const getNextSplit = require('./getNextSplit');
require('dotenv').config();

const API_KEY = process.env.HEVY_API_KEY;
const BASE_URL = 'https://api.hevyapp.com/v1';
const headers = { 'api-key': API_KEY };
const KG_TO_LBS = 2.20462;

const muscleTargets = {
  Push: ['Chest', 'Shoulders', 'Triceps'],
  Pull: ['Lats', 'Upper Back', 'Biceps'],
  Legs: ['Quads', 'Hamstrings', 'Glutes', 'Calves'],
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

// Helper function to retry API requests on 429 errors
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
        throw err; // unrecoverable error or out of attempts
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
  const recentTitles = new Set();
  const muscleGroupFrequency = {};
  const exerciseFrequency = {};
  const absMetrics = { totalSessions: 0, exercises: new Set(), totalSets: 0 };
  const progressionData = {};

  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);

  for (const workout of workouts) {
    let hasAbs = false;
    const workoutDate = new Date(workout.start_time);
    const isRecent = workoutDate >= oneDayAgo;

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
    progressionAnalysis
  };
}

function determineWorkoutType(historyAnalysis, lastCompletedWorkout, allWorkouts = []) {
  const lastScheduled = readLastScheduled();
  const today = new Date();
  const lastScheduledDate = lastScheduled.date ? new Date(lastScheduled.date) : null;

  if (lastScheduled.workoutType && lastScheduledDate) {
    const lastScheduledDateStr = lastScheduledDate.toISOString().split('T')[0];
    const lastCompletedDate = lastCompletedWorkout?.start_time ? new Date(lastCompletedWorkout.start_time).toISOString().split('T')[0] : null;

    if (!lastCompletedDate || lastScheduledDateStr > lastCompletedDate) {
      console.log(`🔄 Last scheduled workout (${lastScheduled.workoutType}) on ${lastScheduledDateStr} was not completed. Scheduling it again.`);
      return lastScheduled.workoutType;
    }
  }

  // 🧠 New logic: track last 3 workout splits
  const recentSplits = [];
  for (const workout of allWorkouts.slice(0, 3)) {
    const splitsSeen = new Set();
    for (const exercise of workout.exercises) {
      const template = exerciseTemplates.find(t => t.id === exercise.exercise_template_id);
      if (!template) continue;
      const muscle = template.primary_muscle_group?.toLowerCase();
      const split = muscleToWorkoutType[muscle];
      if (split && !splitsSeen.has(split)) {
        recentSplits.push(split);
        splitsSeen.add(split);
      }
    }
  }

  const lastSplit = recentSplits[0];
  const recentSplitCounts = recentSplits.reduce((counts, split) => {
    counts[split] = (counts[split] || 0) + 1;
    return counts;
  }, {});

  // 🔍 Sort by least-trained
  const muscleFrequencies = historyAnalysis.muscleGroupFrequency;
  const splitScores = Object.entries(muscleTargets).map(([split, muscles]) => {
    const totalFreq = muscles.reduce((sum, m) => sum + (muscleFrequencies[m.toLowerCase()] || 0), 0);
    return { split, frequency: totalFreq, recentCount: recentSplitCounts[split] || 0 };
  });

  // ❌ Avoid same split as yesterday unless everything is recent
  const avoidSplit = lastSplit;

  const preferred = splitScores
    .filter(s => s.split !== avoidSplit)
    .sort((a, b) => a.frequency - b.frequency || a.recentCount - b.recentCount);

  if (preferred.length > 0) {
    console.log(`📅 Smart-rotated workout: ${preferred[0].split} (avoiding repeat of ${avoidSplit})`);
    return preferred[0].split;
  }

  // 🛑 Fallback
  const fallback = splitScores.sort((a, b) => a.frequency - b.frequency)[0]?.split || 'Push';
  console.log(`📅 All splits recent. Fallback to: ${fallback}`);
  return fallback;
}


function pickExercises(templates, muscleGroups, recentTitles, progressionAnalysis, numExercises = 4) {
  const usedTitles = new Set();
  const selectedExercises = [];
  const availableTemplates = [...templates];

  const sortedMuscleGroups = [...muscleGroups].sort((a, b) => {
    const freqA = historyAnalysis.muscleGroupFrequency[a.toLowerCase()] || 0;
    const freqB = historyAnalysis.muscleGroupFrequency[b.toLowerCase()] || 0;
    return freqA - freqB;
  });

  for (const muscle of sortedMuscleGroups) {
    const candidates = availableTemplates.filter(t => {
      const primaryMatch = (t.primary_muscle_group || '').toLowerCase().includes(muscle.toLowerCase());
      return primaryMatch && !recentTitles.has(t.title) && !usedTitles.has(t.title);
    });

    if (candidates.length > 0) {
      const usedEquipment = new Set(selectedExercises.map(ex => ex.equipment));
      candidates.sort((a, b) => {
        const aIsNewEquipment = usedEquipment.has(a.equipment) ? 1 : 0;
        const bIsNewEquipment = usedEquipment.has(b.equipment) ? 1 : 0;
        return aIsNewEquipment - bIsNewEquipment;
      });

      const selected = candidates[0];
      const progression = progressionAnalysis[selected.title];
      const note = progression
        ? `${progression.suggestion} (last: ${progression.lastWeightLbs} lbs x ${progression.lastReps} reps)`
        : "Start moderate and build";
      console.log(`✅ Selected: ${selected.title} (Muscle: ${muscle}, Equipment: ${selected.equipment}, Note: ${note})`);
      selectedExercises.push({ ...selected, note });
      usedTitles.add(selected.title);
    } else {
      console.log(`⚠️ No suitable template found for ${muscle}. Available templates:`, availableTemplates
        .filter(t => (t.primary_muscle_group || '').toLowerCase().includes(muscle.toLowerCase()))
        .map(t => t.title));
    }
  }

  while (selectedExercises.length < numExercises) {
    const muscle = sortedMuscleGroups[Math.floor(Math.random() * sortedMuscleGroups.length)];
    const candidates = availableTemplates.filter(t => {
      const primaryMatch = (t.primary_muscle_group || '').toLowerCase().includes(muscle.toLowerCase());
      return primaryMatch && !recentTitles.has(t.title) && !usedTitles.has(t.title);
    });

    if (candidates.length === 0) {
      console.log(`⚠️ No more suitable templates found for ${muscle}. Stopping at ${selectedExercises.length} exercises.`);
      break;
    }

    const usedEquipment = new Set(selectedExercises.map(ex => ex.equipment));
    candidates.sort((a, b) => {
      const aIsNewEquipment = usedEquipment.has(a.equipment) ? 1 : 0;
      const bIsNewEquipment = usedEquipment.has(b.equipment) ? 1 : 0;
      return aIsNewEquipment - bIsNewEquipment;
    });

    const selected = candidates[0];
    const progression = progressionAnalysis[selected.title];
    const note = progression
      ? `${progression.suggestion} (last: ${progression.lastWeightLbs} lbs x ${progression.lastReps} reps)`
      : "Start moderate and build";
    console.log(`✅ Selected (additional): ${selected.title} (Muscle: ${muscle}, Equipment: ${selected.equipment}, Note: ${note})`);
    selectedExercises.push({ ...selected, note });
    usedTitles.add(selected.title);
  }

  return selectedExercises;
}

function pickAbsExercises(templates, recentTitles, numExercises = 4) {
  const absMuscles = ['abdominals', 'obliques'];
  const selectedExercises = [];
  const usedTitles = new Set();

  const priorityExercises = [
    { muscle: 'abdominals', note: "Focus on slow, controlled reps" },
    { muscle: 'abdominals', note: "Focus on slow, controlled reps" },
    { muscle: 'abdominals', note: "Focus on slow, controlled reps" },
    { muscle: 'abdominals', note: "Focus on slow, controlled reps" }
  ];

  for (let i = 0; i < numExercises; i++) {
    const muscle = priorityExercises[i].muscle;
    const candidates = templates.filter(t => {
      const primaryMatch = (t.primary_muscle_group || '').toLowerCase().includes(muscle.toLowerCase());
      const isOblique = i === 1 && (t.title.toLowerCase().includes('twist') || t.title.toLowerCase().includes('side'));
      const isTransverse = i === 2 && (t.title.toLowerCase().includes('plank') || 
                                      t.title.toLowerCase().includes('dead bug') || 
                                      t.title.toLowerCase().includes('hold'));
      const isRectus = i === 0 || i === 3;
      return primaryMatch && !recentTitles.has(t.title) && !usedTitles.has(t.title) &&
             (isRectus || (i === 1 && isOblique) || (i === 2 && isTransverse));
    });

    if (candidates.length > 0) {
      const selected = candidates[Math.floor(Math.random() * candidates.length)];
      console.log(`✅ Selected Abs: ${selected.title} (Muscle: ${muscle})`);
      selectedExercises.push({ ...selected, note: priorityExercises[i].note });
      usedTitles.add(selected.title);
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
    if (equipment === 'dumbbell') return 5;
    return 0;
  };

  const isDurationBased = ex => {
    const titleLower = ex.title.toLowerCase();
    const isAbs = ex.primary_muscle_group?.toLowerCase().includes('abdominals') ||
                  ex.primary_muscle_group?.toLowerCase().includes('obliques');
    const isBodyweight = !ex.equipment || ex.equipment.toLowerCase() === 'none';
    const durationKeywords = ['plank', 'hold', 'dead bug', 'side bridge', 'wall sit', 'hanging', 'isometric', 'static', 'bridge', 'superman', 'bird dog'];
    return durationKeywords.some(k => titleLower.includes(k)) ||
           (isAbs && isBodyweight && !titleLower.includes('crunch') && !titleLower.includes('twist'));
  };

  const routinePayload = {
    title: `CoachGPT – ${workoutType} + Abs`,
    notes: "Focus on form over weight. Supersets + finishers for max impact. 💥",
    exercises: []
  };

  const allExercises = [];
  const usedExerciseIds = new Set();

  // 🔁 Supersets
  const supersetPairs = Math.min(validExercises.length, validAbsExercises.length, 2);
  for (let i = 0; i < supersetPairs; i++) {
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

  // 💪 Add up to 3 solo strength finishers
  const remainingStrengths = validExercises.filter(ex => !usedExerciseIds.has(ex.id)).slice(0, 3);
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

  // 🔥 Abs finisher if room
  const remainingAbs = validAbsExercises.filter(ex => !usedExerciseIds.has(ex.id));
  if (allExercises.length < 8 && remainingAbs.length > 0) {
    const abs = remainingAbs[0];
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
  }

  // ✂️ Cap at 8 total exercises
  if (allExercises.length > 8) {
    allExercises.length = 8;
    console.warn("⚠️ Routine trimmed to 8 exercises.");
  }

  routinePayload.exercises = allExercises;

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

  // 🔒 Prevent undefined folder_id errors
  delete routinePayload.routine_folder_id;
  delete routinePayload.folder_id;
  
// 🧪 Debug payload size and structure
const payloadTest = {
  routine: routinePayload
};

console.log("📦 Payload length:", JSON.stringify(payloadTest).length, "chars");
console.log("📦 Exercise summary:", routinePayload.exercises.map(e => ({
  template_id: e.exercise_template_id,
  superset: e.superset_id,
  sets: e.sets.length,
  rest: e.rest_seconds
})));

  
  // ✅ Log final payload
  // console.log("📤 FINAL routine payload being sent to POST:", JSON.stringify(payload, null, 2));
  

  // console.log('📤 Routine payload (create):', JSON.stringify(payload, null, 2));

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
 // console.warn(`⚠️ Skipping validation for routine ID ${routineId}. GET /v1/routines/{id} not supported.`);
  return true;
}


async function updateRoutine(routineId, workoutType, exercises, absExercises) {
  const routinePayload = buildRoutinePayload(workoutType, exercises, absExercises);

  console.log(`🔍 First exercise in payload: ${routinePayload.exercises[0]?.exercise_template_id} (Title: ${exercises[0]?.title || absExercises[0]?.title})`);

  const payload = {
    routine: routinePayload
  };

//  console.log('📤 Routine payload (update):', JSON.stringify(payload, null, 2));

  // Retry the update up to 5 times with increased backoff
  let updateAttempts = 5;
  let backoff = 2000; // Start with 2 seconds
  for (let attempt = 1; attempt <= updateAttempts; attempt++) {
    try {
      const response = await makeApiRequestWithRetry('put', `${BASE_URL}/routines/${routineId}`, payload, headers, 3, 1000);
      // console.log('📥 Routine API response (update):', JSON.stringify(response.data, null, 2));
      const routineTitle = response.data?.routine?.title || response.data?.title || routinePayload.title;
      console.log(`✅ Routine updated: ${routineTitle} (ID: ${routineId})`);
      return response.data;
    } catch (err) {
      console.error(`❌ Attempt ${attempt}/${updateAttempts} - Failed to update routine (ID: ${routineId}):`, err.response?.data || err.message);
      if (attempt === updateAttempts) {
        console.error('❌ All update attempts failed. Throwing error to prevent creating a new routine.');
        throw new Error(`Failed to update routine (ID: ${routineId}) after ${updateAttempts} attempts: ${err.response?.data || err.message}`);
      }
      // Exponential backoff: 2s, 4s, 8s, 16s, 32s
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

    // Validate each routine ID before saving to the cache file
    const validRoutines = [];
    for (const routine of allRoutines) {
      if (routine.id && routine.title && typeof routine.title === 'string') {
        const isValid = await validateRoutineId(routine.id);
        if (isValid) {
          validRoutines.push(routine);
        } else {
   //       console.warn(`⚠️ Skipping routine with invalid ID: ${routine.id} (Title: ${routine.title})`);
        }
      } else {
   //     console.warn(`⚠️ Skipping invalid routine (missing ID or title):`, JSON.stringify(routine));
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
    historyAnalysis = analyzeHistory(workouts);
    const lastCompletedWorkout = workouts.length > 0 ? workouts[0] : null;
    const workoutType = getNextSplit();

    const today = new Date();
    writeLastScheduled(workoutType, today);

   // console.log('🔍 Initial routines data:', JSON.stringify(routines, null, 2));

    let updatedRoutines;
    try {
      updatedRoutines = await refreshRoutines();
    //  console.log('🔍 Updated routines after refresh:', JSON.stringify(updatedRoutines, null, 2));
    } catch (err) {
      console.warn('⚠️ Failed to refresh routines. Falling back to initial routines data and cache file.');
      updatedRoutines = routines;

      // Fallback to reading from data/routines.json
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

    // Validate the routine ID before attempting to update
    let isValidRoutine = false;
    if (existingRoutine) {
      console.log(`🔍 Validating existing CoachGPT routine ID: ${existingRoutine.id}`);
      isValidRoutine = await validateRoutineId(existingRoutine.id);
      if (!isValidRoutine) {
        console.warn(`⚠️ Routine ID ${existingRoutine.id} is invalid. Falling back to creating a new routine.`);
        existingRoutine = null; // Treat it as if no existing routine was found
      } else {
        // Double-check the routine ID with the cache file
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
        const cardioExercises = pickExercises(exerciseTemplates, ['Cardio'], historyAnalysis.recentTitles, historyAnalysis.progressionAnalysis, 1);
        const absExercises = pickAbsExercises(exerciseTemplates, historyAnalysis.recentTitles, 4);
        routine = await updateRoutine(existingRoutine.id, 'Cardio', cardioExercises, absExercises);
      } else {
        const mainExercises = pickExercises(exerciseTemplates, muscleTargets[workoutType], historyAnalysis.recentTitles, historyAnalysis.progressionAnalysis, 4);
        const absExercises = pickAbsExercises(exerciseTemplates, historyAnalysis.recentTitles, 4);
        routine = await updateRoutine(existingRoutine.id, workoutType, mainExercises, absExercises);
      }
      return { success: true, message: `${workoutType} routine updated`, routine };
    } else {
      console.log('🆕 No existing CoachGPT routine found or routine ID is invalid. Creating a new one.');
      if (workoutType === 'Cardio') {
        const cardioExercises = pickExercises(exerciseTemplates, ['Cardio'], historyAnalysis.recentTitles, historyAnalysis.progressionAnalysis, 1);
        const absExercises = pickAbsExercises(exerciseTemplates, historyAnalysis.recentTitles, 4);
        routine = await createRoutine('Cardio', cardioExercises, absExercises);
      } else {
        const mainExercises = pickExercises(exerciseTemplates, muscleTargets[workoutType], historyAnalysis.recentTitles, historyAnalysis.progressionAnalysis, 4);
        const absExercises = pickAbsExercises(exerciseTemplates, historyAnalysis.recentTitles, 4);
        routine = await createRoutine(workoutType, mainExercises, absExercises);
      }
      return { success: true, message: `${workoutType} routine created`, routine };
    }
  } catch (err) {
    console.error('❌ Error in autoplan:', err.message);
    const detailedError = err.response?.data?.error || err.message;
    return { success: false, error: `Request failed with status code ${err.response?.status || 400}: ${detailedError}` };
  } finally {
    try {
      const finalRoutines = await refreshRoutines();
      // console.log('🔍 Final routines after refresh:', JSON.stringify(finalRoutines, null, 2));
    } catch (err) {
      console.error('❌ Final refresh of routines failed:', err.message);
    }
  }
}

module.exports = autoplan;