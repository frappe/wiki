(function () {
  const mermaidUrl = "/assets/wiki/js/vendor/mermaid/mermaid.min.js";
  let mermaidPromise = null;

  function getMermaid() {
    if (window.mermaid) {
      return Promise.resolve(window.mermaid);
    }

    if (!mermaidPromise) {
      mermaidPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = mermaidUrl;
        script.onload = () => resolve(window.mermaid);
        script.onerror = () => reject(new Error("Unable to load local Mermaid asset"));
        document.head.appendChild(script);
      }).then((mermaid) => {
        if (!mermaid) {
          throw new Error("Local Mermaid asset did not expose window.mermaid");
        }
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
        });
        return mermaid;
      });
    }

    return mermaidPromise;
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
      const mermaid = await getMermaid();
      await mermaid.run({ nodes: diagrams });
    } catch (error) {
      console.error("Failed to render Mermaid diagrams:", error);
    }
  }

  document.addEventListener("DOMContentLoaded", () => renderWikiMermaid(document));
  window.renderWikiMermaid = renderWikiMermaid;
})();
