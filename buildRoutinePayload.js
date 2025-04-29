// buildRoutinePayload.js – now fully separates heavy legs before core

function buildRoutinePayload(exercises = []) {
  const payload = [];
  const usedIds = new Set();

  exercises.forEach((ex, index) => {
    if (!ex || !ex.exercise_template_id || usedIds.has(ex.exercise_template_id)) {
      console.warn(`⚠️ Skipping duplicate or invalid exercise: ${ex?.title || 'UNKNOWN'}`);
      return;
    }

    usedIds.add(ex.exercise_template_id);

    const isHeavyLeg = ex.title.toLowerCase().includes('leg press') ||
                       ex.title.toLowerCase().includes('leg curl') ||
                       ex.title.toLowerCase().includes('leg extension') ||
                       ex.title.toLowerCase().includes('calf raise');

    payload.push({
      exercise_template_id: ex.exercise_template_id,
      superset_id: isHeavyLeg ? null : ex.superset_id ?? null, // ❗ no supersets for heavy leg lifts
      rest_seconds: ex.rest_seconds ?? (isHeavyLeg ? 90 : 60),  // ❗ longer rest for heavy legs
      notes: ex.notes || '',
      sets: (ex.sets || []).map(set => ({
        type: set.type || 'normal',
        weight_kg: set.weight_kg ?? null,
        reps: set.reps ?? null,
        distance_meters: set.distance_meters ?? null,
        duration_seconds: set.duration_seconds ?? null,
        custom_metric: set.custom_metric ?? null
      }))
    });
  });

  return payload;
}

module.exports = buildRoutinePayload;
