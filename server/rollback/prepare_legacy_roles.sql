BEGIN;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (
    role IN (
      'staff',
      'borrower',
      'system_admin',
      'equipment_custodian',
      'faculty_staff',
      'authorized_student'
    )
  );

COMMIT;
