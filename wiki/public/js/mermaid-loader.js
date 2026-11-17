(function () {
  // The vendored bundle is served with far-future `immutable` caching, so the
  // bare path would keep serving the previously fetched copy after a version
  // bump. Bump this alongside the file in vendor/pele/.
  const PELE_VERSION = "1.6.0";
  const peleUrl = "/assets/wiki/js/vendor/pele/pele.global.js?v=" + PELE_VERSION;

  // Diagram source is untrusted, author-supplied content: no links, and no
  // images that would make readers' browsers fetch arbitrary URLs. Keep the
  // direction the author wrote: the reader column is narrower than Pele's
  // flip-to-vertical breakpoint, so every LR flowchart would turn TD.
  const MOUNT_OPTIONS = { links: false, images: false, autoDirection: false };

  let mountPromise = null;

  // Resolves to mountMermaid(element, source), which draws the diagram into the
  // element and returns Pele's handle for update() / destroy().
  window.wikiGetMermaid = function () {
    if (!mountPromise) {
      mountPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = peleUrl;
        script.onload = () =>
          window.pele
            ? resolve(window.pele)
            : reject(new Error("Pele asset did not expose window.pele"));
        script.onerror = () => reject(new Error("Unable to load Pele asset"));
        document.head.appendChild(script);
      }).then(
        (pele) => (element, source) =>
          pele.mount(element, source, {
            ...MOUNT_OPTIONS,
            onRender: () => inkSliceLabels(element),
          }),
      );
    }
    return mountPromise;
  };

  // Pele prints every pie label in one color, but the frappe-ui chart ramp
  // alternates a dark and a pale member of each hue. Ink each label the way
  // frappe-ui charts do: white on the dark (odd) slots, --chart-inside-label on
  // the pale (even) ones. Labels and slices share one transform.
  function inkSliceLabels(element) {
    const slices = Array.from(element.querySelectorAll(".pele-slice"));
    const labels = element.querySelectorAll(".pele-slice-labels[fill] text");
    for (const label of labels) {
      const point = new DOMPoint(label.getAttribute("x"), label.getAttribute("y"));
      const slice = slices.find((path) => path.isPointInFill(point));
      const series = slice?.getAttribute("fill").match(/--pele-series-(\d+)/)?.[1];
      if (series) {
        label.style.fill = series % 2 ? "#fff" : "var(--chart-inside-label)";
      }
    }
  }
})();
