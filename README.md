# ReminderPro

ReminderPro is a smart reminder calendar for tasks, appointments, and important things you do not want to forget.

The goal is to send automatic reminders through app notifications, email, and SMS.

## Current prototype

This first version is a static web app. It stores reminders in the browser with local storage and can show browser notifications while the app is open.

Open `index.html` in a browser to try it.

Current features:

- Create, edit, complete, and delete reminders.
- Search reminders by title, type, notes, email, or phone.
- Filter by all, open, due soon, overdue, or done.
- See reminder counts for open, due soon, overdue, and done items.
- Open email and SMS drafts from a reminder.

## MVP

- Add tasks and appointments with a date and time.
- View reminders in a calendar-style interface.
- Mark reminders as open or completed.
- Receive warning messages before something is due.
- Add email reminders first, then SMS reminders later.

## Notes

Email and SMS buttons open the user's email or messaging app. Fully automatic email and SMS delivery will need a backend service later.
