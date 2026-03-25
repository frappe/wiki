(function () {
  const viewer = document.getElementById("image-viewer");
  const viewerImg = document.getElementById("image-viewer-img");
  if (!viewer || !viewerImg) return;

  function attachListeners() {
    document.querySelectorAll("#wiki-content img").forEach((img) => {
      if (img.dataset.viewerBound) return;
      img.dataset.viewerBound = "true";
      img.style.cursor = "zoom-in";
      img.addEventListener("click", () => {
        viewerImg.src = img.src;
        viewerImg.alt = img.alt || "";
        viewer.classList.add("active");
        document.body.classList.add("image-viewer-open");
      });
    });
  }

  function close() {
    viewer.classList.remove("active");
    document.body.classList.remove("image-viewer-open");
  }

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

  // Wire up images on initial load
  attachListeners();

  // Re-wire after SPA navigation replaces #wiki-content innerHTML
  const content = document.getElementById("wiki-content");
  if (content) {
    new MutationObserver(attachListeners).observe(content, {
      childList: true,
      subtree: true,
    });
  }
})();
