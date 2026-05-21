# ReminderPro

ReminderPro is a smart reminder calendar for tasks, appointments, and important things you do not want to forget.

The goal is to send automatic reminders through email and SMS.

## Current prototype

This version stores reminders in the browser and syncs them to the Node server when deployed.

Open `index.html` in a browser to try it locally, or run the Node server:

```bash
npm start
```

Current features:

- Create, edit, complete, and delete reminders.
- Repeat reminders every day or every week.
- Search reminders by title, type, notes, email, or phone.
- Filter by all, open, due soon, overdue, or done.
- See reminder counts for open, due soon, overdue, and done items.
- Send automatic email and SMS reminders from the server when Railway variables are configured.
- Open email and SMS drafts from a reminder.
- Export and import reminders as JSON.
- Install as a lightweight web app in supported browsers.

## Railway deployment

The project is ready for Railway.

Steps:

1. Go to Railway and create a new project.
2. Choose deploy from GitHub.
3. Select the `ReminderPro` repository.
4. Add the variables below.
5. Deploy the service.
6. Generate a public domain for the service.

Railway should use:

- Build command: `npm run build`
- Start command: `npm start`
- Health check path: `/health`

Add these Railway variables to enable automatic email and SMS reminders.

For email:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

For SMS:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`

Optional:

- `DATA_DIR=/app/data` if you add a Railway volume mounted at `/app/data`.
- `NOTIFICATION_INTERVAL_MS` to change how often the server checks reminders. Default: `60000`.

Email reminders use Resend's server API. SMS reminders use Twilio's Messages API. Keep all keys only in Railway variables, never in frontend files.

For persistent reminders, add a Railway volume and mount it to `/app/data`. Without a volume, reminders can be lost after redeploys.

## MVP

- Add tasks and appointments with a date and time.
- Repeat reminders for habits and chores, such as running every day at 08:00 or cleaning every Monday.
- View reminders in a calendar-style interface.
- Mark reminders as open or completed.
- Receive email or SMS warning messages before something is due.

## Notes

Automatic email delivery requires Resend credentials. Automatic SMS delivery requires Twilio credentials.
