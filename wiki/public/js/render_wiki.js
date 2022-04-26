window.RenderWiki = class RenderWiki extends Wiki {
	constructor(opts) {
		super();
		$("document").ready(() => {
			if (
				window.location.pathname != "/revisions" &&
				window.location.pathname != "/compare"
			) {
				this.activate_sidebars();
				this.set_active_sidebar();
				this.set_nav_buttons();
				this.set_toc_highlighter();
				this.scrolltotop()
			}
		});
	}

	set_toc_highlighter() {
		$(document).ready(function () {
			$(window).scroll(function () {
				if (currentAnchor().not('.no-underline').hasClass("active")) return
				$(".page-toc a").removeClass("active");
				currentAnchor().addClass("active");
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
				_anchors = $(".page-toc a").map(function () {
					return $(this).attr("href");
				});
			}
			return _anchors;
		}

		function currentAnchor() {
			var winY = window.pageYOffset;
			var currAnchor = null;
			anchors().each(function () {
				var y = heading(this).position().top;
				if (y < winY + window.innerHeight * 0.23) {
					currAnchor = this;
					return;
				}
			});
			return tocItem(currAnchor);
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

		if (current_index > 0) {
			$(".btn.left")[0].href =
				$(".sidebar-column").find("a")[current_index - 1].href;
			$(".btn.left")[0].innerHTML =
				"←" + $(".sidebar-column").find("a")[current_index - 1].innerHTML;
		} else {
			$(".btn.left").hide();
		}

		if (current_index >= 0 && current_index < $(".sidebar-column").find("a").length - 1) {
			$(".btn.right")[0].href =
				$(".sidebar-column").find("a")[current_index + 1].href;
			$(".btn.right")[0].innerHTML =
				$(".sidebar-column").find("a")[current_index + 1].innerHTML + "→";
		} else {
			$(".btn.right").hide();
		}
	}
};
