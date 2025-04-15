const fs = require('fs');
const path = require('path');

// Weekly structure: adjust to preference
const WEEKLY_PLAN = ['Push', 'Pull', 'Legs', 'Core', 'Push', 'Pull', 'Rest']; // Mon–Sun

// Recovery windows (in days)
const RECOVERY_WINDOWS = {
  Push: 2,
  Pull: 2,
  Legs: 3,
  Core: 1,
};

function getSplitFromTitle(title) {
  const lowered = title.toLowerCase();
  if (lowered.includes('push')) return 'Push';
  if (lowered.includes('pull')) return 'Pull';
  if (lowered.includes('leg')) return 'Legs';
  if (lowered.includes('core') || lowered.includes('abs')) return 'Core';
  return null;
}

function getWeeklyTargetSplit() {
  const filePath = path.join(__dirname, 'data', 'workouts-30days.json');
  if (!fs.existsSync(filePath)) {
    console.warn("⚠️ workouts-30days.json not found. Defaulting to Push.");
    return 'Push';
  }

  const workouts = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday, 6 = Saturday
  const targetSplit = WEEKLY_PLAN[dayOfWeek];

  if (targetSplit === 'Rest') {
    console.log("😌 Today is a rest/light activity day.");
    return 'Core'; // Still create a light Core plan if user wants to stay active
  }

  const lastSplits = [];

  for (const workout of workouts.slice(0, 10)) {
    const title = workout.title || '';
    const split = getSplitFromTitle(title);
    if (!split) continue;

    const date = new Date(workout.logged_at || workout.updated_at || workout.created_at);
    const daysAgo = (today - date) / (1000 * 60 * 60 * 24);

    lastSplits.push({ split, daysAgo });
  }

  const recentHits = {};
  for (const { split, daysAgo } of lastSplits) {
    if (!recentHits[split] || daysAgo < recentHits[split]) {
      recentHits[split] = daysAgo;
    }
  }

  const requiredRest = RECOVERY_WINDOWS[targetSplit];
  const daysSinceLast = recentHits[targetSplit] ?? Infinity;

  if (daysSinceLast >= requiredRest) {
    console.log(`📅 Weekly target split: ${targetSplit} ✅ (last hit ${daysSinceLast.toFixed(1)}d ago)`);
    return targetSplit;
  }

  // If not recovered, slide to next split in weekly plan that *is* ready
  console.log(`🛑 ${targetSplit} not recovered (only ${daysSinceLast.toFixed(1)}d). Scanning alternates...`);
  for (let i = 1; i <= 6; i++) {
    const nextSplit = WEEKLY_PLAN[(dayOfWeek + i) % 7];
    if (nextSplit === 'Rest') continue;
    const restNeeded = RECOVERY_WINDOWS[nextSplit];
    const sinceLast = recentHits[nextSplit] ?? Infinity;
    if (sinceLast >= restNeeded) {
      console.log(`➡️ Substituting with ${nextSplit} (last hit ${sinceLast.toFixed(1)}d ago)`);
      return nextSplit;
    }
  }

  console.warn("⚠️ No split cleared recovery. Defaulting to Push.");
  return 'Push';
}

module.exports = getWeeklyTargetSplit;
