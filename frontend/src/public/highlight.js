// Public-reader syntax highlighter, owned by the wiki app (not Frappe's shared
// syntax_highlighting.bundle.js). `highlight.js/lib/common` registers the exact
// same ~35 languages as frappe-ui's editor (`createLowlight(common)`), so the
// public page tokenises identically to the editor and the shared
// frappe-ui-code.css theme (`.prose pre .hljs-*`) lands 1-1.
//
// Built as a standalone IIFE by vite.highlight.config.js into
// wiki/public/js/wiki-highlight.bundle.js and loaded before code-blocks.js,
// which calls window.hljs.highlightAll().
import hljs from 'highlight.js/lib/common';

window.hljs = hljs;
