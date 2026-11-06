---
title: Images and links
---
GitHub Sync imports the images that your Markdown files use and changes the links between files into wiki links. You do not change your Markdown for this.

## Images

The sync imports an image when its path points to an image file in the same repository. It finds images in:

- Markdown images: `![Alt text](images/editor.png)`
- The `src` of an HTML `<img>` tag
- The `src` and `srcset` of an HTML `<source>` tag

The sync stores each image as a file on the site and changes the path in the page to the file URL. It imports these types: `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.bmp` and `.avif`.

Write the path relative to the Markdown file, for example `images/editor.png` or `../images/editor.png`. A path that starts with `/` is not imported.

### Light and dark images

Use a `<picture>` block to show a different image in dark mode. The sync imports both images.

```html
<picture>
  <source srcset="images/editor-dark.png" media="(prefers-color-scheme: dark)">
  <img src="images/editor-light.png" alt="The editor">
</picture>
```

In a `srcset` with more than one image, the sync keeps each descriptor, such as `2x`.

<picture>
  <source srcset="../images/github-sync/synced-page-image-dark.webp" media="(prefers-color-scheme: dark)">
  <img src="../images/github-sync/synced-page-image-light.webp" alt="A synced page that shows an image from the repository">
</picture>

### WebP

If **Auto Convert Image to WebP** is on in [Wiki settings](../administration/wiki-settings.md), the sync converts PNG and JPEG images to WebP. Other types stay as they are.

### Images that stay as they are

The sync does not change these paths:

- Full URLs, such as `https://example.com/logo.png`
- `data:` URIs
- Paths that start with `/files/`
- Paths to files that are not in the repository

The sync imports an image again only when the image file changes in the repository.

:::caution[Images are public]
Imported images are public files. Anyone who has an image URL can open it, also when the space is private or the repository is private.
:::

## Links between pages

The sync changes a Markdown link to another synced file into a link to that page in the wiki. For example, `[Install](guides/install.md)` becomes `[Install](/<space>/guides/install)`.

- A relative link resolves from the folder of the file that has the link.
- A link that starts with `/` resolves from the top of the docs folder, as on a docs site. `/guides/install` and `/guides/install.md` go to the same page.
- A link can have no extension, a `.html` extension or a `/` at the end. The sync tries the `.md` file first, then the `.mdx` file, then the `README.md` or `index.md` of a folder with that name.
- A `#section` at the end of a link stays.

## Links that stay as they are

The sync does not change these links:

- External links, such as `https://github.com` or `mailto:` links
- Links to a section on the same page, such as `#install`
- Links to files that the sync does not import as pages
- HTML `<a>` tags

To link to a page in another space, use its full URL.
