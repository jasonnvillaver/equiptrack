BEGIN;

DROP TABLE IF EXISTS public.maintenance_records;
DROP TABLE IF EXISTS public.system_settings;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;

UPDATE public.users
SET role = CASE
  WHEN role IN ('system_admin', 'equipment_custodian') THEN 'staff'
  WHEN role IN ('faculty_staff', 'authorized_student') THEN 'borrower'
  ELSE role
END;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('staff', 'borrower'));

ALTER TABLE public.users
  DROP COLUMN IF EXISTS approved;

COMMIT;
