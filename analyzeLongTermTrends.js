// analyzeLongTermTrends.js
const fs = require('fs');
const path = require('path');

const fullWorkoutHistoryPath = path.join(__dirname, 'data', 'workouts-full-history.json');

function analyzeLongTermTrends() {
  const allWorkouts = JSON.parse(fs.readFileSync(fullWorkoutHistoryPath, 'utf-8'));
  const trends = {};

  allWorkouts.forEach(workout => {
    workout.exercises?.forEach(ex => {
      const title = ex.title?.trim();
      if (!title) return;

      if (!trends[title]) {
        trends[title] = {
          totalSessions: 0,
          maxWeight: 0,
          mostRecentDate: null,
          repsOverTime: [],
          volumeOverTime: []
        };
      }

      let maxWeightThisExercise = 0;
      let totalVolume = 0;
      let totalReps = 0;

      ex.sets?.forEach(set => {
        if (typeof set.weight_kg === 'number' && typeof set.reps === 'number') {
          const volume = set.weight_kg * set.reps;
          if (set.weight_kg > maxWeightThisExercise) maxWeightThisExercise = set.weight_kg;
          totalVolume += volume;
          totalReps += set.reps;
        }
      });

      trends[title].totalSessions += 1;
      if (maxWeightThisExercise > trends[title].maxWeight) {
        trends[title].maxWeight = maxWeightThisExercise;
      }

      trends[title].mostRecentDate = workout.date || workout.created_at;
      trends[title].repsOverTime.push({ date: workout.date, reps: totalReps });
      trends[title].volumeOverTime.push({ date: workout.date, volume: totalVolume });
    });
  });

  return trends;
}

module.exports = analyzeLongTermTrends;
