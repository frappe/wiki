// A <picture>'s dark <source> follows the OS theme, not the wiki theme.
export function bindThemeImages(root) {
  function syncPictureSources() {
    const media =
      document.documentElement.getAttribute("data-theme") === "dark" ? "all" : "not all";
    root
      .querySelectorAll(
        'picture source[media="(prefers-color-scheme: dark)"], picture source[data-dark-source]',
      )
      .forEach((source) => {
        source.dataset.darkSource = "";
        if (source.media !== media) source.media = media;
      });
  }

  syncPictureSources();
  const themeObserver = new MutationObserver(syncPictureSources);
  themeObserver.observe(document.documentElement, { attributeFilter: ["data-theme"] });
  const contentObserver = new MutationObserver(syncPictureSources);
  contentObserver.observe(root, { childList: true, subtree: true });
  return () => {
    themeObserver.disconnect();
    contentObserver.disconnect();
  };
}
