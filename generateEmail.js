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

    return `<li><strong>${ex.title}</strong>: ${sets}</li>`;
  }).join("");

  return `
    <ul style="list-style-type: disc; padding-left: 20px; line-height: 1.6;">
      ${exerciseList}
    </ul>
  `;
}

/**
 * Formats numbers with commas for readability (e.g., 11515 -> 11,515).
 * @param {number} num - The number to format.
 * @returns {string} - Formatted number with commas.
 */
function formatNumber(num) {
  return Number.isFinite(num) ? num.toLocaleString('en-US') : 'N/A';
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

  // Calculate weight change for a personal touch
  const weightChange = (() => {
    const validWeights = allMacrosData
      .map(m => parseFloat(m.weight))
      .filter(w => !isNaN(w));
    if (validWeights.length < 2) return null;
    const delta = validWeights.at(-1) - validWeights[0];
    const direction = delta < 0 ? "dropped" : "gained";
    return `You've ${direction} ${Math.abs(delta).toFixed(1)} lbs`;
  })();

  // Format yesterday's workout with a friendly intro
  const workoutBlock = workouts.length > 0 ? workouts.map(w => `
    <h4 style="color: #333; font-size: 18px;">${w.title}</h4>
    ${formatWorkoutForEmail(w)}
  `).join("<br>") : "<p>No workout logged yesterday. Ready to crush it today?</p>";

  // Enhanced feedback for bodyweight and duration-based exercises
  const feedback = trainerInsights.length > 0
    ? trainerInsights.map(i => {
        const isDuration = i.title.toLowerCase().includes('plank') || i.title.toLowerCase().includes('hold') || i.title.toLowerCase().includes('walking');
        const isBodyweight = !i.avgWeightLbs || i.avgWeightLbs === 0 || isNaN(i.avgWeightLbs);
        
        let metrics = '';
        if (isDuration) {
          metrics = i.avgDuration ? `(avg ${i.avgDuration}s)` : '(focus on form)';
        } else if (isBodyweight) {
          metrics = i.avgReps && !isNaN(i.avgReps) ? `(avg ${i.avgReps} reps)` : '(bodyweight)';
        } else {
          metrics = (i.avgReps && !isNaN(i.avgReps) && i.avgWeightLbs && !isNaN(i.avgWeightLbs))
            ? `(avg ${i.avgReps} reps @ ${i.avgWeightLbs} lbs)`
            : '(maintain form)';
        }
        
        return `• <strong>${i.title}</strong>: ${i.suggestion} ${metrics}`;
      }).join("<br>")
    : "Looks like a rest day yesterday. Perfect time to recharge for what's next!";

  return `
    <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; line-height: 1.6;">
      <h2 style="color: #2c3e50; font-size: 24px;">Hey there! Here's Your Daily Fitness Update</h2>
      <p style="font-size: 16px;">You're doing awesome—let's dive into yesterday's wins and what's on tap for today!</p>

      <h3 style="color: #2c3e50; font-size: 20px; margin-top: 20px;">Yesterday's Workout</h3>
      ${workoutBlock}

      <h3 style="color: #2c3e50; font-size: 20px; margin-top: 20px;">Your Nutrition Snapshot (${macros.date})</h3>
      <p>Here's how you fueled up yesterday:</p>
      <ul style="list-style-type: disc; padding-left: 20px;">
        <li><strong>Calories</strong>: ${formatNumber(macros.calories)} kcal</li>
        <li><strong>Protein</strong>: ${formatNumber(macros.protein)}g</li>
        <li><strong>Carbs</strong>: ${formatNumber(macros.carbs)}g</li>
        <li><strong>Fat</strong>: ${formatNumber(macros.fat)}g</li>
        <li><strong>Weight</strong>: ${formatNumber(macros.weight)} lbs ${weightChange ? `(${weightChange} over 30 days—nice work!)` : ""}</li>
        <li><strong>Steps</strong>: ${formatNumber(macros.steps)}</li>
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
      <p>${feedback}</p>

      <h3 style="color: #2c3e50; font-size: 20px; margin-top: 20px;">Game Plan for Today (Day ${todayTargetDay})</h3>
      <p>Let’s keep the momentum going. Focus on:</p>
      <ul style="list-style-type: disc; padding-left: 20px;">
        <li>Intentional form—quality over quantity</li>
        <li>Progressive overload—push just a bit harder</li>
        <li>Core tension & recovery—stay balanced</li>
      </ul>

      <h3 style="color: #2c3e50; font-size: 20px; margin-top: 20px;">Today’s Workout Plan</h3>
      ${formatWorkoutForEmail(todaysWorkout)}

      <h3 style="color: #2c3e50; font-size: 20px; margin-top: 20px;">A Little Inspiration</h3>
      <p style="font-style: italic; color: #555;">"${quoteText}"</p>
      <p style="font-size: 16px;">You’ve got this! Keep pushing, and I’m here cheering you on.</p>
      <p style="font-size: 16px; margin-top: 20px;">– Your CoachGPT</p>
    </div>
  `;
}

module.exports = generateHtmlSummary;