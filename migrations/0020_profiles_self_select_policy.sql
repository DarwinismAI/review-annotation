-- Required for server-side Supabase session resolution when RLS is enabled.
-- Users can only read their own mirrored profile row; privileged admin flows use
-- the service-role client or direct database connection.
ALTER TABLE IF EXISTS "public"."profiles" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_select_own" ON "public"."profiles";
CREATE POLICY "profiles_select_own"
  ON "public"."profiles"
  FOR SELECT
  TO authenticated
  USING ("id" = auth.uid());
