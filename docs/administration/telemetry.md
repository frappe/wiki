---
title: Telemetry
---
Telemetry sends anonymous usage data from the wiki to Frappe. The Frappe team uses it to learn which features people use and where they stop.

## When the wiki sends data

The wiki sends data only when all of these are true:

- The site config has a `pulse_api_key`. Frappe Cloud sites have one. A self-hosted site does not, so it sends nothing.
- **Allow Sending Usage Data for Improving Applications** is on in **System Settings**.
- Developer mode is off.

The wiki has no telemetry setting of its own. It uses the Frappe setting.

## What the wiki sends

- **Actions.** One event when a person does an action, for example creates a space, merges a change request, sends feedback or searches. An event carries small values such as `page` or `group`, or a yes or no, for example "the change was reviewed".
- **A daily site profile.** Once a day, the wiki sends counts: spaces, pages, open change requests, editors and page views in the last 30 days, and the editor blocks that each space uses.
- **The app version** on every event.

Readers of public pages send one event only: when they pick an item in the page actions menu. The event tells which item it was: download, copy, ChatGPT or Claude.

## What the wiki never sends

- Page titles, page content, routes, space names or document names.
- Search terms.
- Email addresses or user names. Frappe replaces the user with an anonymous ID.

## Turn telemetry off

1. Go to `/app/system-settings` on your site.
2. In the **Telemetry** section, clear **Allow Sending Usage Data for Improving Applications**.
3. Click **Save**.

This stops telemetry for Frappe and for every app on the site, not only the wiki.

:::note
If the site config has `pulse_force_enabled`, the site sends data even when this setting is off. Remove that key to turn telemetry off.
:::
