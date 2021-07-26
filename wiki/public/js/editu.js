window.EditAsset = class EditAsset {
	constructor(opts) {
		this.make_code_field_group();
		this.render_preview();
		this.add_attachment_handler();
		this.set_listeners();
		this.create_comment_box();
		this.make_title_editable()
	}

	make_title_editable () {
		const title_span = $('.edit-title>span')
		const title_input = $('.edit-title>input')
		title_span.dblclick(() => {
			title_span.addClass('hide')
			title_input.removeClass('hide')
			title_input.val(title_span.text())
			title_input.focus()
		})
		title_input.focusout(() => {
			title_span.removeClass('hide')
			title_input.addClass('hide')
			title_span.text( title_input.val())
		})
	}



	make_code_field_group() {
		this.code_field_group = new frappe.ui.FieldGroup({
			fields: [
				{
					fieldname: "type",
					fieldtype: "Select",
					default: "Markdown",
					options: "Markdown\nRich-Text(Experimental)",
				},
				{
					fieldtype: "Column Break",
				},
				{
					fieldname: "attachment_controls",
					fieldtype: "HTML",
					options: `
						<div class='attachment-controls '>
							<div class='show-attachments'>
								<i class="octicon octicon-file-media"></i>
								<span class='number'>0</span>&nbsp;attachments
							</div>&nbsp;&nbsp;
							<div class='add-attachment-wiki'>
								<span class='btn btn-xs'>
									<i class="octicon octicon-cloud-upload"></i>&nbsp;
									Upload Attachment
								</span>
							</div>
						</div>
					`,
				},
				{
					fieldtype: "Section Break",
				},
				{
					fieldname: "code_html",
					fieldtype: "Text Editor",
					default: $(".wiki-content-html").html(),
					depends_on: 'eval:doc.type=="Rich-Text(Experimental)"',
				},
				{
					fieldname: "code_md",
					fieldtype: "Code",
					options: "Markdown",
					default: $(".wiki-content-md").text(),
					depends_on: 'eval:doc.type=="Markdown"',
				},
			],
			body: $(".wiki-write").get(0),
		});
		this.code_field_group.make();
		$(".wiki-write .form-section:last").removeClass("empty-section");
		this.add_attachment_popover()
		setTimeout(() => {
			// expand_code_editor
			const code_md = this.code_field_group.get_field('code_md')
			code_md.expanded = !this.expanded;
			code_md.refresh_height();
			code_md.toggle_label();
		}, 120)
	}

	add_attachment_popover() {
		let picker_wrapper = $('<div>skjdfjs</div>');

		$(".show-attachments").popover({
			trigger: 'click',
			placement: 'bottom',

			content: () => {
				return this.build_attachment_table()
			},
			html: true
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

	raise_patch() {
		var side = {};

		let name = $(".doc-sidebar .web-sidebar").get(0).dataset.name;
		side[name] = [];
		let items = $($(".doc-sidebar .web-sidebar").get(0))
			.children(".sidebar-items")
			.children("ul")
			.not(".hidden")
			.children("li");
		items.each( (item) => {
			if (!items[item].dataset.name) return
			side[name].push({
				name: items[item].dataset.name,
				type: items[item].dataset.type,
				new: items[item].dataset.new,
				title: items[item].dataset.title,
				group_name: items[item].dataset.groupName,
			})
		});

		$('.doc-sidebar [data-type="Wiki Sidebar"]').each(function () {
			let name = $(this).get(0).dataset.groupName;
			side[name] = [];
			let items = $(this).children("ul").children("li");
			items.each( (item)=> {
				if (!items[item].dataset.name) return
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
		dfs.push({
			fieldname: "edit_message",
			fieldtype: "Text",
		});

		let dialog = new frappe.ui.Dialog({
			fields: dfs,
			title: __("Comments"),
			primary_action: function () {
				frappe.call({
					method: "wiki.wiki.doctype.wiki_page.wiki_page.update",
					args: {
						name: $('[name="wiki_page"]').val(),
						wiki_page_patch: $('[name="wiki_page_patch"]').val(),
						message: this.get_value("edit_message"),
						content: me.content,
						type: me.code_field_group.get_value("type"),
						attachments: me.attachments,
						new: $('[name="new"]').val(),
						title: $('[name="title_of_page"]').val(),
						new_sidebar: $(".doc-sidebar").get(0).innerHTML,
						new_sidebar_items: side,
					},
					callback: () => {
						frappe.msgprint(
							{
								message:"A Change Request has been created. You can track your requests on the contributions page",
								indicator: "green",
								title: "Change Request Created",
							}
						);
						window.location.href = "/contributions";
					},
					freeze: true,
				});
				dialog.hide()
				$('#freeze').addClass('show')
			},
		});
		dialog.show();
	}

	add_attachment_handler() {
		var me = this;
		$(".add-attachment-wiki").click(function () {
			me.new_attachment();
		});
		$(".submit-wiki-page").click(function () {
			me.get_markdown();
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
				$('.wiki-attachment').empty().append(this.build_attachment_table());
				$('.attachment-controls').find('.number').text(this.attachments.length)
			},
		});
	}

	build_attachment_table() {
		var wrapper = $('<div class="wiki-attachment"></div>');;
		wrapper.empty();

		var table = $(this.get_attachment_table_header_html()).appendTo(wrapper);
		if (!this.attachments || !this.attachments.length ) return 'No attachments uploaded'

		this.attachments.forEach((f) => {
			const row = $("<tr></tr>").appendTo(table.find("tbody"));
			$(`<td>${f.file_name}</td>`).appendTo(row);
			// $(`<td>${f.file_url}</td>`).appendTo(row);
			$(`<td>
			<a class="btn btn-default btn-xs btn-primary-light text-nowrap copy-link" data-link="${f.file_url}" data-name = "${f.file_name}" >
				Copy Link
			</a>
			</td>`).appendTo(row);
			$(`<td>

			<a class="btn btn-default btn-xs  center delete-button"  data-name = "${f.file_name}" >
			<svg class="icon icon-sm"><use xlink:href="#icon-delete"></use></svg>

			</a>
			</td>`).appendTo(row);
		});
		return wrapper
	}

	get_attachment_table_header_html() {
		return `<table class="table  attachment-table" ">
			<tbody></tbody>
		</table>`;
	}

	set_listeners() {
		var me = this;

		$(`body`).on("click", `.copy-link`, function () {
			frappe.utils.copy_to_clipboard($(this).attr("data-link"))
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
					$('.wiki-attachment').empty().append(me.build_attachment_table());
					$('.attachment-controls').find('.number').text(me.attachments.length)

				}
			);
		});
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
								$diff.html(r.message.diff);
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
};
