/**
 * Builds the full HTML content for the daily summary email.
 * Includes workouts, macros, charts, feedback, and a motivational quote with a human, conversational tone.
 */

/**
 * Formats a workout object into HTML for display in the email.
 * @param {Object} workout - A CoachGPT-generated workout object.
 * @returns {string} - HTML string of formatted workout.
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
        // Special case for bodyweight exercises like Chin Up
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
  const yesterdayCalories = estimateCalories(macros);
  const avgCalories = parseFloat(macrosChart?.average?.calories) || 1791;
  const avgProtein = parseFloat(macrosChart?.average?.protein) || 170;
  const avgCarbs = parseFloat(macrosChart?.average?.carbs) || 135;
  const avgFat = parseFloat(macrosChart?.average?.fat) || 60;

  if (!workouts.length) {
    tips.push("Looks like a rest day yesterday. Try a light stretch or walk to aid recovery! How did you feel after yesterday’s rest? Reply with ‘refreshed’ or ‘tired’ to tweak today’s intensity.");
  }

  const exerciseStats = {};
  workouts.forEach(w => {
    w.exercises.forEach(ex => {
      const title = ex.title.toLowerCase();
      if (!exerciseStats[title]) exerciseStats[title] = { maxReps: 0, maxWeight: 0, maxDuration: 0 };
      ex.sets.forEach(s => {
        if (s.reps > exerciseStats[title].maxReps) exerciseStats[title].maxReps = s.reps;
        if (s.weight_kg && (s.weight_kg * 2.20462) > exerciseStats[title].maxWeight) {
          exerciseStats[title].maxWeight = (s.weight_kg * 2.20462).toFixed(1);
        }
        if (s.duration_seconds && s.duration_seconds > exerciseStats[title].maxDuration) {
          exerciseStats[title].maxDuration = s.duration_seconds;
        }
      });
    });
  });

  // Add progression feedback for relevant exercises
  if (exerciseStats['push up']) {
    tips.push(`• <strong>Chin Up</strong>: You’ve hit ${exerciseStats['push up'].maxReps} reps on Push Up—let’s aim for 8-10 clean Chin Up reps today with bodyweight.`);
  }
  if (exerciseStats['plank']) {
    tips.push(`• <strong>Plank</strong>: Your Plank held steady at ${exerciseStats['plank'].maxDuration}s recently—nice! We’re bumping it to 80s today to keep the progress going.`);
  }

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

/**
 * Formats numbers with commas for readability (e.g., 11515 -> 11,515) or returns N/A for invalid input.
 * @param {number|string} num - The number to format.
 * @returns {string} - Formatted number with commas or 'N/A'.
 */
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
  // Remove commas from calories string before parsing
  const providedCaloriesStr = macros.calories ? String(macros.calories).replace(/[^0-9.]/g, '') : '0';
  const providedCalories = parseFloat(providedCaloriesStr) || 0;
  const estimatedCalories = (protein * 4) + (carbs * 4) + (fat * 9);
  
  console.log(`Provided calories: ${providedCalories}, Estimated: ${estimatedCalories}`);
  
  // Only estimate if provided calories are truly invalid (e.g., 0 or undefined)
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
    return `You’ve increased from ${first.maxWeight.toFixed(1)} lbs to ${last.maxWeight.toFixed(1)} lbs on ${exerciseTitle} over the last 2 weeks—nice work! 📈`;
  } else if (first.maxReps > 0 && last.maxReps > first.maxReps) {
    return `You’ve increased from ${first.maxReps} reps to ${last.maxReps} reps on ${exerciseTitle} over the last 2 weeks—nice work! 📈`;
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
 * @returns {string} - HTML string of tailored tips.
 */
function generateCoachTips(trainerInsights, workouts, macros, allMacrosData, macrosChart) {
  const tips = [];
  const yesterdayCalories = estimateCalories(macros);
  const avgCalories = parseFloat(macrosChart?.average?.calories) || 1791;
  const avgProtein = parseFloat(macrosChart?.average?.protein) || 170;
  const avgCarbs = parseFloat(macrosChart?.average?.carbs) || 135;
  const avgFat = parseFloat(macrosChart?.average?.fat) || 60;

  if (!workouts.length) {
    tips.push("Looks like a rest day yesterday. Try a light stretch or walk to aid recovery! How did you feel after yesterday’s rest? Reply with ‘refreshed’ or ‘tired’ to tweak today’s intensity.");
  }

  const exerciseStats = {};
  workouts.forEach(w => {
    w.exercises.forEach(ex => {
      const title = ex.title.toLowerCase();
      if (!exerciseStats[title]) exerciseStats[title] = { maxReps: 0, maxWeight: 0 };
      ex.sets.forEach(s => {
        if (s.reps > exerciseStats[title].maxReps) exerciseStats[title].maxReps = s.reps;
        if (s.weight_kg && (s.weight_kg * 2.20462) > exerciseStats[title].maxWeight) {
          exerciseStats[title].maxWeight = (s.weight_kg * 2.20462).toFixed(1);
        }
      });
    });
  });

  Object.keys(exerciseStats).forEach(title => {
    let tip = `• <strong>${title.charAt(0).toUpperCase() + title.slice(1)}</strong>: `;
    if (title.includes('incline bench press')) {
      tip += `You’ve been hitting 12 reps at 80 lbs lately—let’s carry that strength into today’s workout. `;
    }
    if (exerciseStats[title].maxReps > 0 && exerciseStats[title].maxWeight > 0) {
      const weightIncrease = Math.min(5, parseFloat(exerciseStats[title].maxWeight) * 0.05);
      const newWeight = (parseFloat(exerciseStats[title].maxWeight) + weightIncrease).toFixed(1);
      const newReps = exerciseStats[title].maxReps + 1;
      const effort = exerciseStats[title].maxReps >= 10 ? "manageable" : "challenging";
      if (title.includes('incline bench press')) {
        tip += `You lifted ${exerciseStats[title].maxWeight} lbs (using two ${parseFloat(exerciseStats[title].maxWeight) / 2}lb dumbbells) for ${exerciseStats[title].maxReps} reps, which felt ${effort}—adjust today’s Chin Up to ${newWeight / 2} lbs resistance if it’s machine-assisted.`;
      } else {
        tip += `You lifted ${exerciseStats[title].maxWeight} lbs for ${exerciseStats[title].maxReps} reps, which felt ${effort}—try ${newWeight} lbs or ${newReps} reps next time if your form held up, but focus on control over speed.`;
      }
      tip += ` Did this feel tough? Reply with 'easy' or 'hard' to adjust tomorrow’s plan.`;
    }
  });

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

  const coachTips = generateCoachTips(trainerInsights, workouts, macros, allMacrosData, macrosChart);

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

  // Debug the final formatted values before rendering
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