(function () {
  let renderSeq = 0;
  let themeObserverAttached = false;

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "default";
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

    const { svg } = await mermaid.render(`wiki-mermaid-${++renderSeq}`, source);
    el.innerHTML = svg;
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
      // Always render in the theme that's active right now, not whatever the
      // theme happened to be when mermaid was first initialized.
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: currentTheme(),
      });
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
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: currentTheme(),
    });
    for (const el of rendered) {
      const source = el.getAttribute("data-mermaid-src");
      if (!source) continue;
      try {
        const { svg } = await mermaid.render(`wiki-mermaid-${++renderSeq}`, source);
        el.innerHTML = svg;
      } catch (error) {
        console.error("Failed to re-render Mermaid diagram:", error);
      }
    }
  }

  function attachThemeObserver() {
    if (themeObserverAttached) return;
    themeObserverAttached = true;

    let lastTheme = currentTheme();
    const observer = new MutationObserver(() => {
      const theme = currentTheme();
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
