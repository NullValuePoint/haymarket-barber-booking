# Haymarket Barber Co.

A booking site for a fictional barbershop in Lincoln, Nebraska. Portfolio project built with plain HTML, CSS, and JavaScript — no frameworks, no build step.

## Features

- 5-step booking flow: service → barber → date & time → details → confirmation
- Real scheduling logic: open slots are computed from business hours (Tue–Sat, 9 AM–6 PM), service durations, and existing bookings; a slot is only offered if the full service fits before closing
- "No preference" barber option that auto-assigns the first free chair
- Deterministic demo schedule (seeded, stable across visits) plus the visitor's own bookings persisted in `localStorage`, which block out their slots
- Client-side validation for name, phone, and email with inline errors
- Booking reference codes and a printable-style confirmation summary
- Live booking summary sidebar with running total
- Fully responsive, keyboard-accessible controls

## Run locally

Open `index.html` in a browser, or serve the folder with any static server:

```sh
python3 -m http.server 8000
```

## Testing the scheduling logic

The pure functions (`getSlots`, `slotFree`, `assignBarber`, `validateDetails`, …) are exposed on `window.BookingApp` and covered by a Node harness:

```sh
node --check script.js
```
