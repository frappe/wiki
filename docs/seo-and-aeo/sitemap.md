---
title: Sitemap
---
The wiki adds its public pages to the site sitemap at `/sitemap.xml`. Search engines read the sitemap to find the pages of your site.

The sitemap is automatic. You do not have to turn it on.

## What is in the sitemap

A page is in the sitemap when all of these are true:

- The page is published.
- Its space is published.
- Its space is public. A public space has the Guest role. See [Who can read and write](../spaces/who-can-read-and-write.md).
- **Disable Indexing** is off for the page. See [Hide a page from search engines](hide-from-search-engines.md).

Each entry has the full URL of the page and the date of its last change.

## What is not in the sitemap

- Pages in private spaces.
- Unpublished pages and pages in unpublished spaces.
- Pages with **Disable Indexing** on.
- Groups and external links in the sidebar. A group is not a page.
- The Markdown versions of pages (`<route>.md`). They have the same content as the pages.

The sitemap always uses the permissions of a guest, not the permissions of the person who opens it.

## Other pages of the site

The sitemap also keeps the pages that the site listed before you installed the wiki, such as web pages from other apps. If the site has no public wiki page, the wiki does not change `/sitemap.xml`.

## Updates

The wiki updates the sitemap when a page or a space changes. Browsers and other caches can keep a copy for up to one hour.

:::tip[Tell search engines about the sitemap]
Add this line to **Robots.txt** in **Website Settings** in Desk, with your own domain:

```
Sitemap: https://wiki.example.com/sitemap.xml
```
:::
