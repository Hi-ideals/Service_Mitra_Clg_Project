# ServiceSetu - Frontend

React 18 + Vite + Tailwind CSS. **No Redux**: server state lives in React
Query, client state in Context and local component state.

## Setup

```bash
npm install
npm run dev
```

The dev server runs on **port 5175** - 5173 and 5174 are used by other projects
on this machine, so the port is pinned with `strictPort` rather than letting
Vite silently pick a different one.

The backend must be running on port 5000 (`cd ../backend && npm run dev`).

## Why requests go through a proxy

`VITE_API_URL` is `/api/v1` - relative, not absolute. Requests pass through the
Vite dev proxy, which makes development **same-origin**.

That matters for one specific reason: the refresh token is an HttpOnly cookie.
Cross-origin, the browser applies stricter rules to storing and sending it, so
an absolute API URL in development means sessions silently fail to survive a
page reload while working perfectly in production. Same-origin in dev means the
auth flow behaves exactly as it will when deployed.

Point `VITE_API_URL` at an absolute URL only when targeting a deployed API.

## Layout

```
src/
  components/
    ui/        Button, Input, Card, Badge, Modal, Toaster, EmptyState, Skeleton
    layout/    Header, footer, bottom nav, the three role shells
  context/     AuthContext (who is signed in), ToastContext
  lib/         api.js (the single HTTP client), queryClient.js (keys + defaults)
  pages/       Screens, grouped by role
  routes/      Route tree and role guards
  styles/      Tailwind entry and base layer
```

## Conventions

**One HTTP client.** Every request goes through `lib/api.js`, which attaches
the access token, retries once after a silent refresh on a 401, and normalises
every failure into an `ApiError` with `fieldErrors` ready for react-hook-form.

**The access token lives in memory**, never in localStorage, so an XSS bug
cannot read it out of storage. The refresh token is an HttpOnly cookie
JavaScript cannot touch at all.

**Concurrent refreshes are shared.** A dashboard firing five queries at once
triggers one refresh, not five - the API rotates refresh tokens and treats a
reused one as theft, so five parallel refreshes would log the user out.

**Query keys live in `lib/queryClient.js`.** An invalidation cannot miss a
cache because someone typed the key slightly differently.

**Money** arrives in both paise and rupees. Render the rupee value; never do
currency arithmetic in the browser.

**Route guards are a convenience, not a security boundary.** The API enforces
every rule again on each request. The guards exist so nobody is shown a screen
that will only refuse them.

## Responsive approach

Mobile-first throughout. Phone gets a bottom navigation bar rather than a
hamburger, because the primary destinations should be thumb-reachable and not
hidden behind a menu. Dialogs become bottom sheets below `sm`. Inputs stay at
16px on touch devices, because iOS zooms the page when a smaller field gets
focus and that reads as a bug.

## Screens

**Customer** - landing, search with filters, provider profile, three-step
booking wizard, booking list and detail with live SSE tracking, invoices,
reviews, account.

**Provider** - dashboard with a go-live checklist, job queue, job detail with
the accept/start/complete flow, weekly schedule editor, earnings statement,
profile and pricing, KYC submission with document upload.

**Admin** - analytics dashboard, KYC review queue, category management,
platform booking monitor, disputes with resolution and refunds, review
moderation, payout runs, platform settings.

## Phase status

All 8 phases complete. See `../FRONTEND_PHASES.md` for what was verified.
