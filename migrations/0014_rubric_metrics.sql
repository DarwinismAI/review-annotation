DO $$
DECLARE
  metric RECORD;
  migrated_at BIGINT := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;
BEGIN
  FOR metric IN
    SELECT
      rc.id AS criterion_id,
      rc.rubric_id,
      rc.name,
      rc.sort_order,
      r.domain,
      r.created_by,
      r.created_at,
      ROW_NUMBER() OVER (
        PARTITION BY rc.rubric_id
        ORDER BY rc.sort_order, rc.id
      ) AS metric_order,
      COUNT(*) OVER (PARTITION BY rc.rubric_id) AS metric_count
    FROM rubric_criteria rc
    JOIN rubrics r ON r.id = rc.rubric_id
  LOOP
    IF metric.metric_count > 1 AND metric.metric_order = 1 THEN
      UPDATE rubrics
      SET name = metric.name, updated_at = migrated_at
      WHERE id = metric.rubric_id;

      UPDATE rubric_criteria
      SET sort_order = 0, updated_at = migrated_at
      WHERE id = metric.criterion_id;
    ELSIF metric.metric_count > 1 THEN
      INSERT INTO rubrics (
        id,
        name,
        domain,
        created_by,
        created_at,
        updated_at
      )
      VALUES (
        'metric-' || metric.criterion_id,
        metric.name,
        metric.domain,
        metric.created_by,
        metric.created_at + metric.metric_order - 1,
        migrated_at
      )
      ON CONFLICT (id) DO NOTHING;

      UPDATE rubric_criteria
      SET
        rubric_id = 'metric-' || metric.criterion_id,
        sort_order = 0,
        updated_at = migrated_at
      WHERE id = metric.criterion_id;
    END IF;
  END LOOP;
END $$;
