window.EditAsset = class EditAsset {
	constructor() {
		this.make_code_field_group();
		this.add_attachment_popover();
		// remove this once the pr related to code editor max lines is merged
		this.set_code_editor_height();
		this.render_preview();
		this.add_attachment_handler();
		this.set_listeners();
		this.create_comment_box();
		this.make_title_editable();
		this.render_sidebar_diff()
	}

	make_code_field_group() {
		this.code_field_group = new frappe.ui.FieldGroup({
			fields: [
				{
					fieldname: "type",
					fieldtype: "Select",
					default: "Rich-Text",
					options: "Markdown\nRich-Text",
				},
				{
					fieldtype: "Column Break",
				},
				{
					fieldname: "attachment_controls",
					fieldtype: "HTML",
					options: this.get_attachment_controls_html(),
					depends_on: 'eval:doc.type=="Markdown"',
				},
				{
					fieldtype: "Section Break",
				},
				{
					fieldname: "code_html",
					fieldtype: "Text Editor",
					default: $(".wiki-content-html").html(),
					depends_on: 'eval:doc.type=="Rich-Text"',
				},
				{
					fieldname: "code_md",
					fieldtype: "Code",
					options: "Markdown",
					wrap: true,
					max_lines: Infinity,
					min_lines: 20,
					default: $(".wiki-content-md").html().replaceAll('&gt;', '>'),
					depends_on: 'eval:doc.type=="Markdown"',
				},
			],
			body: $(".wiki-write").get(0),
		});
		this.code_field_group.make();
		$(".wiki-write .form-section:last").removeClass("empty-section");
	}

	get_attachment_controls_html() {
		return `
			<div class='attachment-controls '>
				<div class='show-attachments'>
					${this.get_show_uploads_svg()}
						<span class='number'>0</span>&nbsp;attachments
				</div>&nbsp;&nbsp;
				<div class='add-attachment-wiki'>
					<span class='btn'>
					${this.get_upload_image_svg()}
						Upload Attachment
					</span>
				</div>
			</div>
		`;
	}

	get_show_uploads_svg() {
		return `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path d="M12.6004 6.68841L7.6414 11.5616C6.23259 12.946 3.8658 12.946 2.45699 11.5616C1.04819 10.1772
			1.04819 7.85132 2.45699 6.4669L6.85247 2.14749C7.86681 1.15071 9.44467 1.15071 10.459 2.14749C11.4733
			3.14428 11.4733 4.69483 10.459 5.69162L6.40165 9.62339C5.83813 10.1772 4.93649 10.1772 4.42932 9.62339C3.8658
			9.06962 3.8658 8.18359 4.42932 7.68519L7.81045 4.36257" stroke="#2D95F0" stroke-miterlimit="10" stroke-linecap="round"/>
		</svg>`
	}

	get_upload_image_svg() {
		return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path d="M8 14.5C11.5899 14.5 14.5 11.5899 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5C4.41015 1.5 1.5 4.41015 1.5 8C1.5 11.5899
			 4.41015 14.5 8 14.5Z" stroke="#505A62" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/>
			<path d="M8 4.75V11.1351" stroke="#505A62" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/>
			<path d="M5.29102 7.45833L7.99935 4.75L10.7077 7.45833" stroke="#505A62" stroke-miterlimit="10" stroke-linecap="round" 
			stroke-linejoin="round"/>
		</svg>`

	}

	add_attachment_popover() {
		$(".show-attachments").popover({
			trigger: "click",
			placement: "bottom",

			content: () => {
				return this.build_attachment_table();
			},
			html: true,
		});
	}

	build_attachment_table() {
		var wrapper = $('<div class="wiki-attachment"></div>');
		wrapper.empty();

		var table = $(this.get_attachment_table_header_html()).appendTo(wrapper);
		if (!this.attachments || !this.attachments.length)
			return "No attachments uploaded";

		this.attachments.forEach((f) => {
			const row = $("<tr></tr>").appendTo(table.find("tbody"));
			$(`<td>${f.file_name}</td>`).appendTo(row);
			$(`<td>
			<a class="btn btn-default btn-xs btn-primary-light text-nowrap copy-link" data-link="![](${f.file_url})" data-name = "${f.file_name}" >
				Copy Link
			</a>
			</td>`).appendTo(row);
			$(`<td>

			<a class="btn btn-default btn-xs  center delete-button"  data-name = "${f.file_name}" >
			<svg class="icon icon-sm"><use xlink:href="#icon-delete"></use></svg>

			</a>
			</td>`).appendTo(row);
		});
		return wrapper;
	}

	get_attachment_table_header_html() {
		return `<table class="table  attachment-table" ">
			<tbody></tbody>
		</table>`;
	}

	set_code_editor_height() {
		setTimeout(() => {
			// expand_code_editor
			const code_md = this.code_field_group.get_field("code_md");
			code_md.expanded = !this.expanded;
			code_md.refresh_height();
			code_md.toggle_label();
		}, 120);
	}

	raise_patch() {
		var side = {};

		let name = $(".doc-sidebar .web-sidebar").get(0).dataset.name;
		side[name] = [];
		let items = $($(".doc-sidebar .web-sidebar").get(0))
			.children(".sidebar-items")
			.children("ul")
			.not(".hidden")
			.children("li");
		items.each((item) => {
			if (!items[item].dataset.name) return;
			side[name].push({
				name: items[item].dataset.name,
				type: items[item].dataset.type,
				new: items[item].dataset.new,
				title: items[item].dataset.title,
				group_name: items[item].dataset.groupName,
			});
		});

		$('.doc-sidebar [data-type="Wiki Sidebar"]').each(function () {
			let name = $(this).get(0).dataset.groupName;
			side[name] = [];
			let items = $(this).children("ul").children("li");
			items.each((item) => {
				if (!items[item].dataset.name) return;
				side[name].push({
					name: items[item].dataset.name,
					type: items[item].dataset.type,
					new: items[item].dataset.new,
					title: items[item].dataset.title,
					group_name: items[item].dataset.groupName,
				});
			});
		});

		var me = this;
		var dfs = [];
		const title_of_page = $('.edit-title span').text();
		dfs.push(
			{
				fieldname: "edit_message",
				fieldtype: "Text",
				label: "Message",
				default: $('[name="new"]').val()
					? `Add new page: ${title_of_page}`
					: `Edited ${title_of_page}`,
				mandatory: 1,
			},
			{
				fieldname: "sidebar_edited",
				fieldtype: "Check",
				label: "I updated the sidebar",
				default: $('[name="new"]').val() ? 1 : 0,
			}
		);

		let dialog = new frappe.ui.Dialog({
			fields: dfs,
			title: __("Please describe your changes"),
			primary_action_label: __("Submit Changes"),
			primary_action: function () {
				frappe.call({
					method: "wiki.wiki.doctype.wiki_page.wiki_page.update",
					args: {
						name: $('[name="wiki_page"]').val(),
						wiki_page_patch: $('[name="wiki_page_patch"]').val(),
						message: this.get_value("edit_message"),
						sidebar_edited: this.get_value("sidebar_edited"),
						content: me.content,
						type: me.code_field_group.get_value("type"),
						attachments: me.attachments,
						new: $('[name="new"]').val(),
						title: $('.edit-title span').text(),
						new_sidebar: $(".doc-sidebar").get(0).innerHTML,
						new_sidebar_items: side,
					},
					callback: (r) => {
						if (!r.message.approved) {
							frappe.msgprint({
								message:
									"A Change Request has been created. You can track your requests on the contributions page",
								indicator: "green",
								title: "Change Request Created",
								alert: 1
							});
						}

						// route back to the main page
						window.location.href = '/' + r.message.route;
					},
					freeze: true,
				});
				dialog.hide();
				$("#freeze").addClass("show");
			},
		});
		dialog.show();
	}

	render_preview() {
		$('a[data-toggle="tab"]').on("click", (e) => {
			let activeTab = $(e.target);

			if (
				activeTab.prop("id") === "preview-tab" ||
				activeTab.prop("id") === "diff-tab"
			) {
				let $preview = $(".wiki-preview");
				let $diff = $(".wiki-diff");
				const type = this.code_field_group.get_value("type");
				let content = "";
				if (type == "Markdown") {
					content = this.code_field_group.get_value("code_md");
				} else {
					content = this.code_field_group.get_value("code_html");
					var turndownService = new TurndownService();
					turndownService = turndownService.keep(["div class", "iframe"]);
					content = turndownService.turndown(content);
				}
				if (!content) {
					this.set_empty_message($preview, $diff);
					return;
				}
				this.set_loading_message($preview, $diff);

				frappe.call({
					method: "wiki.wiki.doctype.wiki_page.wiki_page.preview",
					args: {
						content: content,
						type: type,
						path: this.route,
						name: $('[name="wiki_page"]').val(),
						attachments: this.attachments,
						new: $('[name="new"]').val(),
					},
					callback: (r) => {
						if (r.message) {
							$preview.html(r.message.html);
							if (!$('[name="new"]').val()) {
								const empty_diff = `<div class="text-muted center"> No Changes made</div>`
								const diff_html = $(r.message.diff).find('.insert, .delete').length?r.message.diff:empty_diff
								$diff.html(diff_html);
							}
						}
					},
				});
			}
		});
	}

	set_empty_message($preview, $diff) {
		$preview.html("<div>Please add some code</div>");
		$diff.html("<div>Please add some code</div>");
	}

	set_loading_message($preview, $diff) {
		$preview.html("Loading preview...");
		$diff.html("Loading diff...");
	}

	add_attachment_handler() {
		var me = this;
		$(".add-attachment-wiki").click(function () {
			me.new_attachment();
		});
		$(".submit-wiki-page").click(function () {
			me.get_markdown();
		});

		$(".approve-wiki-page").click(function () {
			me.approve_wiki_page();
		});
	}

	new_attachment() {
		if (this.dialog) {
			// remove upload dialog
			this.dialog.$wrapper.remove();
		}

		new frappe.ui.FileUploader({
			folder: "Home/Attachments",
			on_success: (file_doc) => {
				if (!this.attachments) this.attachments = [];
				if (!this.save_paths) this.save_paths = {};
				this.attachments.push(file_doc);
				$(".wiki-attachment").empty().append(this.build_attachment_table());
				$(".attachment-controls").find(".number").text(this.attachments.length);
			},
		});
	}

	get_markdown() {
		var me = this;

		if (me.code_field_group.get_value("type") == "Markdown") {
			this.content = me.code_field_group.get_value("code_md");
			this.raise_patch();
		} else {
			this.content = this.code_field_group.get_value("code_html");

			frappe.call({
				method:
					"wiki.wiki.doctype.wiki_page.wiki_page.extract_images_from_html",
				args: {
					content: this.content,
				},
				callback: (r) => {
					if (r.message) {
						me.content = r.message;
						var turndownService = new TurndownService();
						turndownService = turndownService.keep(["div class", "iframe"]);
						me.content = turndownService.turndown(me.content);
						me.raise_patch();
					}
				},
			});
		}
	}

	set_listeners() {
		var me = this;

		$(`body`).on("click", `.copy-link`, function () {
			frappe.utils.copy_to_clipboard($(this).attr("data-link"));
		});

		$(`body`).on("click", `.delete-button`, function () {
			frappe.confirm(
				`Are you sure you want to delete the file "${$(this).attr(
					"data-name"
				)}"`,
				() => {
					me.attachments.forEach((f, index, object) => {
						if (f.file_name == $(this).attr("data-name")) {
							object.splice(index, 1);
						}
					});
					$(".wiki-attachment").empty().append(me.build_attachment_table());
					$(".attachment-controls").find(".number").text(me.attachments.length);
				}
			);
		});
	}

	create_comment_box() {
		this.comment_box = frappe.ui.form.make_control({
			parent: $(".comment-box"),
			df: {
				fieldname: "new_comment",
				fieldtype: "Comment",
			},
			enable_mentions: false,
			render_input: true,
			only_input: true,
			on_submit: (comment) => {
				this.add_comment_to_patch(comment);
			},
		});
	}

	add_comment_to_patch(comment) {
		if (strip_html(comment).trim() != "") {
			this.comment_box.disable();

			frappe.call({
				method:
					"wiki.wiki.doctype.wiki_page_patch.wiki_page_patch.add_comment_to_patch",
				args: {
					reference_name: $('[name="wiki_page_patch"]').val(),
					content: comment,
					comment_email: frappe.session.user,
					comment_by: frappe.session.user_fullname,
				},
				callback: (r) => {
					comment = r.message;

					this.display_new_comment(comment, this.comment_box);
				},
				always: () => {
					this.comment_box.enable();
				},
			});
		}
	}

	display_new_comment(comment, comment_box) {
		if (comment) {
			comment_box.set_value("");

			const new_comment = this.get_comment_html(
				comment.owner,
				comment.creation,
				comment.timepassed,
				comment.content
			);

			$(".timeline-items").prepend(new_comment);
		}
	}

	get_comment_html(owner, creation, timepassed, content) {
		return $(`
			<div class="timeline-item">
				<div class="timeline-badge">
					<svg class="icon icon-md">
						<use href="#icon-small-message"></use>
					</svg>
				</div>
				<div class="timeline-content frappe-card">
					<div class="timeline-message-box">
						<span class="flex justify-between">
							<span class="text-color flex">
								<span>
									${owner}
									<span class="text-muted margin-left">
										<span class="frappe-timestamp "
											data-timestamp="${creation}"
											title="${creation}">${timepassed}</span>
									</span>
								</span>
							</span>
						</span>
						<div class="content">
							${content}
						</div>
					</div>
				</div>
			</div>
		`);
	}

	make_title_editable() {
		const title_span = $(".edit-title>span");
		const title_handle = $(".edit-title>i");
		const title_input = $(".edit-title>input");
		title_handle.click(() => {
			title_span.addClass("hide");
			title_handle.addClass("hide");
			title_input.removeClass("hide");
			title_input.val(title_span.text());
			title_input.focus();
		});
		title_input.focusout(() => {
			title_span.removeClass("hide");
			title_handle.removeClass("hide");
			title_input.addClass("hide");
			title_span.text(title_input.val());
		});
	}

	approve_wiki_page() {
		frappe.call({
			method: "wiki.wiki.doctype.wiki_page.wiki_page.approve",
			args: {
				wiki_page_patch: $('[name="wiki_page_patch"]').val(),
			},
			callback: () => {
				frappe.msgprint({
					message:
						"The Change has been approved.",
					indicator: "green",
					title: "Approved",
				});
				window.location.href = '/' + $('[name="wiki_page"]').val();
			},
			freeze: true,
		});

	}

	render_sidebar_diff() {
		const lis = $(".sidebar-diff");
		const sidebar_items = JSON.parse($('[name="new_sidebar_items"]').val());
		lis.empty();
		for (let sidebar in sidebar_items) {
			for (let item in sidebar_items[sidebar]) {
				let class_name = ("." + sidebar).replaceAll("/", "\\/");
				let target = lis.find(class_name);
				if (!target.length) {
					target = $(".sidebar-diff");
				}
				if (sidebar_items[sidebar][item].type == "Wiki Sidebar") {
					$(target).append(
						"<li>" +
							sidebar_items[sidebar][item].title +
							"</li>" +
							"<ul class=" +
							sidebar_items[sidebar][item].group_name +
							"></ul>"
					);
				} else {
					$(target).append(
						"<li class=" +
							sidebar_items[sidebar][item].group_name +
							">" +
							sidebar_items[sidebar][item].title +
							"</li>"
					);
				}
			}
		}
	}
};
