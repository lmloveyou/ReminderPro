# ReminderPro

ReminderPro is a smart reminder calendar for tasks, appointments, and important things you do not want to forget.

The goal is to send automatic reminders through app notifications, email, and SMS.

## Current prototype

This first version is a static web app. It stores reminders in the browser with local storage and can show browser notifications while the app is open.

Open `index.html` in a browser to try it locally, or run the Node server:

```bash
npm start
```

Current features:

- Create, edit, complete, and delete reminders.
- Search reminders by title, type, notes, email, or phone.
- Filter by all, open, due soon, overdue, or done.
- See reminder counts for open, due soon, overdue, and done items.
- Open email and SMS drafts from a reminder.
- Export and import reminders as JSON.
- Install as a lightweight web app in supported browsers.

## Railway deployment

The project is ready for Railway.

Railway can use:

- Build command: `npm run build`
- Start command: `npm start`
- Health check path: `/health`

## MVP

- Add tasks and appointments with a date and time.
- View reminders in a calendar-style interface.
- Mark reminders as open or completed.
- Receive warning messages before something is due.
- Add email reminders first, then SMS reminders later.

## Notes

Email and SMS buttons open the user's email or messaging app. Fully automatic email and SMS delivery will need a backend service later.
