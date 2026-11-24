ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS legacy_date_exception BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.requests
  DROP CONSTRAINT IF EXISTS requests_check;

ALTER TABLE public.requests
  DROP CONSTRAINT IF EXISTS requests_due_date_valid_check;

ALTER TABLE public.requests
  ADD CONSTRAINT requests_due_date_valid_check
  CHECK (due_date >= borrow_date OR legacy_date_exception);
