# Green Sage — Two-Zone Prototype Dashboard

A focused Next.js dashboard for the current two-zone greenhouse prototype.

It retains only the prototype UI, its local API routes, the MQTT connection layer, prototype sign-in, and the two-zone visualisation. The previous full administration portal, mock server, tests, e2e setup, i18n content, Docker files, and unrelated pages were removed.

## Run locally

1. Open a terminal in this folder.
2. Copy `.env.example` to `.env.local`.
3. Add the MQTT connection values to `.env.local`.
4. Run `npm install`.
5. Run `npm run dev`.
6. Open http://localhost:3000.

The home page redirects to `/prototype-testing`.

## Important

The MQTT bridge remains server-side so MQTT credentials are not exposed in the browser. Its existing topic and payload contract has deliberately not been changed during this cleanup; align it with the gateway's current `greenhouse/zoneN/sensors` message format before relying on it for live hardware readings.
