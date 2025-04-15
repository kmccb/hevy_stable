const fs = require('fs');
const path = require('path');

function filterForVariety(recentWorkouts, maxUses = 3, windowDays = 21) {
  const now = new Date();
  const frequencyMap = {};

  for (const workout of recentWorkouts) {
    const workoutDate = new Date(workout.logged_at || workout.updated_at || workout.created_at);
    const daysAgo = (now - workoutDate) / (1000 * 60 * 60 * 24);
    if (daysAgo > windowDays) continue;

    for (const exercise of workout.exercises || []) {
      const title = exercise.title?.toLowerCase();
      if (!title) continue;
      frequencyMap[title] = (frequencyMap[title] || 0) + 1;
    }
  }

  return function (exerciseTemplate) {
    const title = exerciseTemplate.title?.toLowerCase();
    return !frequencyMap[title] || frequencyMap[title] < maxUses;
  };
}

module.exports = filterForVariety;
