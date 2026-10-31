// Draws each mermaid block in `root` that has not been drawn yet.
// `getMount` resolves to mountMermaid(element, source), see mermaid-loader.js.
export async function renderMermaid(root, getMount) {
  // Claimed before the await, or a second call in the meantime takes the same
  // diagrams and reads the drawn labels back as their source.
  const diagrams = Array.from(
    root.querySelectorAll(".mermaid:not([data-processed])"),
    (el) => {
      // The server emits the source as the element's text; mount() replaces it.
      const source = (el.textContent || "").trim();
      // Set before mount(): the figure styling switches the <pre> font to the
      // body font, which mount() reads to measure labels.
      el.setAttribute("data-processed", "true");
      return { el, source };
    },
  );
  if (!diagrams.length) return;

  let mountMermaid;
  try {
    mountMermaid = await getMount();
  } catch (error) {
    console.error("Failed to load Mermaid renderer:", error);
    return;
  }

  for (const { el, source } of diagrams) {
    if (source) mountMermaid(el, source);
  }
}
