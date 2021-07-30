frappe.provide('wiki')
wiki.Wiki = class Wiki {
	activate_sidebars() {
		$(".sidebar-item").each(function (index) {
			const active_class = "active";
			let page_href = window.location.pathname;
			if (page_href.indexOf("#") !== -1) {
				page_href = page_href.slice(0, page_href.indexOf("#"));
			}
			if ($(this).data("route") == page_href) {
				$(this).addClass(active_class);
				$(this).find("a").addClass(active_class);
			}
		});
		// scroll the active sidebar item into view
		let active_sidebar_item = $(".sidebar-item.active");
		if (active_sidebar_item.length > 0) {
			active_sidebar_item.get(0).scrollIntoView(true, {
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
};
