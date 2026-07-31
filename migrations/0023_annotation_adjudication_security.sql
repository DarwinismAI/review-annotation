ALTER TABLE public.annotation_adjudications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.annotation_adjudications FROM anon, authenticated;
