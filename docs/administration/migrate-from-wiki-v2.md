---
title: Migrate from Wiki v2
---
When you upgrade a site from Wiki v2 to v3, `bench migrate` moves your spaces and pages to the v3 page tree. You do not need to copy content by hand.

## Before you start

- Wiki v3 runs on Frappe v15 or v16. Make sure that your Frappe version is one of these.
- Make a backup of the site and its files.

```bash
bench --site <your-site> backup --with-files
```

## Upgrade the site

1. Switch the wiki app to the `version-3` branch.
2. Run the migration.
3. Build the wiki assets.

```bash
bench switch-to-branch version-3 wiki
bench --site <your-site> migrate
bench build --app wiki
```

## What moves

In v2, a space has a sidebar and each sidebar item points to a **Wiki Page**. In v3, a space has a tree of **Wiki Document** records. The migration does these steps for each space:

- It makes a root group for the space.
- It makes one group for each sidebar label. The group route is the space route and the label in lowercase with hyphens, for example `docs/getting-started`.
- It makes one page in that group for each Wiki Page in the sidebar. The page keeps its title, content, route and published state.
- It keeps the order of the groups and pages from the v2 sidebar.

The migration also does these steps:

- It sets who can read each space. A published space becomes public. An unpublished space becomes readable by all signed-in users. A space that already has roles keeps them.
- It gives the **Wiki User** role to every enabled user, so that they can open the wiki app. See [Roles and permissions](../introduction/roles-and-permissions.md).

The page history of v2 pages does not move. The old Wiki Page records stay in the database.

## Check the result

1. Open `/wiki-app` and sign in as a Wiki Manager.
2. Open each space and compare its page tree with the old sidebar.
3. Open the space settings and check the **Access** tab. See [Who can read and write](../spaces/who-can-read-and-write.md).
4. Open a published page in a private browser window. Make sure that the right people can read it.

## Run the migration again for one space

A Wiki Manager can run the migration again for one space from Desk.

1. Go to `/app/wiki-space` and open the space.
2. Click **Migrate to Version 3**.
3. Click **Yes** to confirm.

The button shows only when the space still has v2 sidebar items.

:::caution
A second run copies the title and content from the v2 pages again. It replaces the changes that you made to those pages in v3. Run it only before people start to edit in v3.
:::

:::note
The **Migrate To Wiki** form in Desk is not the v2 upgrade. It is an old tool that imports Markdown files from an app folder into v2 pages.
:::
