---
title: Install Frappe Wiki
---
You can use Frappe Wiki on Frappe Cloud, or host it yourself with Frappe Pilot.

## Supported versions

| Wiki branch | Stability | Frappe branch |
| :--- | :--- | :--- |
| `master` (v2.x) | stable | v15.x |
| `version-3` (v3.x) | stable | v15.x and v16.x |
| `develop` (nightly) | unstable | `develop` |

This guide is for Frappe Wiki v3. If you use Wiki v2, see [Migrate from Wiki v2](../administration/migrate-from-wiki-v2.md).

## Frappe Cloud (recommended)

1. Open the [Wiki app on the Frappe Cloud Marketplace](https://frappecloud.com/marketplace/apps/wiki).
2. Follow the steps to add the app to a new or existing site.

Frappe Cloud does the installation, upgrades and backups for you.

## Self-hosting

Use [Frappe Pilot](https://github.com/frappe/pilot#readme) to host Frappe Wiki on your own server. Pilot installs and manages benches and sites, and sets up production for you.

1. Install Pilot and create a bench. Follow the steps in the [Pilot README](https://github.com/frappe/pilot#readme). In the commands below, put the name of your bench in place of `<bench>`.
2. Get the app. `version-3` is the stable branch of Wiki v3:

   ```sh
   pilot -b <bench> get-app https://github.com/frappe/wiki --branch version-3
   ```

3. If you do not have a site yet, create one. Put your site name in place of `<site>`:

   ```sh
   pilot -b <bench> new-site <site>
   ```

4. Install the app on the site:

   ```sh
   pilot -b <bench> install-app <site> wiki
   ```

To serve the site on a domain with TLS, see the production steps in the [Pilot README](https://github.com/frappe/pilot#readme).

:::note[You already use the bench CLI]
On a bench that you manage with the `bench` command, run `bench get-app https://github.com/frappe/wiki --branch version-3`, then `bench --site <site> install-app wiki`.
:::

## Open the app

After the installation, open `/wiki-app` on your site, for example `https://example.com/wiki-app`. Sign in if the site asks you to.

The installation creates one space, **Wiki**, at `/docs`. It has one page, **Welcome to Frappe Wiki**. You can rename this space, or delete it and make your own.

Users with the Wiki Manager role also see **Wiki** on the apps screen of the site.

Each user that you add after the installation gets the Wiki User role, so they can open the app. Users that existed before need the role too. To give other people more access, see [Roles and permissions](roles-and-permissions.md).

## Next steps

- [Find your way around](find-your-way-around.md)
- [Quick start: Create a space](../quick-start/create-a-space.md)
