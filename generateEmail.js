// generateEmail.js – Personalized and Natural Tone (v1.5.5)

function formatWorkoutForEmail(workout) {
  if (!workout || !workout.exercises?.length) return "<p>No workout found.</p>";

  const exerciseCells = workout.exercises.map(ex => {
    const sets = ex.sets?.map(s => {
      if (s.duration_seconds) return `${s.duration_seconds}s hold`;
      if (s.reps != null && s.weight_kg != null) return `${(s.weight_kg * 2.20462).toFixed(1)} lbs x ${s.reps}`;
      if (s.reps != null) return `Bodyweight x ${s.reps}`;
      return "Set info missing";
    }).join(", ");

    return `<td style="vertical-align:top; padding:10px; width:50%;">
      <strong>${ex.title}</strong><br>
      Sets: ${sets}
    </td>`;
  });

  let rows = "";
  for (let i = 0; i < exerciseCells.length; i += 2) {
    rows += `<tr>${exerciseCells[i]}${exerciseCells[i + 1] || "<td></td>"}</tr>`;
  }

  return `<table width="100%" cellspacing="0" cellpadding="0" border="0">${rows}</table>`;
}

function generateHtmlSummary(workouts, macros, allMacrosData, trainerInsights, todayTargetDay, charts, todaysWorkout, quoteText) {
  const { weightChart, stepsChart, macrosChart, calorieChart } = charts;

  const weightChange = (() => {
    const validWeights = allMacrosData.map(m => parseFloat(m.weight)).filter(w => !isNaN(w));
    if (validWeights.length < 2) return null;
    const delta = validWeights.at(-1) - validWeights[0];
    const direction = delta < 0 ? "Down" : "Up";
    return `${direction} ${Math.abs(delta).toFixed(1)} lbs`;
  })();

  const workoutBlock = workouts.map(w => {
    const exBlocks = w.exercises.map(e => {
      const setSummary = e.sets?.map(s => {
        if (s.duration_seconds) return `${s.duration_seconds}s hold`;
        if (s.reps != null && s.weight_kg != null) return `${(s.weight_kg * 2.20462).toFixed(1)} lbs x ${s.reps}`;
        if (s.reps != null) return `Bodyweight x ${s.reps}`;
        return "Set info missing";
      }).join(", ");

      const note = trainerInsights.find(i => i.title === e.title)?.suggestion || "Keep dialing in your form and tempo.";
      return `<td style="vertical-align:top; padding:10px; width:50%;">
        <strong>${e.title}</strong><br>
        Sets: ${setSummary}<br>
        <em>${note}</em>
      </td>`;
    });

    let rows = "";
    for (let i = 0; i < exBlocks.length; i += 2) {
      rows += `<tr>${exBlocks[i]}${exBlocks[i + 1] || "<td></td>"}</tr>`;
    }

    return `<h4>Workout: ${w.title}</h4>
      <table width="100%" cellspacing="0" cellpadding="0" border="0">${rows}</table>`;
  }).join("<br><br>");

  const feedback = trainerInsights.length > 0
    ? trainerInsights.map(i => `• <strong>${i.title}</strong>: ${i.suggestion} (avg ${i.avgReps} reps @ ${i.avgWeightLbs} lbs)`).join("<br>")
    : "Looks like a rest day yesterday — good call. Use it to recharge and refocus for today’s effort.";

  const intro = `
    <p>Another day, another brick laid. Here's your CoachGPT breakdown for <strong>${macros.date}</strong> — showing up is half the battle, and you nailed it.</p>
  `;

  const macroSection = `
    <h3>🥗 Macros – ${macros.date}</h3>
    <ul>
      <li><strong>Calories:</strong> ${macros.calories} kcal</li>
      <li><strong>Protein:</strong> ${macros.protein}g</li>
      <li><strong>Carbs:</strong> ${macros.carbs}g</li>
      <li><strong>Fat:</strong> ${macros.fat}g</li>
      <li><strong>Weight:</strong> ${macros.weight} lbs</li>
      <li><strong>Steps:</strong> ${macros.steps}</li>
    </ul>
    <p>${macros.protein < 150 ? '⚠️ Keep pushing for more protein.' : '✅ Solid protein intake — keep it up!'}</p>
  `;

  return `
    ${intro}

    <h3>💪 Yesterday's Workout Summary</h3>${workoutBlock}<br><br>

    ${macroSection}

    <h3>📉 Weight Trend (Last 30 Days) ${weightChange ? `– ${weightChange}!` : ""}</h3>
    <img src="cid:weightChart" alt="Weight chart"><br>
    
    <h3>🚶 Steps Trend – Avg: ${stepsChart?.average || "N/A"} steps</h3>
    <img src="cid:stepsChart" alt="Steps chart"><br>
      
    <h3>🍳 Macro Trend – Avg Protein: ${macrosChart?.average?.protein || "N/A"}g, Carbs: ${macrosChart?.average?.carbs || "N/A"}g, Fat: ${macrosChart?.average?.fat || "N/A"}g</h3>
    <img src="cid:macrosChart" alt="Macros chart"><br>
      
    <h3>🔥 Calorie Trend – Avg: ${calorieChart?.average || "N/A"} kcal</h3>
    <img src="cid:caloriesChart" alt="Calories chart"><br>

    <h3>🧠 Trainer Feedback</h3>
    ${feedback}<br><br>

    <h3>📅 What’s Next</h3>
    Today is <strong>Day ${todayTargetDay}</strong>. Expect focused work — stick with your cues:<br>
    - Intentional form<br>
    - Controlled reps<br>
    - Steady breathing<br><br>

    <h3>🏋️ Today’s CoachGPT Workout</h3>
    ${formatWorkoutForEmail(todaysWorkout)}<br><br>

    <h3>🧭 Daily Inspiration</h3>
    <em>${quoteText}</em><br><br>

    Keep pushing — the work adds up.<br>– CoachGPT
  `;
}

module.exports = generateHtmlSummary;
