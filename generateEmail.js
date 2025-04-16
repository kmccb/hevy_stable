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
 * Formats numbers with commas for readability (e.g., 11515 -> 11,515) or returns N/A for invalid input.
 * @param {number|string} num - The number to format.
 * @returns {string} - Formatted number with commas or 'N/A'.
 */
function formatNumber(num) {
  return Number.isFinite(parseFloat(num)) ? parseFloat(num).toLocaleString('en-US') : 'N/A';
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
  const providedCalories = parseFloat(macros.calories) || 0;
  const estimatedCalories = (protein * 4) + (carbs * 4) + (fat * 9);
  return providedCalories < 500 && estimatedCalories > 500 ? estimatedCalories : providedCalories;
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
 * Generates personalized coach tips based on workout and macro history.
 * @param {Array} trainerInsights - Array of insight objects with exercise data.
 * @param {Array} workouts - Array of recent workout objects.
 * @param {Object} macros - Current macros data.
 * @param {Object} allMacrosData - Historical macros data.
 * @param {Object} macrosChart - Average macro trends.
 * @returns {string} - HTML string of tailored tips.
 */
function generateCoachTips(trainerInsights, workouts, macros, allMacrosData, macrosChart) {
  const tips = [];
  const recentExercises = workouts.flatMap(w => w.exercises.map(e => e.title.toLowerCase()));
  const yesterdayCalories = estimateCalories(macros);
  const avgCalories = parseFloat(macrosChart?.average?.calories) || 1791; // Default to 1791 from PDF
  const avgProtein = parseFloat(macrosChart?.average?.protein) || 170; // Default to 170g
  const avgCarbs = parseFloat(macrosChart?.average?.carbs) || 135; // Default to 135g
  const avgFat = parseFloat(macrosChart?.average?.fat) || 60; // Default to 60g

  // Rest day advice if no workouts
  if (!trainerInsights.length && !workouts.length) {
    tips.push("Looks like a rest day yesterday. Try a light stretch or walk to aid recovery!");
  }

  // Workout-based tips with trainer reasoning
  trainerInsights.forEach(i => {
    const isDuration = i.title.toLowerCase().includes('plank') || i.title.toLowerCase().includes('hold') || i.title.toLowerCase().includes('walking');
    const isBodyweight = !i.avgWeightLbs || i.avgWeightLbs === 0 || isNaN(i.avgWeightLbs);
    let tip = `• <strong>${i.title}</strong>: `;

    if (isDuration && i.avgDuration) {
      const newDuration = i.avgDuration + 5;
      tip += `You held for ${i.avgDuration}s consistently—try ${newDuration}s next time to push your endurance, but only if form stays solid.`;
    } else if (isBodyweight && i.maxReps && !isNaN(i.maxReps)) {
      const newReps = i.maxReps + 2;
      tip += `You hit ${i.maxReps} reps with good form—aim for ${newReps} if you felt strong, or stick with this to build consistency.`;
    } else if (i.maxReps && i.maxWeightLbs && !isNaN(i.maxReps) && !isNaN(i.maxWeightLbs)) {
      const weightIncrease = Math.min(5, i.maxWeightLbs * 0.05); // 5% or 5 lbs max
      const newWeight = Number.isFinite(i.maxWeightLbs) ? (i.maxWeightLbs + weightIncrease).toFixed(1) : i.maxWeightLbs;
      const newReps = i.maxReps + 1;
      const effort = i.maxReps >= 10 ? "manageable" : "challenging";
      tip += `You lifted ${i.maxWeightLbs} lbs for ${i.maxReps} reps, which felt ${effort}—try ${newWeight} lbs or ${newReps} reps next time if your form held up, but focus on control over speed.`;
    } else {
      tip += `Your form’s solid—keep it consistent and we’ll add reps or weight when you’re ready.`;
    }

    // Avoid lower back risk (from March 26 chat)
    if (i.title.toLowerCase().includes('deadlift')) {
      tip += ` Let’s swap this for glute bridges to protect your back.`;
    }

    tips.push(tip);
  });

  // Macro-based tips
  if (yesterdayCalories < avgCalories - 200) {
    tips.push(`• Your ${formatNumber(yesterdayCalories)} kcal yesterday was below your ${formatNumber(avgCalories)} kcal average—add a snack like nuts or yogurt to fuel your workouts.`);
  } else if (yesterdayCalories > avgCalories + 200) {
    tips.push(`• Your ${formatNumber(yesterdayCalories)} kcal yesterday exceeded your ${formatNumber(avgCalories)} kcal average—great if bulking, but cut back if aiming to lean out.`);
  }

  if (parseFloat(macros.protein) < avgProtein * 0.8) {
    tips.push(`• Protein was ${formatNumber(macros.protein)}g yesterday—boost it toward your ${formatNumber(avgProtein)}g average with chicken or eggs to support muscle growth.`);
  }

  return tips.length ? tips.join("<br>") : "You’re on track—keep the good work going!";
}

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

  // Calculate weight change for a personal touch
  const weightChange = (() => {
    const validWeights = allMacrosData
      .map(m => parseFloat(m.weight))
      .filter(w => !isNaN(w));
    if (validWeights.length < 2) return null;
    const delta = validWeights.at(-1) - validWeights[0];
    const direction = delta < 0 ? "dropped" : "gained";
    return `You've ${direction} ${Math.abs(delta).toFixed(1)} lbs over 30 days—keep it up!`;
  })();

  // Format yesterday's workout with a friendly intro
  const workoutBlock = workouts.length > 0 ? workouts.map(w => `
    <h4 style="color: #333; font-size: 18px;">${w.title}</h4>
    ${formatWorkoutForEmail(w)}
  `).join("<br>") : "<p>No workout logged yesterday. Ready to crush it today?</p>";

  // Enhanced and personalized coach tips
  const coachTips = generateCoachTips(trainerInsights, workouts, macros, allMacrosData, macrosChart);

  // Handle missing macros data with N/A and estimate calories
  const macroValues = {
    calories: estimateCalories(macros),
    protein: macros.protein || 'N/A',
    carbs: macros.carbs || 'N/A',
    fat: macros.fat || 'N/A',
    weight: macros.weight || 'N/A',
    steps: macros.steps || 'N/A'
  };
  const yesterdayCalories = estimateCalories(macros);

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