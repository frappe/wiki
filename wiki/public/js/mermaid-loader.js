(function () {
  const defaultMermaidUrl = "/assets/wiki/js/vendor/mermaid/mermaid.min.js";

  // Build a Mermaid theme config from the live Frappe UI design tokens so
  // diagrams match the wiki's look instead of Mermaid's stock palette. We read
  // the *computed* token values (hex) every time: the tokens flip automatically
  // with `<html data-theme>`, so the same `base` + themeVariables mapping renders
  // correctly in both light and dark — no separate "dark"/"default" branch.
  //
  // Mermaid only allows themeVariables on the `base` theme, and its color engine
  // accepts hex (not CSS var() refs or named colors), which is exactly what the
  // Frappe UI gray tokens resolve to.
  function wikiMermaidThemeConfig() {
    const root = getComputedStyle(document.documentElement);
    const token = (name, fallback) =>
      root.getPropertyValue(name).trim() || fallback;

    const inkGray9 = token("--ink-gray-9", "#171717");
    const inkGray8 = token("--ink-gray-8", "#383838");
    const inkGray5 = token("--ink-gray-5", "#7c7c7c");
    const surfaceWhite = token("--surface-white", "#ffffff");
    const surfaceGray1 = token("--surface-gray-1", "#f8f8f8");
    const surfaceGray2 = token("--surface-gray-2", "#f3f3f3");
    const surfaceGray3 = token("--surface-gray-3", "#ededed");
    const outlineGray3 = token("--outline-gray-3", "#c7c7c7");

    const bodyFont =
      (document.body && getComputedStyle(document.body).fontFamily) ||
      'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

    return {
      theme: "base",
      fontFamily: bodyFont,
      // Render node labels as SVG <text>, not HTML <foreignObject>. The HTML
      // label path measures the text in a detached div and frequently sizes the
      // foreignObject a few px too narrow, clipping the last glyph ("Load
      // Balance|r"). SVG text is sized from the rendered glyph box, so it never
      // clips and stays styled by our theme tokens.
      htmlLabels: false,
      flowchart: { htmlLabels: false, useMaxWidth: true },
      themeVariables: {
        fontFamily: bodyFont,
        fontSize: "14px",

        // Nodes: subtle tinted surface with a clear neutral border + ink text.
        primaryColor: surfaceGray2,
        mainBkg: surfaceGray2,
        primaryBorderColor: outlineGray3,
        nodeBorder: outlineGray3,
        primaryTextColor: inkGray9,
        nodeTextColor: inkGray9,
        secondaryColor: surfaceGray3,
        tertiaryColor: surfaceGray1,

        background: surfaceWhite,
        titleColor: inkGray9,
        textColor: inkGray9,

        // Edges / arrows: medium-neutral lines, white-backed labels so they stay
        // legible over the figure's soft surface.
        lineColor: inkGray5,
        defaultLinkColor: inkGray5,
        edgeLabelBackground: surfaceWhite,

        // Subgraph clusters.
        clusterBkg: surfaceGray1,
        clusterBorder: outlineGray3,

        // Sequence diagrams.
        actorBkg: surfaceGray2,
        actorBorder: outlineGray3,
        actorTextColor: inkGray9,
        actorLineColor: outlineGray3,
        signalColor: inkGray5,
        signalTextColor: inkGray8,
        labelBoxBkgColor: surfaceGray2,
        labelBoxBorderColor: outlineGray3,
        labelTextColor: inkGray9,
        loopTextColor: inkGray9,
        noteBkgColor: surfaceGray3,
        noteBorderColor: outlineGray3,
        noteTextColor: inkGray9,
        activationBkgColor: surfaceGray3,
        activationBorderColor: outlineGray3,
      },
    };
  }

  window.wikiMermaidThemeConfig = wikiMermaidThemeConfig;

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
          ...wikiMermaidThemeConfig(),
        });
        return mermaid;
      });
    }

    return window.__wikiMermaidPromise;
  };
})();
