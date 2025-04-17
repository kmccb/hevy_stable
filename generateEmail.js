/**
 * Builds the full HTML content for the daily summary email and handles sending.
 * Includes workouts, macros, charts, feedback, and a motivational quote with a human, conversational tone.
 */

const nodemailer = require('nodemailer');

// Use environment variables directly
const { EMAIL_USER, EMAIL_PASS } = process.env;

// Create transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS
  }
});

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
  const relevantWorkouts = workouts.filter(w => {
    const workoutDate = new Date(w.date);
    return workoutDate >= twoWeeksAgo;
  });

  console.log(`getExerciseTrend - Relevant workouts for ${exerciseTitle}:`, relevantWorkouts.length);

  const exerciseData = relevantWorkouts
    .flatMap(w => (w.exercises || [])) // Guard against missing exercises
    .filter(e => e && e.title && e.title.toLowerCase() === exerciseTitle.toLowerCase())
    .map((e, idx) => {
      // Find the workout this exercise belongs to
      const workout = relevantWorkouts.find(w => w.exercises && w.exercises.includes(e));
      return {
        date: workout ? new Date(workout.date) : new Date(),
        maxWeight: Math.max(...(e.sets || []).map(s => (s.weight_kg || 0) * 2.20462)),
        maxReps: Math.max(...(e.sets || []).map(s => s.reps || 0))
      };
    })
    .sort((a, b) => a.date - b.date);

  console.log(`getExerciseTrend - Exercise data for ${exerciseTitle}:`, exerciseData);

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
 * @param {string} userFeedback - User's feedback on how they're feeling (e.g., "refreshed" or "tired").
 * @returns {string} - HTML string of tailored tips.
 */
function generateCoachTips(trainerInsights, workouts, macros, allMacrosData, macrosChart, stepsChart, todaysWorkout, userFeedback = "refreshed") {
  console.log("Entering generateCoachTips with todaysWorkout:", JSON.stringify(todaysWorkout));

  // Early return if todaysWorkout is invalid
  if (!todaysWorkout || typeof todaysWorkout !== 'object') {
    console.error("Error: todaysWorkout is invalid in generateCoachTips:", todaysWorkout);
    return "No workout plan available today—let’s focus on recovery! How are you feeling? Reply to tweak tomorrow’s plan.";
  }

  // Check specifically for title property
  if (!todaysWorkout.title || typeof todaysWorkout.title !== 'string') {
    console.error("Error: todaysWorkout.title is missing or invalid:", todaysWorkout);
    return "No workout title available today—let’s focus on recovery! How are you feeling? Reply to tweak tomorrow’s plan.";
  }

  const tips = [];
  const yesterdayCalories = estimateCalories(macros);
  const avgCalories = parseFloat(macrosChart?.average?.calories) || 1788;
  const avgProtein = parseFloat(macrosChart?.average?.protein) || 178;
  const avgSteps = parseFloat(stepsChart?.average) || 11462;
  const yesterdaySteps = parseFloat(macros.steps?.replace(/[^0-9.]/g, '') || 0);

  const workoutSplit = todaysWorkout.title.replace('CoachGPT – ', '') || 'workout';

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
  if (todaysWorkout.exercises?.length) {
    const firstExercise = todaysWorkout.exercises[0].title;
    const trend = getExerciseTrend(workouts, firstExercise); // Fixed to use workouts instead of allMacrosData
    if (trend) {
      tips.push(`• <strong>${firstExercise}</strong>: ${trend}`);
    }
  } else {
    console.log("No exercises found in todaysWorkout:", todaysWorkout);
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

  const finalTips = tips.length ? tips.join("<br>") : "You’re on track—keep the good work going!";
  console.log("generateCoachTips - Final tips:", finalTips);
  return finalTips;
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
  const userName = process.env.EMAIL_USER ? process.env.EMAIL_USER.split('@')[0] : 'there';

  console.log("todaysWorkout in generateHtmlSummary (before coachTips):", JSON.stringify(todaysWorkout));

  // Guard against invalid todaysWorkout
  if (!todaysWorkout || typeof todaysWorkout !== 'object' || !todaysWorkout.title || !todaysWorkout.exercises) {
    console.error("Error: todaysWorkout is invalid in generateHtmlSummary:", todaysWorkout);
    return `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; line-height: 1:6;">
        <h2 style="color: #2c3e50; font-size: 24px;">What up, Tom! Here's Your Daily Fitness Update</h2>
        <p style="font-size: 16px;">Looks like we couldn't plan a workout for today—let's focus on recovery!</p>
        <p style="font-size: 16px; margin-top: 20px;">– Your CoachGPT</p>
      </div>
    `;
  }

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

  const userFeedback = "refreshed";
  const coachTips = generateCoachTips(trainerInsights, workouts, macros, allMacrosData, macrosChart, stepsChart, todaysWorkout, userFeedback);

  // Debug logging without JSON.stringify
  console.log("After generateCoachTips - todaysWorkout exists:", !!todaysWorkout);
  console.log("After generateCoachTips - todaysWorkout.title:", todaysWorkout ? todaysWorkout.title : 'undefined');

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

  // Log chart objects before using them
  console.log("Chart objects in generateHtmlSummary:", {
    weightChart: { buffer: !!weightChart?.buffer, average: weightChart?.average },
    stepsChart: { buffer: !!stepsChart?.buffer, average: stepsChart?.average },
    macrosChart: { buffer: !!macrosChart?.buffer, average: macrosChart?.average },
    calorieChart: { buffer: !!calorieChart?.buffer, average: calorieChart?.average }
  });

  // Safely access chart data
  const stepsAvg = stepsChart && typeof stepsChart.average === 'number' ? formatNumber(stepsChart.average) : 'N/A';
  const macrosProtein = macrosChart?.average?.protein ? formatNumber(macrosChart.average.protein) : 'N/A';
  const macrosCarbs = macrosChart?.average?.carbs ? formatNumber(macrosChart.average.carbs) : 'N/A';
  const macrosFat = macrosChart?.average?.fat ? formatNumber(macrosChart.average.fat) : 'N/A';
  const calorieAvg = calorieChart && typeof calorieChart.average === 'number' ? formatNumber(calorieChart.average) : 'N/A';

  console.log("Computed chart values:", { stepsAvg, macrosProtein, macrosCarbs, macrosFat, calorieAvg });

  return `
    <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; line-height: 1:6;">
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
      ${weightChart?.buffer ? '<img src="cid:weightChart" alt="Weight chart" style="max-width: 100%; margin: 10px 0;">' : '<p>Weight chart unavailable.</p>'}
      <p><strong>Steps</strong>: Averaging ${stepsAvg} steps/day</p>
      ${stepsChart?.buffer ? '<img src="cid:stepsChart" alt="Steps chart" style="max-width: 100%; margin: 10px 0;">' : '<p>Steps chart unavailable.</p>'}
      <p><strong>Macros</strong>: Protein ${macrosProtein}g, Carbs ${macrosCarbs}g, Fat ${macrosFat}g</p>
      ${macrosChart?.buffer ? '<img src="cid:macrosChart" alt="Macros chart" style="max-width: 100%; margin: 10px 0;">' : '<p>Macros chart unavailable.</p>'}
      <p><strong>Calories</strong>: Averaging ${calorieAvg} kcal/day</p>
      ${calorieChart?.buffer ? '<img src="cid:caloriesChart" alt="Calories chart" style="max-width: 100%; margin: 10px 0;">' : '<p>Calories chart unavailable.</p>'}

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

/**
 * Generates and sends the daily email.
 * @param {Array} workouts - Array of recent workout objects.
 * @param {Object} macros - Current macros data.
 * @param {Object} allMacrosData - Historical macros data.
 * @param {Array} trainerInsights - Array of insight objects.
 * @param {number} todayDayNumber - The current day number in the cycle.
 * @param {Object} charts - Object containing chart buffers (weightChart, stepsChart, macrosChart, calorieChart).
 * @param {Object} todaysWorkout - Today's planned workout.
 * @param {string} quoteText - Motivational quote for the email.
 */
async function sendDailyEmail(workouts, macros, allMacrosData, trainerInsights, todayDayNumber, charts, todaysWorkout, quoteText) {
  try {
    console.log("✍️ Generating email HTML...");
    const html = generateHtmlSummary(
      workouts,
      macros,
      allMacrosData,
      trainerInsights,
      todayDayNumber,
      charts,
      todaysWorkout,
      quoteText
    );
    console.log("✍️ Email HTML generated successfully");

    console.log("📧 Sending email...");
    await transporter.sendMail({
      from: EMAIL_USER,
      to: EMAIL_USER,
      subject: `🎯 Hevy Daily Summary (${formatDate(macros.date)})`,
      html,
      attachments: [
        { filename: "weight.png", content: charts.weightChart?.buffer || Buffer.from(''), cid: "weightChart" },
        { filename: "steps.png", content: charts.stepsChart?.buffer || Buffer.from(''), cid: "stepsChart" },
        { filename: "macros.png", content: charts.macrosChart?.buffer || Buffer.from(''), cid: "macrosChart" },
        { filename: "calories.png", content: charts.calorieChart?.buffer || Buffer.from(''), cid: "caloriesChart" }
      ]
    });
    console.log("✅ Daily summary sent!");
  } catch (emailError) {
    console.error("❌ Failed to send email:", emailError.message || emailError);
    throw new Error(`Email sending failed: ${emailError.message}`);
  }
}

module.exports = { generateHtmlSummary, sendDailyEmail };