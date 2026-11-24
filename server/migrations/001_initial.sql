CREATE SEQUENCE IF NOT EXISTS equipment_id_seq START WITH 1000;
CREATE SEQUENCE IF NOT EXISTS request_id_seq START WITH 2000;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  department TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('staff', 'borrower')),
  phone TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS equipment (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  location TEXT NOT NULL,
  total INTEGER NOT NULL CHECK (total >= 1),
  available INTEGER NOT NULL CHECK (available >= 0 AND available <= total),
  condition TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  borrower TEXT NOT NULL,
  department TEXT NOT NULL,
  borrower_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  borrower_email TEXT,
  equipment_id TEXT NOT NULL REFERENCES equipment(id),
  equipment_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 1),
  purpose TEXT NOT NULL,
  borrow_date DATE NOT NULL,
  due_date DATE NOT NULL CHECK (due_date >= borrow_date),
  status TEXT NOT NULL CHECK (
    status IN ('Pending', 'Approved', 'Rejected', 'Borrowed', 'Returned')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ,
  returned_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS requests_borrower_user_id_idx
  ON requests (borrower_user_id);
CREATE INDEX IF NOT EXISTS requests_status_due_date_idx
  ON requests (status, due_date);

CREATE TABLE IF NOT EXISTS activity (
  id UUID PRIMARY KEY,
  message TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY,
  request_id TEXT REFERENCES requests(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  email TEXT,
  subject TEXT NOT NULL,
  text TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL CHECK (status IN ('sent', 'logged', 'failed', 'skipped')),
  provider_id TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS notifications_request_type_idx
  ON notifications (request_id, type);

INSERT INTO equipment (id, name, category, location, total, available, condition)
VALUES
  ('EQ-1001', 'Laptop - Lenovo ThinkPad', 'Computer', 'IT Laboratory', 8, 6, 'Good'),
  ('EQ-1002', 'Projector - Epson', 'Presentation', 'AV Room', 4, 3, 'Good'),
  ('EQ-1003', 'HDMI Cable', 'Accessory', 'IT Stockroom', 15, 12, 'Good'),
  ('EQ-1004', 'Digital Camera', 'Camera', 'Media Room', 3, 2, 'Good'),
  ('EQ-1005', 'Wireless Microphone', 'Audio', 'AV Room', 5, 5, 'Needs inspection')
ON CONFLICT (id) DO NOTHING;

SELECT setval(
  'equipment_id_seq',
  GREATEST(
    COALESCE(
      (SELECT MAX(SUBSTRING(id FROM 4)::INTEGER)
       FROM equipment
       WHERE id ~ '^EQ-[0-9]+$'),
      1000
    ),
    1000
  )
);

SELECT setval(
  'request_id_seq',
  GREATEST(
    COALESCE(
      (SELECT MAX(SUBSTRING(id FROM 4)::INTEGER)
       FROM requests
       WHERE id ~ '^BR-[0-9]+$'),
      2000
    ),
    2000
  )
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES
  ON TABLE public.users, public.equipment, public.requests, public.activity, public.notifications
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES
  ON SEQUENCE public.equipment_id_seq, public.request_id_seq
  FROM PUBLIC, anon, authenticated;
