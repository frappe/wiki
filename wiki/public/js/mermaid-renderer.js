(function () {
  let renderSeq = 0;
  let themeObserverAttached = false;

  // Mermaid sizes each node from the label's measured width. If it measures
  // before the web font (Inter) has loaded, it sizes against a narrower fallback
  // and the real font then overflows — the last glyph clips ("Load Balance|r").
  // Wait for fonts to settle so the measurement matches what actually renders.
  async function waitForFonts() {
    try {
      if (document.fonts?.ready) await document.fonts.ready;
    } catch (error) {
      /* fonts API unavailable — fall through and render anyway */
    }
  }

  // Theme tokens are resolved live from the page's Frappe UI variables (see
  // mermaid-loader.js), so this single config renders correctly in light/dark.
  function applyTheme(mermaid) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      ...window.wikiMermaidThemeConfig(),
    });
  }

  // mermaid.render() replaces the element's content with the rendered SVG, so the
  // original diagram source must be stashed the first time to allow re-rendering
  // (e.g. when the reader toggles light/dark). The server emits the source as the
  // element's text; capture it before the first render overwrites it.
  async function renderInto(mermaid, el) {
    let source = el.getAttribute("data-mermaid-src");
    if (source === null) {
      source = (el.textContent || "").trim();
      el.setAttribute("data-mermaid-src", source);
    }
    if (!source) return;

    const id = `wiki-mermaid-${++renderSeq}`;
    try {
      const { svg } = await mermaid.render(id, source);
      el.innerHTML = svg;
    } finally {
      // mermaid.render() leaves its temporary "d<id>" container on <body> when
      // the source is invalid (the error "bomb"); drop it so it never lingers.
      document.getElementById(`d${id}`)?.remove();
    }
    el.setAttribute("data-processed", "true");
  }

  async function renderWikiMermaid(root) {
    const scope = root || document;
    if (!scope.querySelectorAll) return;

    const content =
      scope.id === "wiki-content" ? scope : scope.querySelector("#wiki-content");
    if (!content) return;

    const diagrams = Array.from(
      content.querySelectorAll(".mermaid:not([data-processed])"),
    );
    if (!diagrams.length) return;

    try {
      const mermaid = await window.wikiGetMermaid();
      await waitForFonts();
      // Always render with the theme that's active right now, not whatever the
      // theme happened to be when mermaid was first initialized.
      applyTheme(mermaid);
      for (const el of diagrams) {
        try {
          await renderInto(mermaid, el);
        } catch (error) {
          console.error("Failed to render Mermaid diagram:", error);
        }
      }
      attachThemeObserver();
    } catch (error) {
      console.error("Failed to load Mermaid:", error);
    }
  }

  // Re-render every already-rendered diagram from its stashed source when the
  // page theme flips, so a dark diagram never lingers on a light page (or vice
  // versa). Only runs once mermaid is loaded — diagram-free pages stay untouched.
  async function rerenderForTheme() {
    if (!window.mermaid) return;

    const rendered = Array.from(
      document.querySelectorAll(".mermaid[data-mermaid-src]"),
    );
    if (!rendered.length) return;

    const mermaid = window.mermaid;
    await waitForFonts();
    applyTheme(mermaid);
    for (const el of rendered) {
      const source = el.getAttribute("data-mermaid-src");
      if (!source) continue;
      const id = `wiki-mermaid-${++renderSeq}`;
      try {
        const { svg } = await mermaid.render(id, source);
        el.innerHTML = svg;
      } catch (error) {
        console.error("Failed to re-render Mermaid diagram:", error);
      } finally {
        document.getElementById(`d${id}`)?.remove();
      }
    }
  }

  function attachThemeObserver() {
    if (themeObserverAttached) return;
    themeObserverAttached = true;

    const readTheme = () =>
      document.documentElement.getAttribute("data-theme") || "light";
    let lastTheme = readTheme();
    const observer = new MutationObserver(() => {
      const theme = readTheme();
      if (theme !== lastTheme) {
        lastTheme = theme;
        rerenderForTheme();
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }

  document.addEventListener("DOMContentLoaded", () => renderWikiMermaid(document));
  window.renderWikiMermaid = renderWikiMermaid;
})();
