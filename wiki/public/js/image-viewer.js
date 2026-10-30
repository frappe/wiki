// Watches `root` because client-side navigation swaps its HTML.
export function bindImageViewer(root) {
  const viewer = ensureViewer();

  function attachListeners() {
    root.querySelectorAll("img").forEach((img) => {
      if (img.dataset.viewerBound) return;
      img.dataset.viewerBound = "true";
      img.style.cursor = "zoom-in";
      img.addEventListener("click", () => {
        const viewerImg = viewer.firstElementChild;
        // currentSrc is the dark file when a <picture> is showing it.
        viewerImg.src = img.currentSrc || img.src;
        viewerImg.alt = img.alt || "";
        viewerImg.toggleAttribute("data-theme-aware", Boolean(img.closest("picture")));
        viewer.classList.add("active");
        document.body.classList.add("image-viewer-open");
      });
    });
  }

  attachListeners();
  const observer = new MutationObserver(attachListeners);
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}

let viewer = null;

function ensureViewer() {
  if (viewer) return viewer;
  viewer = document.createElement("div");
  viewer.id = "image-viewer";
  const viewerImg = document.createElement("img");
  viewerImg.id = "image-viewer-img";
  viewer.appendChild(viewerImg);
  document.body.appendChild(viewer);

  viewer.addEventListener("click", close);

  viewer.addEventListener("transitionend", () => {
    if (!viewer.classList.contains("active")) {
      viewerImg.src = "";
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && viewer.classList.contains("active")) {
      close();
    }
  });

  viewer.addEventListener("touchmove", (e) => {
    e.preventDefault();
    close();
  });
  return viewer;
}

function close() {
  viewer.classList.remove("active");
  document.body.classList.remove("image-viewer-open");
}
