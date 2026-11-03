# Maintain the user guide

This file tells you how to write and change the Frappe Wiki user guide in [`docs/`](docs/), and how to take its screenshots. Agents: read all of it before you add or edit a page in `docs/`.

## How the guide is published

- GitHub Sync publishes `docs/` as a space. Each Markdown file is one page.
- [`docs/.wiki.yml`](docs/.wiki.yml) sets the sidebar: one group per folder, with a `label`, a `slug` and the `items` in order. **Only the files listed there are synced.** When you add, move or remove a page, change `.wiki.yml` in the same commit.
- `specs/` is for internal notes, such as telemetry. Do not put them in `docs/`.

| Group | Folder |
| :--- | :--- |
| Introduction | `introduction/` |
| Quick Start | `quick-start/` |
| Spaces | `spaces/` |
| Authoring Content | `authoring-content/` |
| Change Requests | `change-requests/` |
| Reading | `reading/` |
| Analytics | `analytics/` |
| GitHub Sync | `github-sync/` |
| SEO & AEO | `seo-and-aeo/` |
| Administration | `administration/` |

The Quick Start follows one user, Grace, through the whole flow: create a space, write a page, submit it, review and merge it, then read it. The other groups go deeper into one feature each. Do not add an API section. The agent skill is in the Introduction (`work-with-ai-agents.md`). Leave the Tabs feature out for now.

## Write a page

Use the `technical-writing` skill. Write in Simplified Technical English, in the tone of the Raven docs:

- Short sentences. One instruction for each step. Use the names that the UI shows, in bold: **New page**, **Submit for review**.
- Start the page with one or two sentences that tell what the feature is and why to use it. Do not add a first heading that says the same thing again.
- Put the usual case first and the edge cases after it.
- Give the steps as a numbered list. Give settings as a table with **Setting** and **What it does**.
- End with **Next steps** links where they help.

Page format:

```markdown
---
title: Write your first page
---
One or two sentences on what this page is about.

## A task, as a verb phrase

1. Click **New page**.
2. ...
```

- Link to other pages with relative paths to the `.md` file, for example `[change request](../change-requests/what-is-a-change-request.md)`. GitHub Sync turns these into wiki links. Link the first mention of a concept on a page.
- Callouts: `:::note`, `:::tip` and `:::caution`, closed with `:::`. A title is optional: `:::note[You already use the bench CLI]`.
- Keep each paragraph on one line. Do not hard-wrap.
- Check each statement against the app. If the UI changed, change the page and its screenshots.

### What we learned from editing the Raven docs

The Raven docs use the same tone. A review pass over 49 of their pages ([change request](https://docs.frappe.io/wiki-app/spaces/ebfta10kf9/change-requests/2gcrbl99sk)) made these kinds of edits. Apply them here too:

- **The introduction lists the concepts.** "What is Raven" became a lead paragraph, then a **Concepts** section with one `###` heading for each concept, a definition of one to three sentences and a **Read more** link. Then **How these fit together**, a short list of how the concepts contain each other.
- **Remove sentences that say nothing new.** For example "Your vote is saved right away", "Ask an admin" after "only admins can change this", and "to open the Pins tab" when the next words say it again.
- **Give the result, not each click.** "Click it to upload one. If the workspace already has a logo, click it, then **Upload logo** or **Remove logo**" became "Click it to upload, replace or remove the logo."
- **Merge the lead and a first section that repeat it.** "Get started" lost its **Open Raven** heading. The lead now tells where Raven is.
- **Be exact about who and what.** "A System Manager sees the setup page" became "the first System Manager or Raven Admin to open Raven sees the setup page". "Each new person" became "Everyone else". "This can't be undone" became "it can't be reopened".
- **Write limits about the thing, not the reader.** "You can't change it afterwards" became "It can't be changed afterwards". "You can't change workspace settings on the mobile app. Use Raven in a browser" became "Workspace settings are changed on the computer only."
- **Use full clauses in table cells.** "Shown when multiple choices are on" became "How many options each person can pick, when multiple choices are on".
- **Join short paragraphs that are about the same thing.** A one-sentence paragraph after a related paragraph usually belongs in it.

## Preview your changes

On a development site in developer mode, sync `docs/` into a space and keep it in sync while you write. Open pages reload after each sync.

```sh
bench --site <site> wiki preview-docs apps/wiki/docs --route docs-preview --watch
```

Then open `/docs-preview` on the site. See [Preview docs locally](docs/github-sync/preview-docs-locally.md).

## Screenshots

### Where they go

- Each screenshot has a light and a dark version: `docs/images/<group>/<name>-light.webp` and `<name>-dark.webp`. The group is the docs folder of the page.
- Embed both with a `<picture>` element. Always write an `alt` text that tells what the image shows:

```html
<picture>
  <source srcset="../images/quick-start/empty-space-dark.webp" media="(prefers-color-scheme: dark)">
  <img src="../images/quick-start/empty-space-light.webp" alt="The empty Engineering Handbook space, with No pages yet in the sidebar">
</picture>
```

- The reader shows the dark version in dark mode. To show a small image at a smaller size, add `width` to the `<img>`, for example `width="300"` for a phone shot.

### Take them with the script

Do not take screenshots by hand. [`scripts/docs-screenshots/`](scripts/docs-screenshots/README.md) takes every screenshot in the guide, at 1440x900 and a device scale factor of 2, in both themes. Read its README for the demo data it needs.

```sh
export ADMIN_PASSWORD='<Administrator password>'
export DEMO_PASSWORD='<demo user password>'
node scripts/docs-screenshots/capture.mjs quick-start                  # one group
node scripts/docs-screenshots/capture.mjs quick-start/empty-space     # one shot
```

Take again only the shots that changed. Do not run all groups for a change that shows in a few shots.

Never put a password in a file in the repository. Use environment variables.

### Add a shot

1. Open `scripts/docs-screenshots/shots/<group>.mjs`.
2. Add an entry: `name` (the file name without the theme), `user` (the demo user, such as `grace`), and `url`. Add `setup`, `steps`, `crop` and `teardown` as needed. Use the helpers in `lib.mjs`, such as `waitIdle`, `dialog` and `openSpaceSettings`.
3. To keep the page of the shot before it, set `continue: true` and leave out `url`.
4. Clean up what the shot creates in `teardown`, so that the script is safe to run again.
5. Run the shot, then add the `<picture>` to the page.

How to crop:

- A dialog, a panel or a menu: return its locator from `crop`, so the image shows only that part.
- A tall, narrow target, such as the sidebar or a card in it: set `framed: true`. The script takes the target and the area next to it in a half window, dims the rest, and puts it in a window frame. Use this only for crops that would be tall and narrow. Do not use it for other shots.
- The whole window: leave out `crop`.

### Check each shot

The script prints problems at the end: a failed shot, a theme that does not match, or a loading indicator in the crop. Then open each new image, in light and in dark, and check:

- The text renders correctly. Look for letters with odd spacing or blur.
- Nothing is loading, half open or cut at the edge.
- The data is the demo data, and there is no personal or real data.
- The image shows what the text and the `alt` say.

### Images in a synced space

GitHub Sync imports each image as `/files/gitimg-<sha>.<ext>`. A changed image gets a new file name, so readers do not see an old copy from a cache. When you change a logo or a shared image, give the new file a new name too.

## Before you commit

- `.wiki.yml` lists every new page, and the links work in the preview.
- Each new image has a light and a dark version, and the page embeds both.
- The commit message uses the `docs(<group>): ...` format, for example `docs(quick-start): Link the first mention of a change request`.
