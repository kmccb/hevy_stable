const analyzeLongTermTrends = require('./analyzeLongTermTrends');
const fs = require('fs');
const path = require('path');

function average(arr) {
  const valid = (arr || []).filter(v => typeof v === 'number' && !isNaN(v));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
}

function formatSets(sets = []) {
  return sets.map(set => {
    if (set.duration_seconds) return `${set.duration_seconds}s hold`;
    if (set.reps != null && set.weight_kg != null) return `${(set.weight_kg * 2.20462).toFixed(1)} lbs x ${set.reps}`;
    if (set.reps != null) return `Bodyweight x ${set.reps}`;
    return 'Set info missing';
  }).join(', ');
}

function formatWorkoutForEmail(workout, trainerInsights = []) {
  if (!workout || !workout.exercises?.length) return '<p>No workout found.</p>';

  const exerciseCells = workout.exercises.map(ex => {
    const sets = formatSets(ex.sets);
    const note = trainerInsights.find(i => i.title === ex.title)?.suggestion || 'Keep dialing in your form and tempo.';
    return `<td style="vertical-align:top; padding:10px; width:50%;">
      <strong>${ex.title}</strong><br>
      Sets: ${sets}<br>
      <em>${note}</em>
    </td>`;
  });

  let rows = '';
  for (let i = 0; i < exerciseCells.length; i += 2) {
    rows += `<tr>${exerciseCells[i]}${exerciseCells[i + 1] || '<td></td>'}</tr>`;
  }

  return `<h4>Workout: ${workout.title}</h4>
    <table width="100%" cellspacing="0" cellpadding="0" border="0">${rows}</table>`;
}

function encodeChart(filename) {
  try {
    const filepath = path.join(__dirname, 'charts', filename);
    const file = fs.readFileSync(filepath);
    return `<img src="cid:${filename}" alt="${filename}" style="max-width: 100%; height: auto;"/>`;
  } catch {
    return '';
  }
}

function generateEmail({
  macros = { calories: 0, protein: 0, carbs: 0, fat: 0, weight: 0, steps: 0, date: '—' },
  allMacrosData = [],
  weight,
  steps,
  workouts = [],
  yesterdayWorkout,
  todaysWorkout,
  todayTargetDay,
  charts = { weightChart: null, stepsChart: null, macrosChart: null, calorieChart: null },
  quoteText = '“Truth is such a rare thing, it is delighted to tell it.” – Emily Dickinson'
}) {
  const trends = analyzeLongTermTrends();
  const trainerInsights = yesterdayWorkout?.exercises?.map(ex => {
    const title = ex.title;
    const t = trends[title];
    if (!t || !t.maxWeight || !t.repsOverTime?.length) {
      return { title, suggestion: '📊 Not enough data yet', avgReps: 0, avgWeightLbs: 0 };
    }
    const maxWeight = (t.maxWeight * 2.20462).toFixed(1);
    const avgReps = average(t.repsOverTime.map(r => r.reps)).toFixed(1);
    return {
      title,
      suggestion: `⏩ Maintain weight / reps (avg ${avgReps} reps @ ${maxWeight} lbs)`,
      avgReps,
      avgWeightLbs: maxWeight
    };
  }) || [];

  const macroInsights = () => {
    const kcal = macros.calories;
    if (kcal === 0) return 'Macros unavailable.';
    let comment = '✅ Great macro execution!';
    if (macros.protein < 150) comment = '⚠️ Keep pushing for more protein.';
    if (kcal < 1400) comment = '⬇️ Calories too low – fuel up!';
    return `${comment}<br>Protein: ${macros.protein}g | Carbs: ${macros.carbs}g | Fat: ${macros.fat}g | Calories: ${macros.calories} kcal`;
  };

  const longTerm = Object.entries(trends || {})
    .filter(([_, data]) => data.totalSessions >= 3)
    .slice(0, 5)
    .map(([title, data]) => {
      const weight = data.maxWeight * 2.20462;
      return `<li>${title}: ${data.totalSessions} sessions | Max: ${weight.toFixed(1)} lbs</li>`;
    })
    .join('') || '<li>No trend data yet</li>';

  const weightChange = (() => {
    const validWeights = allMacrosData.map(m => parseFloat(m.weight)).filter(w => !isNaN(w));
    if (validWeights.length < 2) return '';
    const delta = validWeights.at(-1) - validWeights[0];
    const direction = delta < 0 ? 'Down' : 'Up';
    return `– ${direction} ${Math.abs(delta).toFixed(1)} lbs`;
  })();

  const chartsHTML = [
    encodeChart('weightChart'),
    encodeChart('stepsChart'),
    encodeChart('macrosChart'),
    encodeChart('caloriesChart')
  ].join('<br>');

  const feedback = trainerInsights.length > 0
    ? trainerInsights.map(i => `• <strong>${i.title}</strong>: ${i.suggestion}`).join('<br>')
    : 'Looks like a rest day yesterday — good call. Use it to recharge and refocus for today’s effort.';

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
      <li><strong>Weight:</strong> ${macros.weight || weight} lbs</li>
      <li><strong>Steps:</strong> ${macros.steps || steps?.toLocaleString() || 0}</li>
    </ul>
    <p>${macroInsights()}</p>
  `;

  const body = `
    ${intro}

    <h3>💪 Yesterday's Workout Summary</h3>
    ${formatWorkoutForEmail(yesterdayWorkout, trainerInsights)}<br>

    ${macroSection}

    <h3>📉 Weight Trend (Last 30 Days) ${weightChange}</h3>
    ${encodeChart('weightChart')}<br>

    <h3>🚶 Steps Trend – Avg: ${charts.stepsChart?.average || 'N/A'} steps</h3>
    ${encodeChart('stepsChart')}<br>

    <h3>🍳 Macro Trend – Avg Protein: ${charts.macrosChart?.average?.protein || 'N/A'}g, Carbs: ${charts.macrosChart?.average?.carbs || 'N/A'}g, Fat: ${charts.macrosChart?.average?.fat || 'N/A'}g</h3>
    ${encodeChart('macrosChart')}<br>

    <h3>🔥 Calorie Trend – Avg: ${charts.calorieChart?.average || 'N/A'} kcal</h3>
    ${encodeChart('caloriesChart')}<br>

    <h3>📈 Long-Term Trends</h3>
    <ul>${longTerm}</ul>

    <h3>🧠 Trainer Feedback</h3>
    ${feedback}<br><br>

    <h3>🏋️ Today’s CoachGPT Workout</h3>
    ${formatWorkoutForEmail(todaysWorkout, trainerInsights)}<br>

    <h3>📅 What’s Next</h3>
    <p>Today is <strong>Day ${todayTargetDay}</strong>. Expect focused work — stick with your cues:</p>
    <ul>
      <li>Intentional form</li>
      <li>Controlled reps</li>
      <li>Steady breathing</li>
    </ul>

    <h3>🧭 Daily Inspiration</h3>
    <blockquote>${quoteText}</blockquote>

    <p>Keep pushing — the work adds up.<br>– CoachGPT</p>
  `;

  return body;
}

module.exports = generateEmail;