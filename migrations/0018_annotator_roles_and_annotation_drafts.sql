BEGIN;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
UPDATE profiles SET role = 'annotator' WHERE role = 'expert';
ALTER TABLE profiles ALTER COLUMN role SET DEFAULT 'annotator';
ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('superadmin', 'admin', 'annotator'));

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
DECLARE
  requested_role TEXT;
BEGIN
  requested_role := COALESCE(NEW.raw_user_meta_data->>'role', 'annotator');
  IF requested_role = 'expert' THEN
    requested_role := 'annotator';
  END IF;
  IF requested_role NOT IN ('superadmin', 'admin', 'annotator') THEN
    requested_role := 'annotator';
  END IF;

  INSERT INTO public.profiles (id, email, role)
  VALUES (NEW.id, NEW.email, requested_role)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER TABLE annotation_results
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE annotation_results
  ALTER COLUMN value DROP NOT NULL;
ALTER TABLE annotation_results DROP CONSTRAINT IF EXISTS annotation_results_status_check;
ALTER TABLE annotation_results
  ADD CONSTRAINT annotation_results_status_check
  CHECK (status IN ('draft', 'completed'));
CREATE INDEX IF NOT EXISTS annotation_results_assignment_status_idx
  ON annotation_results(assignment_id, status);
CREATE INDEX IF NOT EXISTS annotation_results_row_metric_status_idx
  ON annotation_results(row_id, metric_id, status);

COMMIT;
