const fs = require('fs');
const path = require('path');

// Customize recovery windows (in days)
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

function getNextSplit() {
  const filePath = path.join(__dirname, 'data', 'workouts-30days.json');
  if (!fs.existsSync(filePath)) {
    console.warn("⚠️ workouts-30days.json not found. Defaulting to Push.");
    return 'Push';
  }

  const workouts = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  const now = new Date();
  const lastSplits = [];

  // Parse last 5 logged splits
  for (const workout of workouts.slice(0, 10)) {
    const title = workout.title || '';
    const split = getSplitFromTitle(title);
    if (!split) continue;

    const date = new Date(workout.logged_at || workout.updated_at || workout.created_at);
    const daysAgo = (now - date) / (1000 * 60 * 60 * 24);

    lastSplits.push({ split, daysAgo });
  }

  // Count how recently each split was used
  const recentHits = {};
  for (const { split, daysAgo } of lastSplits) {
    if (!recentHits[split] || daysAgo < recentHits[split]) {
      recentHits[split] = daysAgo;
    }
  }

  const eligibleSplits = [];

  for (const split of Object.keys(RECOVERY_WINDOWS)) {
    const daysSinceLast = recentHits[split] ?? Infinity;
    const requiredRest = RECOVERY_WINDOWS[split];
    if (daysSinceLast >= requiredRest) {
      eligibleSplits.push({ split, daysSinceLast });
    }
  }

  if (eligibleSplits.length === 0) {
    console.warn("⚠️ No splits have cleared recovery. Using fallback rotation.");
    return getFallbackSplit(lastSplits);
  }

  // Prioritize the split that has waited longest
  const bestSplit = eligibleSplits.sort((a, b) => b.daysSinceLast - a.daysSinceLast)[0];
  console.log(`📅 Recovery-aware split: ${bestSplit.split} (last hit ${bestSplit.daysSinceLast.toFixed(1)} days ago)`);
  return bestSplit.split;
}

function getFallbackSplit(history) {
  const fallbackOrder = ['Push', 'Pull', 'Legs', 'Core'];
  const recent = history.map(h => h.split);
  for (const split of fallbackOrder) {
    if (!recent.includes(split)) return split;
  }
  return 'Push'; // total fallback
}

module.exports = getNextSplit;
