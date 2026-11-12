# User guide screenshots

This script takes every screenshot that the user guide in `docs/` embeds. It takes each shot in light and dark mode at 1440x900 with a device scale factor of 2, and writes `docs/images/<group>/<shot>-light.webp` and `-dark.webp`.

## Prerequisites

- A development site with demo data like the Northstar Labs demo. The seed is not in this repository. The shots expect:
  - The spaces **Company Handbook** (route `handbook`, read by the Employee role) and **Raven** (route `raven`, public).
  - A git-synced space **Frappe Wiki Docs** with the docs of this repository. For `github-sync/synced-page-image`, a synced space must have imported the images of `introduction/what-is-frappe-wiki`.
  - The demo users `<firstname>@northstarlabs.example`: grace (Wiki Manager), priya (Wiki Approver), aisha (Docs Team), and the employees kenji, ravi and liam.
  - The demo change requests, for example Kenji's "Offer Linux laptops to Platform and Data engineers" (In Review), Fatima's "Add Maze and Dovetail to the tools list" (Approved), Ravi's Draft and Liam's Changes Requested request.
  - Wiki Feedback records, view tracking data, and a GitHub App in **Wiki Settings**. The Administrator has a connected GitHub account for `github-sync/new-space-github`.
- Playwright and its Chromium in the repository (`yarn install`, then `npx playwright install chromium`).
- ImageMagick (`magick`) to convert PNG to WebP.

## Run

Set `ADMIN_PASSWORD` to the Administrator password of the site, and `DEMO_PASSWORD` to the password of the demo users. Some shots use Desk and the setup uses the API as Administrator.

```sh
export ADMIN_PASSWORD='<Administrator password>'
export DEMO_PASSWORD='<demo user password>'
node scripts/docs-screenshots/capture.mjs                 # all groups
node scripts/docs-screenshots/capture.mjs quick-start     # one group
node scripts/docs-screenshots/capture.mjs reading/app-search spaces
```

| Variable | Default |
| :--- | :--- |
| `BASE_URL` | `http://wiki.localhost:8000` |
| `ADMIN_PASSWORD` | `admin` (set it for any site that is not a fresh dev site) |
| `DEMO_PASSWORD` | None. Required. |
| `THEMES` | `light,dark` |
| `CHROMIUM_PATH` | The Playwright Chromium |

The script prints a problem list at the end: failed shots, a theme that does not match, or a loading indicator in the crop. For a failed shot, it saves a full-window PNG in `$TMPDIR/docs-screenshots-debug`.

## How it works

- `capture.mjs` runs each group twice, once per theme. For each shot, it signs in as the shot user, runs the setup, opens the URL, runs the steps, waits until the page is stable, and takes the crop.
- `shots/<group>.mjs` lists the shots of one docs folder. A shot has `name`, `user`, `url`, optional `setup`, `steps`, `crop` and `teardown`. A shot with `continue: true` keeps the page of the shot before it.
- `lib.mjs` has the API client, the browser contexts and the shared UI steps.

The script is safe to run again. It removes what it creates:

- `quick-start` deletes the **Engineering Handbook** space before and after the run.
- `authoring-content` deletes Grace's "Update device rules" change request.
- `change-requests` assigns Kenji's change request to Priya only for one shot, and makes the merge conflict in a temporary copy of the handbook that it deletes after the shot.
- `analytics` turns view tracking off for one shot and on again.
- `github-sync` runs one sync of the Frappe Wiki Docs space when its sync history has fewer than two rows.
