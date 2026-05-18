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

    try {
      const mermaid = await window.wikiGetMermaid();
      await mermaid.run({ nodes: diagrams });
    } catch (error) {
      console.error("Failed to render Mermaid diagrams:", error);
    }
  }

  document.addEventListener("DOMContentLoaded", () => renderWikiMermaid(document));
  window.renderWikiMermaid = renderWikiMermaid;
})();
