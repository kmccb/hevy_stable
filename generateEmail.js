// generateEmail.js – CoachGPT Full Format Restored (v1.5.1)
const analyzeLongTermTrends = require('./analyzeLongTermTrends');

function generateEmail({ macros, weight, steps, yesterdayWorkout, todaysWorkout }) {
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
    if (!exercises.length) return '—';
    return `**${title}**\n\n` + exercises.map(ex => {
      const sets = formatSets(ex.sets);
      return `• ${ex.title}\n   ${sets}`;
    }).join('\n\n');
  };

  const summarizeTrainerFeedback = () => {
    if (!(yesterdayWorkout?.exercises?.length)) return '• No exercises found in yesterday’s workout.';

    return yesterdayWorkout.exercises.map(ex => {
      const title = ex.title;
      const t = trends[title];
      if (!t) return `• ${title}: ⏳ Not enough data yet.`;
      const maxWeight = t.maxWeight * 2.20462;
      const avgVolume = average((t.volumeOverTime || []).map(v => v.volume));
      const recentReps = average((t.repsOverTime || []).map(r => r.reps));
      return `• ${title}: Max ${maxWeight.toFixed(1)} lbs | Avg Reps ${recentReps.toFixed(1)} | Volume ${avgVolume.toFixed(0)}`;
    }).join('\n');
  };

  const macroInsights = () => {
    const kcal = macros.calories;
    if (kcal === 0) return 'Macros unavailable.\n';
    let comment = '✅ Great macro execution!';
    if (macros.protein < 160) comment = '⚠️ Protein below target.';
    if (kcal < 1400) comment = '⬇️ Calories too low – fuel up!';
    return `${comment}\nProtein: ${macros.protein}g | Carbs: ${macros.carbs}g | Fat: ${macros.fat}g | Calories: ${macros.calories} kcal`;
  };

  const longTerm = Object.entries(trends || {})
    .filter(([_, data]) => data.totalSessions >= 3)
    .slice(0, 5)
    .map(([title, data]) => {
      const weight = data.maxWeight * 2.20462;
      return `• ${title}: ${data.totalSessions} sessions | Max: ${weight.toFixed(1)} lbs`;
    })
    .join('\n');

  const body = `
🎯 **Hevy Daily Summary – ${macros.date}**

📌 **Yesterday’s Workout**
Workout: ${yesterdayWorkout?.title || '—'}

${summarizeTrainerFeedback()}

🏋️ **Today’s CoachGPT Workout**
${summarizeWorkout('Routine', todaysWorkout)}

🥗 **Macros**
${macroInsights()}
Weight: ${weight} lbs | Steps: ${steps.toLocaleString()}

📈 **Long-Term Trends**
${longTerm || 'No trend data yet'}

💬 **Quote of the Day**
“Truth is such a rare thing, it is delighted to tell it.” – Emily Dickinson

Keep showing up. Your future self will thank you.
– CoachGPT
`;

  return body;
}

function average(arr) {
  const valid = (arr || []).filter(v => typeof v === 'number' && !isNaN(v));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
}

module.exports = generateEmail;
