---
title: Translations
---
Translations change the language of the wiki interface: buttons, menus, dialogs and messages. They do not translate the pages that you write.

## Which language a person sees

- A signed-in user sees the interface in the **Language** set on their user record.
- A visitor who is not signed in sees the interface in the **Language** set in **System Settings**.

To change your own language, open your user record in Desk at `/app/user` and set **Language**.

## Where translations come from

The wiki uses the Frappe translation system. Wiki does not ship its own translation files yet. Community translations through Crowdin are planned, but they are not available now.

Until then, an interface text shows in English unless a translation exists for it on your site. Frappe and the other apps on your site supply translations for many common words.

## Add your own translation

A System Manager can add a translation for one text in Desk.

1. Go to `/app/translation/new` on your site.
2. In **Language**, pick the language.
3. In **Source Text**, enter the text exactly as it shows in English, for example `New Space`.
4. In **Translated Text**, enter the translation.
5. Click **Save**.

Reload the wiki to see the change.

:::note
Page content is not translated. To publish a page in more than one language, write each version as its own page or in its own space.
:::
