# EquipTrack

## Supabase setup

The `feature/dynamic-database` branch stores application data in PostgreSQL. Create a Supabase staging project, then add its PostgreSQL connection URI as `DATABASE_URL` in the ignored root `.env` file or in the server environment. Keep the URI private and do not commit it.

Run the schema migrations in order and seed the five equipment records in the staging database:

```sh
npm run install:all
npm run db:migrate --prefix server
```

The schema migration is safe to re-run and seeds five equipment records. It does not copy data from the currently deployed API. Configure `STAFF_EMAIL` and `STAFF_PASSWORD` (at least 10 characters) so the API creates the initial staff account on first startup.

### Import equipment and requests from the deployed API

The one-time importer uses a staff login to read equipment and requests from the legacy API, then writes them to a separately configured target database. It does not import users, notifications, or activity. Imported requests remain staff-visible and are not linked to borrowers' new accounts. Requests without a saved borrower email may need staff follow-up before approval.

The legacy source contains a request whose due date precedes its borrow date. `002_legacy_date_exception.sql` adds a flag so that request's original dates can be preserved without allowing new API requests to use an invalid date order. If `001_initial.sql` has already been run on the production project, run `002_legacy_date_exception.sql` there before importing.

Keep `DATABASE_URL` pointed at the current staging database. Add these entries to the ignored root `.env`, using the production session-pooler URI only for `LEGACY_IMPORT_DATABASE_URL`:

```dotenv
LEGACY_API_URL="https://equiptrack-api-g4fy.onrender.com/api"
LEGACY_STAFF_EMAIL="your-production-staff-email"
LEGACY_STAFF_PASSWORD="your-production-staff-password"
LEGACY_IMPORT_DATABASE_URL="your-production-session-pooler-URI"
```

After applying the schema migration to the production Supabase project, first run a dry run. It validates the source and rolls back all database changes:

```sh
npm run db:import-legacy --prefix server -- --dry-run
```

Review the counts. When ready, perform the import once:

```sh
npm run db:import-legacy --prefix server -- --confirm-import
```

The importer refuses to write unless the target contains only the initial seeded equipment and no requests. It logs counts only, not borrower data. Never point `LEGACY_IMPORT_DATABASE_URL` at staging or share these credentials.

Keep production on `main` and its existing services. To test this branch remotely, use a separate Render staging service set to `feature/dynamic-database` and point only that service at the staging Supabase database.

Provision the initial System Admin account through server environment variables before starting the API:

```sh
export STAFF_EMAIL="admin@example.edu"
export STAFF_PASSWORD="use-a-long-unique-password"
export STAFF_NAME="System Admin"
npm run dev
```

Then open the Vite URL printed by the client. The configured account is promoted to System Admin at startup. System Admins can create Equipment Custodian and other accounts in Settings.

## Access roles

- **System Admin:** full system access, user and role management, Authorized Student approvals, and global settings.
- **Equipment Custodian:** manage equipment and maintenance records, view and process all borrowing requests, and view reports.
- **Faculty & Staff:** browse equipment, submit borrowing requests, and view only their own requests and dashboard totals.
- **Authorized Student:** the same borrower functions after a System Admin approves the account. Student self-registration can be enabled or disabled in System Settings.

The System Admin Settings page controls Authorized Student self-registration and the default loan duration. The duration is used to prefill new requests; borrowers can select a different due date. Appearance preferences are saved in the current browser.

Equipment Custodians and System Admins can create maintenance records and advance them from Reported to Scheduled or In Progress, then to Completed or Cancelled. Maintenance records track work but do not change inventory availability.

The API enforces these permissions independently of the client UI. Passwords are stored as salted scrypt hashes in PostgreSQL. Session tokens expire after 12 hours and are held in server memory, so restarting the API signs users out. Application records persist in the configured PostgreSQL database.

The migration enables RLS on the application tables and removes direct `anon`/`authenticated` table and sequence grants. The browser must access data through the EquipTrack API; keep `DATABASE_URL` private in the server environment.

## Resend email testing

EquipTrack uses Resend for request-approval and release confirmations, due-reminder, penalty, and test emails. Approval sends a notification before equipment is released; release sends a separate confirmation. Staff-created requests must include the borrower's email address.

Configure the ignored root `.env` file:

```dotenv
RESEND_API_KEY="re_your_api_key"
RESEND_FROM="EquipTrack <onboarding@resend.dev>"
EMAIL_TEST_ADDRESS="your-verified-email@example.com"
```

With a new Resend account, the onboarding sender is for testing and the recipient must satisfy Resend's testing restrictions. For production, verify your domain and set `RESEND_FROM` to an address on that domain.

When `EMAIL_TEST_ADDRESS` is configured, notifications are redirected to that address instead of the borrower. The staff interface identifies this as a test delivery.

To test from a logged-in staff session:

```sh
curl -X POST http://localhost:4000/api/notifications/test \
  -H "Authorization: Bearer <staff-session-token>" \
  -H "Content-Type: application/json" \
  -d '{"email":"your-verified-email@example.com"}'
```

A successful response has `"status":"sent"` and includes `providerId`. If no Resend API key is configured, notification emails are logged locally without external delivery.

## Resend template testing

Set `RESEND_TEMPLATE_ID` to the ID or alias of a published template. The test endpoint sends `BORROWER_NAME`, `ITEM`, and `DUE_DATE` variables.

```dotenv
RESEND_TEMPLATE_ID="EquipTrack"
```

The template must be published and accept the variable names used by the test payload. Sending a template cannot include `text`, `html`, or `react` alongside it.

Approval emails use plain text unless a separate published approval template is configured. Approval templates receive `BORROWER_NAME`, `ITEM`, and `DUE_DATE`:

```dotenv
RESEND_APPROVAL_TEMPLATE_ID="EquipTrack Approval"
```
