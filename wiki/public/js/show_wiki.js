window.ShowWiki = class ShowWiki {
	constructor(opts) {
		$("document").ready(() => {
			if (
				window.location.pathname != "/revisions" &&
				window.location.pathname != "/compare"
			) {
				this.activate_sidebars();
				this.set_active_sidebar();
				this.set_nav_buttons();
				this.set_toc_highlighter();
			}
		});
	}

	activate_sidebars() {
		$(".sidebar-item").each(function (index) {
			const active_class = "active";
			const non_active_class = "";
			let page_href = window.location.pathname;
			if (page_href.indexOf("#") !== -1) {
				page_href = page_href.slice(0, page_href.indexOf("#"));
			}
			if ($(this).data('route') == page_href) {
				$(this).addClass(active_class);
				$(this).find('a').addClass(active_class);
			}
		});
		// scroll the active sidebar item into view
		let active_sidebar_item = $(".sidebar-item.active");
		if (active_sidebar_item.length > 0) {
			active_sidebar_item
				.get(0)
				.scrollIntoView(true, {
					behavior: "smooth",
					block: "nearest",
				});
		}
	}

	toggle_sidebar(event) {
		$(event.currentTarget).parent().children("ul").toggleClass("hidden");
		$(event.currentTarget).find(".drop-icon").toggleClass("hidden");
		$(event.currentTarget).find(".drop-left").toggleClass("hidden");
		event.stopPropagation();
	}

	set_active_sidebar() {
		$(".doc-sidebar,.web-sidebar").on(
			"click",
			".collapsible",
			this.toggle_sidebar
		);
		$(".sidebar-group").children("ul").addClass("hidden");
		$(".sidebar-item.active")
			.parents(" .web-sidebar .sidebar-group>ul")
			.removeClass("hidden");
		const sidebar_groups = $(".sidebar-item.active").parents(
			".web-sidebar .sidebar-group"
		);
		sidebar_groups.each(function () {
			$(this).children(".collapsible").find(".drop-left").addClass("hidden");
		});
		sidebar_groups.each(function () {
			$(this).children(".collapsible").find(".drop-icon").removeClass("hidden");
		});
	}

	set_toc_highlighter() {
		$(document).ready(function() {
			$(window).scroll(function() {
				$(".page-toc a").removeClass("active")
				currentAnchor().addClass("active")
			})
		});

		function tocItem(anchor) {
			return $("[href=\"" + anchor + "\"]")
		}

		function heading(anchor) {
			return $("[id=" + anchor.substr(1) + "]")
		}

		var _anchors = null
		function anchors() {
			if (!_anchors) {
				_anchors = $(".page-toc a").map(function() {
					return $(this).attr("href")
				})
			}
			return _anchors
		}

		function currentAnchor() {
			var winY = window.pageYOffset
			var currAnchor = null
			anchors().each(function() {
				var y = heading(this).position().top
				if (y < winY + window.innerHeight * 0.23 ) {
					currAnchor = this
					return
				}
			})
			return tocItem(currAnchor)
		}
	}

	set_nav_buttons() {
		var current_index = -1;

		$(".sidebar-column")
			.find("a")
			.each(function (index) {
				if ($(this).attr("class")) {
					let dish = $(this).attr("class").split(/\s+/)[0];
					if (dish === "active") {
						current_index = index;
					}
				}
			});

		if (current_index != 0) {
			$(".btn.left")[0].href =
				$(".sidebar-column").find("a")[current_index - 1].href;
			$(".btn.left")[0].innerHTML =
				"←" + $(".sidebar-column").find("a")[current_index - 1].innerHTML;
		} else {
			$(".btn.left").hide();
		}

		if (current_index < $(".sidebar-column").find("a").length - 1) {
			$(".btn.right")[0].href =
				$(".sidebar-column").find("a")[current_index + 1].href;
			$(".btn.right")[0].innerHTML =
				$(".sidebar-column").find("a")[current_index + 1].innerHTML + "→";
		} else {
			$(".btn.right").hide();
		}
	}
};
