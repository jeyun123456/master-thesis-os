# Phase 2 data connection plan

## Existing endpoints worth reusing

The current Next.js app already exposes server-side routes that are close to the widget contract:

- `GET /api/calendar/events?days=14`
  - Google Calendar events, normalized server-side.
  - Candidate source for the widget's "가까운 일정" section.
- `GET /api/research/projects`
  - Project manifests including `status`, `stage`, `currentFocus`, `nextTasks`, and `blocked`.
  - Preferred source for "오늘 할 일" and project progress.
- `GET /api/research/status`
  - Fallback/current research summary including `currentStage`, `nextActions`, and `unresolved`.
- `GET /api/results`
  - Can be used later if the widget should show a headline result rather than only project stage.

The web home screen already prefers the active thesis project's `nextTasks` and falls back to `researchStatus.nextActions`, so Android should mirror that selection rule instead of inventing a second task model.

## Security boundary

Do **not** put GitHub tokens, Google service-account credentials, or Local Bridge credentials in the APK.

The existing Next.js server keeps GitHub and Google credentials in server-side environment variables, which is the correct boundary. The Android companion should only consume a deliberately exposed, narrow HTTPS response.

Before Phase 2 network code is enabled, verify the production access policy for the API routes. As currently structured, the route handlers themselves do not show an Android/client authentication check. Because calendar and research endpoints can return personal/project data, do not assume they are safe for an unauthenticated widget merely because the browser dashboard can call them.

Recommended sequence:

1. Keep Phase 1 fully static.
2. Decide whether `master-thesis-os.vercel.app` is intentionally public or access-controlled.
3. If it is access-controlled, choose a mobile-safe authentication mechanism before background widget refresh.
4. Prefer one narrow companion payload (server aggregated) over having the widget make several sensitive API calls, but only add that endpoint after the production security policy is explicitly decided.
5. Cache the last successful payload on-device and render it while offline.

## Proposed widget payload

A future aggregated payload can stay intentionally small:

```json
{
  "generatedAt": "2026-09-12T02:00:00Z",
  "todayTasks": ["...", "..."],
  "nextEvents": [
    { "title": "...", "start": "...", "allDay": false }
  ],
  "research": {
    "title": "BLUEBIRD",
    "stage": "interpretation",
    "status": "active",
    "currentFocus": "..."
  }
}
```

This endpoint is a **design proposal only**. Phase 1 does not modify the Next.js app or its production security configuration.

## Refresh strategy for Phase 4

Use WorkManager for periodic/background refresh and explicitly trigger a Glance `updateAll` after persisting fresh data. AppWidget periodic updates alone are not suitable for precise, frequent synchronization.

The Local Bridge is intentionally excluded from mobile. It remains PC-local only.
