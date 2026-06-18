(function () {
  const defaultMermaidUrl = "/assets/wiki/js/vendor/mermaid/mermaid.min.js";

  // Match the diagram theme to the reader's light/dark mode, which is stored on
  // <html data-theme> (set in layout.html from the `wiki-theme` preference).
  function currentMermaidTheme() {
    const theme = document.documentElement.getAttribute("data-theme");
    return theme === "dark" ? "dark" : "default";
  }

  window.__wikiMermaidPromise = window.__wikiMermaidPromise || null;

  window.wikiGetMermaid = function (options) {
    const mermaidUrl = options?.assetUrl || defaultMermaidUrl;

    if (window.mermaid) {
      return Promise.resolve(window.mermaid);
    }

    if (!window.__wikiMermaidPromise) {
      window.__wikiMermaidPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = mermaidUrl;
        script.onload = () => resolve(window.mermaid);
        script.onerror = () =>
          reject(new Error("Unable to load local Mermaid asset"));
        document.head.appendChild(script);
      }).then((mermaid) => {
        if (!mermaid) {
          throw new Error("Local Mermaid asset did not expose window.mermaid");
        }
        // securityLevel:"strict" sanitizes labels and disables click/script
        // directives — diagram source is untrusted, author-supplied content.
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: currentMermaidTheme(),
        });
        return mermaid;
      });
    }

    return window.__wikiMermaidPromise;
  };
})();
