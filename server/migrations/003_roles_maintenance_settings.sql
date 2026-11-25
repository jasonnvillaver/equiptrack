ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;

UPDATE public.users
SET role = CASE
  WHEN role = 'staff' THEN 'equipment_custodian'
  WHEN role = 'borrower' THEN 'faculty_staff'
  ELSE role
END
WHERE role IN ('staff', 'borrower');

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (
    role IN (
      'system_admin',
      'equipment_custodian',
      'faculty_staff',
      'authorized_student'
    )
  );

CREATE TABLE IF NOT EXISTS public.maintenance_records (
  id UUID PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES public.equipment(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (
    status IN ('Reported', 'Scheduled', 'In Progress', 'Completed', 'Cancelled')
  ),
  notes TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS maintenance_records_equipment_created_idx
  ON public.maintenance_records (equipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS maintenance_records_status_idx
  ON public.maintenance_records (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.system_settings (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  student_registration_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  default_loan_days INTEGER NOT NULL DEFAULT 7
    CHECK (default_loan_days BETWEEN 1 AND 365),
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.system_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.maintenance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES
  ON TABLE public.maintenance_records, public.system_settings
  FROM PUBLIC, anon, authenticated;
