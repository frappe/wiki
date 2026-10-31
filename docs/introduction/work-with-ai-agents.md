---
title: Work with AI agents
---
A coding agent, such as Claude Code or Codex, can write and edit pages on your live wiki. It uses `frappe-wiki-skill`, a skill that comes with Frappe Wiki.

## What the agent can do

- List the spaces and pages on your site.
- Write new pages, edit pages, and move or delete them.
- Show you the changes as a diff before anything goes live.
- Submit its work for review, or publish it when you agree.

The agent does all of this through a change request, the same as a person in the app. It signs in as a user that you choose, and it can do only what that user can do. To limit the agent, give it a user with less access.

If the user has no Write access to the space, the agent can only submit the change request. A reviewer then approves and merges it in the app. See [Review a change](../change-requests/review-a-change.md).

The agent cannot change a space that is synced from GitHub. Change the files in the repository instead.

## Install the skill

Run this command:

```
npx skills add frappe/wiki --skill frappe-wiki-skill -g
```

The command installs the skill for each agent that it finds on your computer. `-g` installs it for your user, not only for the current project. Then give the agent a site to work on. The [skill README on GitHub](https://github.com/frappe/wiki/tree/develop/skills/frappe-wiki-skill) has the full steps and a manual install.

:::note
The skill works only with Frappe Wiki v3 sites.
:::

## Give your pages to any AI tool

Each published page is also available as Markdown. Add `.md` to the end of the page URL, for example `/handbook/time-off-and-benefits/paid-time-off.md`. The Markdown copy has the same access rules as the page. An `llms.txt` file lists the public pages for AI tools.

On a page in a public space, the page menu in the reader has **Copy page**, **Open in ChatGPT** and **Open in Claude**.

<picture>
  <source srcset="../images/introduction/reader-ai-menu-dark.webp" media="(prefers-color-scheme: dark)">
  <img src="../images/introduction/reader-ai-menu-light.webp" alt="The page menu in the reader with Copy page, Open in ChatGPT and Open in Claude">
</picture>

See [Markdown and llms.txt](../seo-and-aeo/markdown-and-llms-txt.md).
