---
title: Preview docs locally
---
Before you push, you can see your docs folder in the wiki exactly as GitHub Sync will show it. A bench command syncs the folder from your disk into a space on your development site. The sidebar config, front matter, links and images work as they do after a push.

:::note
The command runs only on a site with developer mode turned on. Use it on your own development site, not in production.
:::

## Preview a folder

1. Open a terminal in the folder that holds your docs, or in a parent folder.
2. Run the command with the path to the docs folder and a route for the preview space:

   ```sh
   bench --site wiki.localhost wiki preview-docs docs --route docs-preview
   ```

3. Open the route in your browser, for example `http://wiki.localhost:8000/docs-preview`.

The command prints the time and the space when the sync is done. If the sync fails, it prints the error.

## Keep the preview up to date

Add `--watch` to sync again each time you save a file in the folder:

```sh
bench --site wiki.localhost wiki preview-docs docs --route docs-preview --watch
```

The command checks the folder once a second. Refresh the page in your browser to see the change. Press `Ctrl+C` to stop.

## The preview space

- If no space uses the route, the command creates a git-synced space. Use `--name` to give it a name. Otherwise the name comes from the route.
- If a git-synced space already uses the route, the command syncs into it again.
- If a space that is not git-synced uses the route, the command stops. It never replaces pages that people wrote in the wiki.

A new preview space has no read roles, so only Wiki Managers can see it. To share it with other people, add roles in **Space settings**. See [Who can read and write](../spaces/who-can-read-and-write.md).

:::caution
If you use the route of a space that syncs from GitHub, the preview replaces its pages until the next sync from GitHub.
:::

## What the preview includes

- Only the files that a push would sync: the pages in your `.wiki.yml`, or every Markdown file when there is no sidebar config. See [Folder structure and .wiki.yml](folder-structure.md).
- Images that your pages use, from Markdown image links and from `<img>` and `<source>` tags. See [Images and links](images-and-links.md).
- Hidden folders such as `.git` are skipped.

An image keeps the same ID as it has on GitHub. After you push, the sync reuses the images that the preview already imported.

Each preview sync shows in the sync history of the space with the trigger **Local**. See [Sync a space](sync-a-space.md).
