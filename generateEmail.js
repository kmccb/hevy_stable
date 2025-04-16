// generateEmail.js – CoachGPT v1.5
const analyzeLongTermTrends = require('./analyzeLongTermTrends');

function generateEmail({ macros, weight, steps, yesterdayWorkout, todaysWorkout }) {
  const trends = analyzeLongTermTrends();

  const summarizeExercise = (ex) => {
    const sets = ex.sets.map(set => {
      if (set.reps && set.weight_kg) return `${(set.weight_kg * 2.20462).toFixed(1)} lbs x ${set.reps}`;
      if (set.duration_seconds) return `${set.duration_seconds}s hold`;
      return '—';
    }).join(', ');
    return `${ex.title}\nSets: ${sets}`;
  };

  const summarizeTrainerFeedback = () => {
    if (!yesterdayWorkout?.exercises?.length) return '• No exercises found in yesterday’s workout.';

    return yesterdayWorkout.exercises.map(ex => {
      const title = ex.title;
      const t = trends[title];
      if (!t) return `• ${title}: ➡ Not enough data yet`;

      const maxWeight = t.maxWeight * 2.20462;
      const avgVolume = average(t.volumeOverTime.map(v => v.volume));
      const recentReps = average(t.repsOverTime.map(r => r.reps));

      return `• ${title}: 🏋 Max: ${maxWeight.toFixed(1)} lbs | Avg reps: ${recentReps.toFixed(1)} | Avg volume: ${avgVolume.toFixed(0)} → Keep pushing!`;
    }).join('\n');
  };

  const summarizeMacroFeedback = () => {
    const kcal = macros.calories;
    let comment = '';
    if (kcal < 1400) comment = '⬇️ Calories low – consider a small increase';
    else if (macros.protein < 160) comment = '⚠️ Protein under target';
    else comment = '✅ Solid macro day';
    return `${comment}\nCalories: ${kcal} kcal\nProtein: ${macros.protein}g\nCarbs: ${macros.carbs}g\nFat: ${macros.fat}g\nWeight: ${weight} lbs\nSteps: ${steps.toLocaleString()}`;
  };

  const longTermHighlights = Object.entries(trends)
    .filter(([_, data]) => data.totalSessions >= 3)
    .map(([title, data]) => {
      const weight = data.maxWeight * 2.20462;
      return `${title}: 🏋 ${data.totalSessions} sessions | Max: ${weight.toFixed(1)} lbs`;
    })
    .slice(0, 5)
    .join('\n');

  const usedIds = new Set();
  const workoutBreakdown = todaysWorkout
    .filter(ex => {
      if (usedIds.has(ex.exercise_template_id)) return false;
      usedIds.add(ex.exercise_template_id);
      return true;
    })
    .map(summarizeExercise)
    .join('\n\n');

  return `
💪 Yesterday's Workout Summary

Workout: ${yesterdayWorkout?.title || '—'}

${summarizeTrainerFeedback()}

🥗 Macros – ${macros.date}

${summarizeMacroFeedback()}

📈 Long-Term Trends
${longTermHighlights || 'No long-term data yet'}

🏋 Today’s CoachGPT Workout
${workoutBreakdown}

🧭 Daily Inspiration
“Truth is such a rare thing, it is delighted to tell it.” – Emily Dickinson

Keep it up — I’ve got your back.
– CoachGPT
  `;
}

function average(arr) {
  const valid = arr.filter(v => typeof v === 'number' && !isNaN(v));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
}

module.exports = generateEmail;
