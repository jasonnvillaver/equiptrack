# EquipTrack

## Run locally

Install dependencies with `npm run install:all`. Provision the staff account through server environment variables before starting the API:

```sh
export STAFF_EMAIL="staff@example.edu"
export STAFF_PASSWORD="use-a-long-unique-password"
export STAFF_NAME="Equipment Staff"
npm run dev
```

Then open the Vite URL printed by the client. `STAFF_EMAIL` and `STAFF_PASSWORD` are used to create the staff account on first startup; staff/admin is one role. Borrowers can register from the sign-in screen and cannot select a staff role.

## Access roles

- **Staff / Admin:** manage equipment, view all borrowing requests, approve or reject requests, release equipment, process returns, and view reports.
- **Borrower:** browse equipment, submit borrowing requests, and view only their own requests and dashboard totals.

The API enforces these permissions independently of the client UI. Passwords are stored as salted scrypt hashes. Session tokens expire after 12 hours and are held in server memory, so restarting the API signs users out. Account records are stored in `server/data/db.json` by default. Set `EQUIPTRACK_DATA_DIR` to use another data directory.

## Resend email testing

EquipTrack uses Resend for confirmation, due-reminder, penalty, and test emails.

Configure the ignored root `.env` file:

```dotenv
RESEND_API_KEY="re_your_api_key"
RESEND_FROM="EquipTrack <onboarding@resend.dev>"
EMAIL_TEST_ADDRESS="your-verified-email@example.com"
```

With a new Resend account, the onboarding sender is for testing and the recipient must satisfy Resend's testing restrictions. For production, verify your domain and set `RESEND_FROM` to an address on that domain.

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
