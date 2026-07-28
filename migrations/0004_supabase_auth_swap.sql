-- Path A iter-3: switch from better-auth to Supabase Auth.
-- Drops better-auth tables (user/session/account/verification),
-- creates `profiles` mirroring auth.users, repoints all FK to UUID.
-- PO confirmed nuke + reseed; existing dev data is wiped.

BEGIN;

-- 1. Wipe dependent data (PO confirmed: nuke + reseed)
TRUNCATE TABLE
  reviews, time_events, assignments, expert_domains, expert_profiles,
  articles, batches, rubrics
RESTART IDENTITY CASCADE;

-- 2. Drop better-auth managed tables
DROP TABLE IF EXISTS session CASCADE;
DROP TABLE IF EXISTS account CASCADE;
DROP TABLE IF EXISTS verification CASCADE;
DROP TABLE IF EXISTS "user" CASCADE;

-- 3. Profiles table mirrors auth.users (1:1 via UUID PK)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'expert' CHECK (role IN ('admin', 'expert')),
  name TEXT,
  image TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX profiles_email_idx ON profiles (email);

-- 4. Auto-mirror auth.users → profiles on signup
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'expert')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- 5. Repoint dependent FK columns (text → uuid → FK profiles)
ALTER TABLE expert_profiles ALTER COLUMN user_id TYPE UUID USING NULL;
ALTER TABLE expert_profiles
  ADD CONSTRAINT expert_profiles_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE expert_domains ALTER COLUMN user_id TYPE UUID USING NULL;
ALTER TABLE expert_domains
  ADD CONSTRAINT expert_domains_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE batches ALTER COLUMN created_by TYPE UUID USING NULL;
ALTER TABLE batches
  ADD CONSTRAINT batches_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE assignments ALTER COLUMN expert_id TYPE UUID USING NULL;
ALTER TABLE assignments
  ADD CONSTRAINT assignments_expert_id_fkey
  FOREIGN KEY (expert_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE reviews ALTER COLUMN expert_id TYPE UUID USING NULL;
ALTER TABLE reviews
  ADD CONSTRAINT reviews_expert_id_fkey
  FOREIGN KEY (expert_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE rubrics ALTER COLUMN created_by TYPE UUID USING NULL;
ALTER TABLE rubrics
  ADD CONSTRAINT rubrics_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE time_events ALTER COLUMN expert_id TYPE UUID USING NULL;
ALTER TABLE time_events
  ADD CONSTRAINT time_events_expert_id_fkey
  FOREIGN KEY (expert_id) REFERENCES profiles(id) ON DELETE CASCADE;

COMMIT;
