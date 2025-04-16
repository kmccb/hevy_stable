// generateEmail.js – CoachGPT Full Format Restored with Inline Charts (v1.5.4)
const analyzeLongTermTrends = require('./analyzeLongTermTrends');
const fs = require('fs');
const path = require('path');

function generateEmail({ macros, weight, steps, yesterdayWorkout, todaysWorkout, todayTargetDay }) {
  const trends = analyzeLongTermTrends();
  macros = macros || { calories: 0, protein: 0, carbs: 0, fat: 0, date: '—' };

  const formatSets = (sets = []) => {
    return sets.map(set => {
      if (set.reps && set.weight_kg) return `${(set.weight_kg * 2.20462).toFixed(1)} lbs x ${set.reps}`;
      if (set.duration_seconds) return `${set.duration_seconds}s hold`;
      return '—';
    }).join(', ');
  };

  const summarizeWorkout = (title, exercises = []) => {
    if (!exercises.length) return '<p>—</p>';
    return `<h3>${title}</h3>` + exercises.map(ex => {
      const sets = formatSets(ex.sets);
      return `<p><b>${ex.title}</b><br>${sets}</p>`;
    }).join('');
  };

  const summarizeTrainerFeedback = () => {
    if (!(yesterdayWorkout?.exercises?.length)) return '<li>Rest day — no workout data available.</li>';
    return yesterdayWorkout.exercises.map(ex => {
      const title = ex.title;
      const t = trends[title];
      if (!t || !t.maxWeight || !t.repsOverTime?.length) {
        return `<li><b>${title}</b>: 📊 Not enough data yet</li>`;
      }
      const maxWeight = (t.maxWeight * 2.20462).toFixed(1);
      const avgReps = average(t.repsOverTime.map(r => r.reps)).toFixed(1);
      return `<li><b>${title}</b>: ⏩ Maintain weight / reps (avg ${avgReps} reps @ ${maxWeight} lbs)</li>`;
    }).join('');
  };

  const macroInsights = () => {
    const kcal = macros.calories;
    if (kcal === 0) return 'Macros unavailable.';
    let comment = '✅ Great macro execution!';
    if (macros.protein < 160) comment = '⚠️ Protein below target.';
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
    .join('');

  const encodeChart = (filename) => {
    try {
      const filepath = path.join(__dirname, 'charts', filename);
      const file = fs.readFileSync(filepath);
      return `<img src="cid:${filename}" alt="${filename}" style="max-width: 100%; height: auto;"/>`;
    } catch {
      return '';
    }
  };

  const chartsHTML = [
    encodeChart('weightChart'),
    encodeChart('stepsChart'),
    encodeChart('macrosChart'),
    encodeChart('caloriesChart')
  ].join('<br>');

  const body = `
  <h2>🎯 Hevy Daily Summary – ${macros.date}</h2>

  <h3>📌 Yesterday’s Workout</h3>
  <p><b>Workout:</b> ${yesterdayWorkout?.title || '—'}</p>
  <ul>${summarizeTrainerFeedback()}</ul>

  <h3>🏋️ Today’s CoachGPT Workout</h3>
  ${summarizeWorkout('Routine', todaysWorkout)}

  <h3>🥗 Macros</h3>
  <p>${macroInsights()}<br>Weight: ${weight} lbs | Steps: ${steps?.toLocaleString() || 0}</p>

  <h3>📈 Long-Term Trends</h3>
  <ul>${longTerm || '<li>No trend data yet</li>'}</ul>

  <h3>📊 Progress Charts</h3>
  ${chartsHTML}

  <h3>🧠 Trainer Feedback</h3>
  <ul>${summarizeTrainerFeedback()}</ul>

  <h3>📅 What’s Next</h3>
  <p>Today is <strong>Day ${todayTargetDay}</strong>. Expect focused work — stick with your cues:</p>
  <ul>
    <li>Intentional form</li>
    <li>Controlled reps</li>
    <li>Steady breathing</li>
  </ul>

  <h3>💬 Quote of the Day</h3>
  <blockquote>“Truth is such a rare thing, it is delighted to tell it.” – Emily Dickinson</blockquote>

  <p>Keep showing up. Your future self will thank you.<br>– CoachGPT</p>
  `;

  return body;
}

function average(arr) {
  const valid = (arr || []).filter(v => typeof v === 'number' && !isNaN(v));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
}

module.exports = generateEmail;
