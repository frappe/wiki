(function () {
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

    let mountMermaid;
    try {
      mountMermaid = await window.wikiGetMermaid();
    } catch (error) {
      console.error("Failed to load Mermaid renderer:", error);
      return;
    }

    for (const el of diagrams) {
      // The server emits the source as the element's text; mount() replaces it.
      const source = (el.textContent || "").trim();
      // Set first: the figure styling switches the <pre> font to the body font,
      // which mount() reads to measure labels.
      el.setAttribute("data-processed", "true");
      if (source) mountMermaid(el, source);
    }
  }

  document.addEventListener("DOMContentLoaded", () => renderWikiMermaid(document));
  window.renderWikiMermaid = renderWikiMermaid;
})();
