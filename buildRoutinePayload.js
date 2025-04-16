// buildRoutinePayload.js – now fully deduplicates exercises
function buildRoutinePayload(exercises = []) {
    const payload = [];
    const usedIds = new Set();
  
    exercises.forEach((ex, index) => {
      if (!ex || !ex.exercise_template_id || usedIds.has(ex.exercise_template_id)) {
        console.warn(`⚠️ Skipping duplicate or invalid exercise: ${ex?.title || 'UNKNOWN'}`);
        return;
      }
  
      usedIds.add(ex.exercise_template_id);
  
      payload.push({
        exercise_template_id: ex.exercise_template_id,
        superset_id: ex.superset_id ?? null,
        rest_seconds: ex.rest_seconds ?? 60,
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
  