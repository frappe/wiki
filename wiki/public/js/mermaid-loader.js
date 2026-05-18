(function () {
  const defaultMermaidUrl = "/assets/wiki/js/vendor/mermaid/mermaid.min.js";

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
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
        });
        return mermaid;
      });
    }

    return window.__wikiMermaidPromise;
  };
})();
