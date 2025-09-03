function add_link_to_headings() {
  $(".from-markdown")
    .not(".revision-content")
    .find("h1, h2, h3, h4, h5, h6")
    .each((i, $heading) => {
      const text = $heading.textContent.trim();
      $heading.id = text
        .replace(/[^\u00C0-\u1FFF\u2C00-\uD7FF\w\- ]/g, "")
        .replace(/[ ]/g, "-")
        .toLowerCase();

      let id = $heading.id;
      let $a = $('<a class="no-underline">')
        .prop("href", "#" + id)
        .attr("aria-hidden", "true").html(`
        <svg xmlns="http://www.w3.org/2000/svg" style="width: 0.8em; height: 0.8em;" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-link">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
        </svg>
      `);

      $a.on("click", function (e) {
        e.preventDefault();
        const navbarHeight = $(".navbar").height();
        const targetPosition = $($heading).offset().top;
        window.scrollTo({
          top: targetPosition - navbarHeight - 20,
          behavior: "smooth",
        });

        // Update URL hash without triggering scroll
        history.pushState(null, null, this.hash);
      });

      $($heading).append($a);
    });
}

function add_click_to_copy() {
  $("pre code")
    .parent("pre")
    .prepend(
      `<button title="Copy Code" class="btn copy-btn" data-toggle="tooltip"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-clipboard"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg></button>`,
    );

  $(".copy-btn").on("click", function () {
    frappe.utils.copy_to_clipboard($(this).siblings("code").text());
  });
}

function set_toc() {
  // Reset scroll event listener to avoid scroll jitterness
  $(window).off("scroll");
  $(document).ready(function () {
    $(window).scroll(function () {
      if (currentAnchor().not(".no-underline").hasClass("active")) return;
      $(".page-toc a").removeClass("active");
      currentAnchor().addClass("active");
    });

    const navbarHeight = $(".navbar").height();
    $(".page-toc a").click(function (e) {
      e.preventDefault();
      var target = $(this).attr("href");
      var offset = $(target).offset().top - navbarHeight - 50;
      $("html, body").animate(
        {
          scrollTop: offset,
        },
        100,
      );
    });
  });

  function tocItem(anchor) {
    return $('[href="' + anchor + '"]');
  }

  function heading(anchor) {
    return $("[id=" + anchor.substr(1) + "]");
  }

  var _anchors = null;
  function anchors() {
    if (!_anchors) {
      _anchors = $(".page-toc .list-unstyled a").map(function () {
        return $(this).attr("href");
      });
    }
    return _anchors;
  }

  function currentAnchor() {
    var winY = window.pageYOffset;
    var currAnchor = null;
    anchors().each(function () {
      var y = heading(this).position()?.top;
      if (y < winY + window.innerHeight * 0.23) {
        currAnchor = this;
        return;
      }
    });
    return tocItem(currAnchor);
  }
}

function toggleEditor() {
  $(".wiki-content").toggleClass("hide");
  $(".wiki-page-meta").toggleClass("hide");
  $(".wiki-footer").toggleClass("hide");
  $(".page-toc").toggleClass("hide");

  // avoid hiding editor when params ?editWiki or ?newWiki
  if ($(".from-markdown").is(":visible")) {
    $(".wiki-editor").toggleClass("hide");
  } else {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("editWiki") || urlParams.get("newWiki")) {
      $(".from-markdown").toggleClass("hide");
    }
  }

  $(".wiki-title").toggleClass("hide");
}

window.Wiki = class Wiki {
  activate_sidebars() {
    $(".sidebar-item").each(function (index) {
      const active_class = "active";
      let page_href = decodeURIComponent(window.location.pathname.slice(1));
      if (page_href.indexOf("#") !== -1) {
        page_href = page_href.slice(0, page_href.indexOf("#"));
      }
      if ($(this).data("route") == page_href) {
        $(this).addClass(active_class);
        $(this).find("a").addClass(active_class);

        const element = $(this);
        setTimeout(function () {
          const topOffset = element.position().top;
          $(".doc-sidebar .web-sidebar")
            .get(0)
            .scrollTo(0, topOffset - 200);
        }, 50);
      }

      $($(this))
        .find("a")
        // For iPad, touchstart listener is needed to recognize click.
        .on("click touchstart", (e) => {
          e.preventDefault();
          const href = $(e.currentTarget).attr("href");
          const urlParams = new URLSearchParams(window.location.search);

          // Toggle between content and contributions view
          $(".contributions-view").addClass("d-none");
          $(".doc-main").removeClass("d-none");
          $(".page-toc").addClass("d-xl-block");

          if (urlParams.get("editWiki") || urlParams.get("newWiki")) {
            toggleEditor();
          }
          loadWikiPage(href, e.currentTarget);
          $("html, body").animate(
            {
              scrollTop: 0,
            },
            100,
          );
          $(".navbar-toggler").click();
        });
    });
  }

  toggle_sidebar(event) {
    $(event.currentTarget).parent().children("ul").toggleClass("hidden");
    $(event.currentTarget).find(".icon").toggleClass("rotate");
    event.stopPropagation();
  }

  set_active_sidebar() {
    $(".doc-sidebar,.web-sidebar").on(
      "click",
      ".collapsible",
      this.toggle_sidebar,
    );

    // For iPad, touchstart listener is needed to recognize click.
    $(".doc-sidebar,.web-sidebar").on(
      "click",
      "touchstart",
      ".collapsible",
      this.toggle_sidebar,
    );

    $(".sidebar-item.active")
      .parents(" .web-sidebar .sidebar-group>ul")
      .removeClass("hidden");

    $(".sidebar-item.active")
      .parents(" .web-sidebar .sidebar-group")
      .find(".icon")
      .addClass("rotate");
  }

  scrolltotop() {
    $("html,body").animate({ scrollTop: 0 }, 0);
  }

  set_last_updated_date() {
    const lastUpdatedDate = frappe.datetime.prettyDate(
      $(".user-contributions").data("date"),
    );
    $(".user-contributions").append(`last updated ${lastUpdatedDate}`);
  }

  set_darkmode_button() {
    function getDarkModeState() {
      const isUserPreferenceDarkMode = localStorage.getItem("darkMode");
      const isSystemPreferenceDarkMode = window.matchMedia?.(
        "(prefers-color-scheme: dark)",
      )?.matches;
      const darkModeState = isUserPreferenceDarkMode
        ? isUserPreferenceDarkMode == "true"
        : isSystemPreferenceDarkMode;

      return darkModeState;
    }

    function switchBanner() {
      const altSrc = $(".navbar-brand img").data("alt-src");
      const src = $(".navbar-brand img").attr("src");
      if (
        !["{{ light_mode_logo }}", "{{ dark_mode_logo }}", "None", ""].includes(
          altSrc,
        )
      ) {
        $(".navbar-brand img").attr("src", altSrc);
        $(".navbar-brand img").data("alt-src", src);
      }
    }

    if (getDarkModeState()) {
      $(".sun-moon-container .feather-sun").removeClass("hide");
      $("body").addClass("dark");
      switchBanner();
    } else {
      $(".sun-moon-container .feather-moon").removeClass("hide");
      $("body").removeClass("dark");
    }

    $(".sun-moon-container").on("click", function () {
      $(".sun-moon-container .feather-sun").toggleClass("hide");
      $(".sun-moon-container .feather-moon").toggleClass("hide");
      const currentMode = getDarkModeState();
      localStorage.setItem("darkMode", !currentMode);
      switchBanner();

      $("body").toggleClass("dark");
    });
  }

  set_toc() {
    set_toc();
  }

  add_link_to_headings() {
    add_link_to_headings();
  }

  add_click_to_copy() {
    add_click_to_copy();
  }
};

$("#navbar-dropdown").on("click", function (e) {
  e.stopPropagation();
  $("#navbar-dropdown-content").toggleClass("hide");
});

$(document).on("click", function (e) {
  if (
    !$(e.target).closest("#navbar-dropdown, #navbar-dropdown-content").length
  ) {
    $("#navbar-dropdown-content").addClass("hide");
  }
});

function loadWikiPage(url, pageElement, replaceState = false) {
  $(".main-column, .page-toc").toggleClass("pulse");
  // Update URL and history state
  const historyMethod = replaceState ? "replaceState" : "pushState";
  window[`history`][historyMethod](
    {
      pageName: $(pageElement).closest(".sidebar-item").data("name"),
      url: url,
    },
    "",
    url,
  );

  // Get the wiki page name from the parent element's data attribute
  const pageName = $(pageElement).closest(".sidebar-item").data("name");

  // Update wiki page name for other functions
  wikiPageName = pageName;

  // Save wiki page name on input used by editor.js and render_wiki.js
  $('[name="wiki-page-name"]').val(wikiPageName);

  frappe.call({
    method: "wiki.wiki.doctype.wiki_page.wiki_page.get_page_content",
    args: { wiki_page_name: pageName },
    callback: (r) => {
      if (r.message) {
        $(".wiki-content").html(r.message.content);

        $(".wiki-title").html(r.message.title);

        $("title").text(r.message.title);

        if (r.message.toc_html) {
          $(".page-toc .list-unstyled").html(r.message.toc_html);
        }

        // Update active sidebar item
        $(".sidebar-item").removeClass("active");
        $(".sidebar-item").find("a").removeClass("active");
        $(pageElement).closest(".sidebar-item").addClass("active");
        $(pageElement).addClass("active");

        let nextPage = r.message.next_page;
        let prevPage = r.message.prev_page;

        if (nextPage) {
          $(".footer-next-page-link")
            .removeClass("hide")
            .attr("href", `/${nextPage.route}`);
          $(".footer-next-page").text(nextPage.title);
        } else {
          $(".footer-next-page-link").addClass("hide");
        }

        if (prevPage) {
          $(".footer-prev-page-link")
            .removeClass("hide")
            .attr("href", `/${prevPage.route}`);
          $(".footer-prev-page").text(prevPage.title);
        } else {
          $(".footer-prev-page-link").addClass("hide");
        }

        // Re-initialize necessary components
        add_link_to_headings();
        add_click_to_copy();
        set_toc();
        hljs.configure({
          languages: ["python", "html", "css", "javascript", "shell", "bash"],
        });
        hljs.highlightAll();
      }
      $(".main-column, .page-toc").toggleClass("pulse");
    },
  });
}

window.addEventListener("popstate", function (event) {
  // Don't process if it's just a hash change
  const hasHashFragment = window.location.hash.length > 0;
  if (hasHashFragment) {
    return;
  }

  if (event.state && event.state.pageName) {
    const sidebarItem = $(`.sidebar-item[data-name="${event.state.pageName}"]`);
    if (sidebarItem.length) {
      const pageElement = sidebarItem.find("a")[0];
      loadWikiPage(event.state.url, pageElement, true);
    }
  } else {
    // Fallback to path-based lookup
    const path = window.location.pathname;
    const sidebarItem = $(`.sidebar-item[data-route="${path.slice(1)}"]`);
    if (sidebarItem.length) {
      const pageElement = sidebarItem.find("a")[0];
      loadWikiPage(path, pageElement, true);
    }
  }
});
