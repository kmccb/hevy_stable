/**
 * Builds the full HTML content for the daily summary email.
 * Includes workouts, macros, charts, feedback, and a motivational quote with a human, conversational tone.
 */

/**
 * Formats a workout object into HTML for display in the email.
 * @param {Object} workout - A CoachGPT-generated workout object.
 * @returns {string} - HTML string of formatted workout.
 */
function formatWorkoutForEmail(workout) {
  if (!workout || !workout.exercises?.length) {
    return "<p>Looks like no workout is planned today. Take it easy or sneak in some light movement!</p>";
  }

  const exerciseList = workout.exercises.map(ex => {
    const sets = ex.sets?.map(s => {
      if (s.duration_seconds) {
        return `${s.duration_seconds}s hold`;
      } else if (s.weight_kg != null && s.reps != null) {
        if (ex.title.toLowerCase().includes('chin up') && s.weight_kg === 0) {
          return `Bodyweight x ${s.reps}`;
        }
        return `${(s.weight_kg * 2.20462).toFixed(1)} lbs x ${s.reps}`;
      } else if (s.reps != null) {
        return `Bodyweight x ${s.reps}`;
      } else {
        return "Set info missing";
      }
    }).join(", ");

    return `<li><strong>${ex.title}</strong>: <span style="font-size: 14px;">${sets}</span></li>`;
  }).join("");

  return `
    <ul style="list-style-type: disc; padding-left: 20px; line-height: 1.6;">
      ${exerciseList}
    </ul>
  `;
}

/**
 * Formats numbers with commas for readability (e.g., 8928 -> 8,928) or returns N/A for invalid input.
 * @param {number|string} num - The number to format.
 * @returns {string} - Formatted number with commas or 'N/A'.
 */
function formatNumber(num) {
  console.log(`Formatting number: ${num} (type: ${typeof num})`);
  const cleanedNum = typeof num === 'string' ? num.replace(/[^0-9.]/g, '') : num;
  const parsedNum = parseFloat(cleanedNum);
  if (Number.isFinite(parsedNum)) {
    return parsedNum.toLocaleString('en-US');
  }
  console.log(`Invalid number detected: ${num}`);
  return 'N/A';
}

/**
 * Estimates calories from macros if the provided value seems invalid.
 * @param {Object} macros - Macros object with calories, protein, carbs, fat.
 * @returns {number|string} - Estimated or provided calories.
 */
function estimateCalories(macros) {
  const protein = parseFloat(macros.protein) || 0;
  const carbs = parseFloat(macros.carbs) || 0;
  const fat = parseFloat(macros.fat) || 0;
  const providedCaloriesStr = macros.calories ? String(macros.calories).replace(/[^0-9.]/g, '') : '0';
  const providedCalories = parseFloat(providedCaloriesStr) || 0;
  const estimatedCalories = (protein * 4) + (carbs * 4) + (fat * 9);
  
  console.log(`Provided calories: ${providedCalories}, Estimated: ${estimatedCalories}`);
  
  if (providedCalories === 0) {
    console.log(`Using estimated calories: ${estimatedCalories}`);
    return estimatedCalories;
  }
  return providedCalories;
}

/**
 * Formats a date string to MM-DD-YYYY format.
 * @param {string|Date} date - The date to format.
 * @returns {string} - Formatted date or 'N/A' if invalid.
 */
function formatDate(date) {
  try {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  } catch (e) {
    return 'N/A';
  }
}

/**
 * Calculates progression trend for an exercise over the last 14 days.
 * @param {Array} workouts - Array of workout objects.
 * @param {string} exerciseTitle - The title of the exercise.
 * @returns {string} - A string summarizing the trend.
 */
function getExerciseTrend(workouts, exerciseTitle) {
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const relevantWorkouts = workouts.filter(w => new Date(w.date) >= twoWeeksAgo);
  const exerciseData = relevantWorkouts
    .flatMap(w => w.exercises)
    .filter(e => e.title.toLowerCase() === exerciseTitle.toLowerCase())
    .map(e => ({
      date: new Date(w.date),
      maxWeight: Math.max(...e.sets.map(s => (s.weight_kg || 0) * 2.20462)),
      maxReps: Math.max(...e.sets.map(s => s.reps || 0))
    }))
    .sort((a, b) => a.date - b.date);

  if (exerciseData.length < 2) return "";
  const first = exerciseData[0];
  const last = exerciseData[exerciseData.length - 1];
  if (first.maxWeight > 0 && last.maxWeight > first.maxWeight) {
    return `You’ve increased from ${first.maxWeight.toFixed(1)} lbs to ${last.maxWeight.toFixed(1)} lbs on ${exerciseTitle} over the last 2 weeks—awesome progress! Aim for a small increase today.`;
  } else if (first.maxReps > 0 && last.maxReps > first.maxReps) {
    return `You’ve increased from ${first.maxReps} to ${last.maxReps} reps on ${exerciseTitle} over the last 2 weeks—awesome progress! Aim for ${last.maxReps + 2} today.`;
  }
  return "";
}

/**
 * Generates personalized coach tips based on workout and macro history.
 * @param {Array} trainerInsights - Array of insight objects with exercise data.
 * @param {Array} workouts - Array of recent workout objects.
 * @param {Object} macros - Current macros data.
 * @param {Object} allMacrosData - Historical macros data.
 * @param {Object} macrosChart - Average macro trends.
 * @param {Object} stepsChart - Average step trends.
 * @param {Object} todaysWorkout - Today's planned workout.
 * @returns {string} - HTML string of tailored tips.
 */
function generateCoachTips(trainerInsights, workouts, macros, allMacrosData, macrosChart, stepsChart, todaysWorkout, userFeedback = "refreshed") {
  const tips = [];
  const yesterdayCalories = estimateCalories(macros);
  const avgCalories = parseFloat(macrosChart?.average?.calories) || 1788;
  const avgProtein = parseFloat(macrosChart?.average?.protein) || 178;
  const avgSteps = parseFloat(stepsChart?.average) || 11462;
  const yesterdaySteps = parseFloat(macros.steps.replace(/[^0-9.]/g, '')) || 0;
  const workoutSplit = todaysWorkout?.title?.replace('CoachGPT – ', '') || 'workout';

  // Step count feedback
  if (!workouts.length) {
    const stepsThreshold = avgSteps * 0.8;
    const stepsMessage = yesterdaySteps >= stepsThreshold
      ? `Your ${formatNumber(yesterdaySteps)} steps kept you active on a rest day—nice work!`
      : `Your ${formatNumber(yesterdaySteps)} steps yesterday were a bit low compared to your ${formatNumber(avgSteps)} average—try adding a short walk today to stay on track.`;
    
    // Dynamic prep suggestion based on workout split
    let prepSuggestion = "Try a 5-min dynamic stretch (like arm circles) to prep for today’s session.";
    if (workoutSplit.toLowerCase().includes("pull")) {
      prepSuggestion = "Try a 5-min dynamic stretch with cat-cow stretches to mobilize your spine for Dragon Flags.";
    } else if (workoutSplit.toLowerCase().includes("push")) {
      prepSuggestion = "Try a 5-min dynamic stretch with shoulder rotations to prep your chest and shoulders for pressing.";
    } else if (workoutSplit.toLowerCase().includes("legs")) {
      prepSuggestion = "Try a 5-min dynamic stretch with leg swings to prep your hips and quads for squatting.";
    }

    // Base tip with steps, protein, and prep
    tips.push(`${stepsMessage} With protein at ${formatNumber(macros.protein)}g, you’re set for today’s ${workoutSplit}. ${prepSuggestion}`);
  }

  // Add progression insight for the first exercise in today's workout
  if (todaysWorkout?.exercises?.length) {
    const firstExercise = todaysWorkout.exercises[0].title;
    const trend = getExerciseTrend(allMacrosData, firstExercise);
    if (trend) {
      tips.push(`• <strong>${firstExercise}</strong>: ${trend}`);
    }
  }

  // Adjust tone based on user feedback
  const intensityTip = userFeedback.toLowerCase() === "refreshed"
    ? `Glad you’re feeling refreshed—let’s push for 10 Chin Up reps today to keep building strength!`
    : `Feeling tired? Let’s focus on form with 6-8 Chin Up reps today to maintain your progress.`;
  tips.push(intensityTip);

  // Tie to long-term goal (assumed: maintain weight loss, build strength)
  const weightChange = allMacrosData.length >= 2
    ? (parseFloat(allMacrosData[allMacrosData.length - 1].weight) - parseFloat(allMacrosData[0].weight)).toFixed(1)
    : 0;
  if (weightChange !== 0) {
    const goalMessage = weightChange < 0
      ? `Your ${workoutSplit} session today is perfect for building upper body strength while keeping your calorie burn on track—nice balance with your ${Math.abs(weightChange)} lb loss!`
      : `Your ${workoutSplit} session today is great for building strength—keep up the consistency to support your ${Math.abs(weightChange)} lb gain!`;
    tips.push(goalMessage);
  }

  // Calorie-based tips
  if (yesterdayCalories < avgCalories - 200) {
    tips.push(`• Your ${formatNumber(yesterdayCalories)} kcal yesterday was below your ${formatNumber(avgCalories)} kcal average—add a snack like nuts or yogurt to fuel your workouts.`);
  } else if (yesterdayCalories > avgCalories + 200) {
    tips.push(`• Your ${formatNumber(yesterdayCalories)} kcal yesterday exceeded your ${formatNumber(avgCalories)} kcal average—great if bulking, but cut back if aiming to lean out.`);
  }

  // Add feedback prompt if no prior feedback
  if (!userFeedback) {
    tips.push(`Feeling refreshed or tired after yesterday? Reply to tweak intensity.`);
  }

  return tips.length ? tips.join("<br>") : "You’re on track—keep the good work going!";
}

/**
 * Generates HTML summary for the daily email.
 */
function generateHtmlSummary(
  workouts,
  macros,
  allMacrosData,
  trainerInsights,
  todayTargetDay,
  charts,
  todaysWorkout,
  quoteText
) {
  const { weightChart, stepsChart, macrosChart, calorieChart } = charts;
  const userName = process.env.EMAIL_USER || 'there';

  const weightChange = (() => {
    const validWeights = allMacrosData
      .map(m => parseFloat(m.weight))
      .filter(w => !isNaN(w));
    if (validWeights.length < 2) return null;
    const delta = validWeights.at(-1) - validWeights[0];
    const direction = delta < 0 ? "dropped" : "gained";
    return `You've ${direction} ${Math.abs(delta).toFixed(1)} lbs over 30 days—keep it up!`;
  })();

  const workoutBlock = workouts.length > 0 ? workouts.map(w => `
    <h4 style="color: #333; font-size: 18px;">${w.title}</h4>
    ${formatWorkoutForEmail(w)}
  `).join("<br>") : "<p>No workout logged yesterday. Ready to crush it today?</p>";

  // Simulate user feedback for now (replace with actual reply mechanism later)
  const userFeedback = "refreshed"; // Hardcoded for now; ideally fetched from user reply
  const coachTips = generateCoachTips(trainerInsights, workouts, macros, allMacrosData, macrosChart, stepsChart, todaysWorkout, userFeedback);

  console.log(`Macros data: ${JSON.stringify(macros)}`);

  const macroValues = {
    calories: estimateCalories(macros),
    protein: macros.protein || 'N/A',
    carbs: macros.carbs || 'N/A',
    fat: macros.fat || 'N/A',
    weight: macros.weight || 'N/A',
    steps: macros.steps || 'N/A'
  };
  const yesterdayCalories = estimateCalories(macros);

  console.log(`Final formatted values - Calories: ${formatNumber(macroValues.calories)}, Steps: ${formatNumber(macroValues.steps)}`);

  return `
    <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; line-height: 1.6;">
      <h2 style="color: #2c3e50; font-size: 24px;">Hey ${userName}! Here's Your Daily Fitness Update</h2>
      <p style="font-size: 16px;">You're doing awesome—let's dive into yesterday's wins and what's on tap for today!</p>

      <h3 style="color: #2c3e50; font-size: 20px; margin-top: 20px;">Yesterday's Workout</h3>
      ${workoutBlock}

      <h3 style="color: #2c3e50; font-size: 20px; margin-top: 20px;">Your Nutrition Snapshot (${formatDate(macros.date)})</h3>
      <p>Here's how you fueled up yesterday:</p>
      <ul style="list-style-type: disc; padding-left: 20px;">
        <li><strong>Calories</strong>: ${formatNumber(macroValues.calories)} kcal (Yesterday: ${formatNumber(yesterdayCalories)} kcal est.)</li>
        <li><strong>Protein</strong>: ${formatNumber(macroValues.protein)}g</li>
        <li><strong>Carbs</strong>: ${formatNumber(macroValues.carbs)}g</li>
        <li><strong>Fat</strong>: ${formatNumber(macroValues.fat)}g</li>
        <li><strong>Weight</strong>: ${formatNumber(macroValues.weight)} lbs ${weightChange ? `(${weightChange})` : ""}</li>
        <li><strong>Steps</strong>: ${formatNumber(macroValues.steps)}</li>
      </ul>

      <h3 style="color: #2c3e50; font-size: 20px; margin-top: 20px;">Your Progress Over 30 Days</h3>
      <p>Check out these trends to see how far you've come:</p>
      <p><strong>Weight</strong>: ${weightChange || "Not enough data yet—keep logging!"}</p>
      <img src="cid:weightChart" alt="Weight chart" style="max-width: 100%; margin: 10px 0;">
      <p><strong>Steps</strong>: Averaging ${formatNumber(stepsChart?.average)} steps/day</p>
      <img src="cid:stepsChart" alt="Steps chart" style="max-width: 100%; margin: 10px 0;">
      <p><strong>Macros</strong>: Protein ${formatNumber(macrosChart?.average?.protein)}g, Carbs ${formatNumber(macrosChart?.average?.carbs)}g, Fat ${formatNumber(macrosChart?.average?.fat)}g</p>
      <img src="cid:macrosChart" alt="Macros chart" style="max-width: 100%; margin: 10px 0;">
      <p><strong>Calories</strong>: Averaging ${formatNumber(calorieChart?.average)} kcal/day</p>
      <img src="cid:caloriesChart" alt="Calories chart" style="max-width: 100%; margin: 10px 0;">

      <h3 style="color: #2c3e50; font-size: 20px; margin-top: 20px;">Your Coach’s Tips</h3>
      <p>${coachTips}</p>
      <hr style="border: 1px solid #eee; margin: 20px 0;">

      <h3 style="color: #2c3e50; font-size: 20px; margin-top: 20px;">Today’s Workout Plan</h3>
      ${formatWorkoutForEmail(todaysWorkout)}

      <h3 style="color: #2c3e50; font-size: 20px; margin-top: 20px;">A Little Inspiration</h3>
      <p style="font-style: italic; color: #555;">"${quoteText}"</p>
      <p style="font-size: 16px;">You’ve got this! Keep pushing, and I’m here cheering you on.</p>
      <p style="font-size: 14px; color: #666;">Got feedback? Let me know: <a href="https://forms.gle/yourformlink">here</a></p>
      <p style="font-size: 16px; margin-top: 20px;">– Your CoachGPT</p>
    </div>
  `;
}


module.exports = generateHtmlSummary;