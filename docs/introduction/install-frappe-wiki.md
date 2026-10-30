---
title: Install Frappe Wiki
---
You can install Frappe Wiki on Frappe Cloud or on a site that you host yourself.

## Supported versions

| Wiki branch | Stability | Frappe branch |
| :--- | :--- | :--- |
| `master` (v2.x) | stable | v15.x |
| `version-3` (v3.x) | stable | v15.x and v16.x |
| `develop` (nightly) | unstable | `develop` |

This guide is for Frappe Wiki v3. If you use Wiki v2, see [Migrate from Wiki v2](../administration/migrate-from-wiki-v2.md).

## Install on Frappe Cloud

1. Open the [Wiki app on the Frappe Cloud Marketplace](https://frappecloud.com/marketplace/apps/wiki).
2. Follow the steps to add the app to a new or existing site.

Frappe Cloud does the installation, upgrades and backups for you.

## Install on your own bench

You need a working bench. To set one up, see the [Frappe installation guide](https://frappeframework.com/docs/user/en/installation).

1. In your `frappe-bench` folder, get the app:

   ```
   bench get-app https://github.com/frappe/wiki
   ```

2. Install the app on your site. Put your site name in place of `<site>`:

   ```
   bench --site <site> install-app wiki
   ```

To get v3 on a stable bench, add `--branch version-3` to `bench get-app`.

## Open the app

After the installation, open `/wiki-app` on your site, for example `https://example.com/wiki-app`. Sign in if the site asks you to.

The installation creates one space, **Wiki**, at `/docs`. It has one page, **Welcome to Frappe Wiki**. You can rename this space, or delete it and make your own.

Users with the Wiki Manager role also see **Wiki** on the apps screen of the site.

Each user that you add after the installation gets the Wiki User role, so they can open the app. Users that existed before need the role too. To give other people more access, see [Roles and permissions](roles-and-permissions.md).

## Next steps

- [Find your way around](find-your-way-around.md)
- [Quick start: Create a space](../quick-start/create-a-space.md)
