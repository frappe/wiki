// Draws each mermaid block in `root` that has not been drawn yet.
// `getMount` resolves to mountMermaid(element, source), see mermaid-loader.js.
export async function renderMermaid(root, getMount) {
  const diagrams = Array.from(
    root.querySelectorAll(".mermaid:not([data-processed])"),
  );
  if (!diagrams.length) return;

  let mountMermaid;
  try {
    mountMermaid = await getMount();
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
