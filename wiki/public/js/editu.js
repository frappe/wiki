window.EditAsset = class EditAsset {
  constructor(opts) {
    this.make_code_field_group();
    this.render_preview();
    this.add_attachment_handler();
    this.set_listeners();
    this.create_comment_box();
  }

  make_code_field_group() {
    this.code_field_group = new frappe.ui.FieldGroup({
      fields: [
        {
          fieldname: "type",
          fieldtype: "Select",
          default: "Markdown",
          options: "Markdown\nRich-Text",
        },
        {
          fieldtype: "Column Break",
        },
        {
          fieldtype: "Section Break",
        },
        {
          label: __("Edit Code - HTML (Experimental)"),
          fieldname: "code_html",
          fieldtype: "Text Editor",
          default: $(".wiki-content-html").get(0).innerHTML,
          depends_on: 'eval:doc.type=="Rich-Text"',
        },
        {
          label: __("Edit Code - Markdown"),
          fieldname: "code_md",
          fieldtype: "Code",
          options: "Markdown",
          default: $(".wiki-content-md").get(0).innerHTML,
          depends_on: 'eval:doc.type=="Markdown"',
        },
      ],
      body: $(".wiki-write").get(0),
    });
    this.code_field_group.make();
    $('.wiki-write .form-section:last').removeClass('empty-section')

  }


  get_markdown() {


    var me = this;

    if (me.code_field_group.get_value("type") == "Markdown") {
      this.content = me.code_field_group.get_value("code_md");
      this.raise_patch()
    } else {

    this.content = this.code_field_group.get_value("code_html");

    frappe.call({
      method: "wiki.wiki.doctype.wiki_page.wiki_page.extract_images_from_html",
      args: {
        content: this.content
      },
      callback: (r) => {
        if (r.message) {
         me.content = r.message
         var turndownService = new TurndownService()
          turndownService = turndownService.keep(['div class','iframe'])
          me.content = turndownService.turndown(me.content)
         me.raise_patch()
        }
      },
    });
  }
  }


  raise_patch() {

    var side = {}
    $('.doc-sidebar [data-type="Wiki Sidebar"]').each(
      function() {
        let name = $(this).context.dataset.name
        side[name] = []
        let items = $(this).children('ul').children('li')
        items.each(
          function()  {
            side[name].push({
                name: $(this).context.dataset.name,
                type: $(this).context.dataset.type,
                new: $(this).context.dataset.new,
                title: $(this).context.dataset.title,
            } )
             console.log($(this).context.dataset.name)
          } )
        }
    )
    console.log(side)




    var me = this;
    var dfs = [];
    dfs.push({
      fieldname: "edit_message",
      fieldtype: "Text",
    });

    let dialog = new frappe.ui.Dialog({
      fields: dfs,
      title: __("Please add a message explaining your change"),
      primary_action: function () {
        frappe.call({
          method: "wiki.wiki.doctype.wiki_page.wiki_page.update",
          args: {
            name: $('[name="wiki_page"]').val(),
            wiki_page_patch: $('[name="wiki_page_patch"]').val(),
            message: this.get_value("edit_message"),
            content: me.content,
            type : me.code_field_group.get_value("type"),
            attachments: me.attachments,
            new: $('[name="new"]').val(),
            title: $('[name="title_of_page"]').val(),
            new_sidebar: $('.doc-sidebar').get(0).innerHTML,
            new_sidebar_items : side
          },
          callback: (r) => {
            frappe.show_alert(
              "A Change Request has been generated. You can track your requests here after a few mins");
            window.location.href = "/contributions";
          },
        });

        this.hide();
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
        this.build_attachment_table();
      },
    });
  }

  build_attachment_table() {
    var wrapper = $(".wiki-attachment");
    wrapper.empty();

    var table = $(this.get_attachment_table_header_html()).appendTo(wrapper);

    this.attachments.forEach((f) => {
      const row = $("<tr></tr>").appendTo(table.find("tbody"));
      $(`<td>${f.file_name}</td>`).appendTo(row);
      $(`<td>${f.file_url}</td>`).appendTo(row);
      $(`<td>
          <a class="btn btn-default btn-xs center delete-button"  data-name = "${f.file_name}" >
				    Delete
			    </a>
        </td>`).appendTo(row);
    });

  }

  get_attachment_table_header_html() {
    return `<table class="table table-bordered attachment-table" style="cursor:pointer; margin:0px;">
      <thead>
        <tr>
          <th style="width: 30%">' ${__("File Name")}</th>
          <th style="width: 50%">${__("Use this Url")} </th>
          <th>${__("Actions")} </th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>`;
  }

  set_listeners() {
    var me = this;

    $(` .wiki-attachment `).on("click", `.delete-button`, function () {
      frappe.confirm(
        `Are you sure you want to delete the file "${$(this).attr(
          "data-name"
        )}"`,
        () => {
          me.attachments.forEach((f, index, object) => {
            if (f.file_name == $(this).attr("data-name")) {
              object.splice(index, 1);
            }
            me.build_attachment_table();
          });
        }
      );
    });
  }

  render_preview() {
    $('a[data-toggle="tab"]').on("shown.bs.tab", (e) => {
      let activeTab = $(e.target);

      if (
        activeTab.prop("id") === "preview-tab" ||
        activeTab.prop("id") === "diff-tab"
      ) {
        let $preview = $(".wiki-preview");
        let $diff = $(".wiki-diff");
        const type = this.code_field_group.get_value("type")
       let content = ''
        if (type == 'Markdown') {
           content = this.code_field_group.get_value("code_md");
        } else {
          content = this.code_field_group.get_value("code_html");
          var turndownService = new TurndownService()
          turndownService = turndownService.keep(['div class','iframe'])
          content = turndownService.turndown(content)
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
            type : type,
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

//   setup_search(target, search_scope) {
//     if (typeof target === "string") {
//       target = $(target);
//     }

//     let $search_input = $(`<div class="dropdown" id="dropdownMenuSearch">
// 			<input type="search" class="form-control" placeholder="Search the docs (Press / to focus)" />
// 			<div class="overflow-hidden shadow dropdown-menu w-100" aria-labelledby="dropdownMenuSearch">
// 			</div>
// 			<div class="search-icon">
// 				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
// 					fill="none"
// 					stroke="currentColor" stroke-width="2" stroke-linecap="round"
// 					stroke-linejoin="round"
// 					class="feather feather-search">
// 					<circle cx="11" cy="11" r="8"></circle>
// 					<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
// 				</svg>
// 			</div>
// 		</div>`);

//     target.empty();
//     $search_input.appendTo(target);

//     // let $dropdown = $search_input.find('.dropdown');
//     let $dropdown_menu = $search_input.find(".dropdown-menu");
//     let $input = $search_input.find("input");
//     let dropdownItems;
//     let offsetIndex = 0;

//     $(document).on("keypress", (e) => {
//       if ($(e.target).is("textarea, input, select")) {
//         return;
//       }
//       if (e.key === "/") {
//         e.preventDefault();
//         $input.focus();
//       }
//     });

//     $input.on(
//       "input",
//       frappe.utils.debounce(() => {
//         if (!$input.val()) {
//           clear_dropdown();
//           return;
//         }

//         frappe
//           .call({
//             method: "frappe.search.web_search",
//             args: {
//               scope: search_scope || null,
//               query: $input.val(),
//               limit: 5,
//             },
//           })
//           .then((r) => {
//             let results = r.message || [];
//             let dropdown_html;
//             if (results.length == 0) {
//               dropdown_html = `<div class="dropdown-item">No results found</div>`;
//             } else {
//               dropdown_html = results
//                 .map((r) => {
//                   return `<a class="dropdown-item" data-name="/${r.path}">
// 						<h6>${r.title_highlights || r.title}</h6>
// 						<div style="white-space: normal;">${r.content_highlights}</div>
// 					</a>`;
//                 })
//                 .join("");
//             }
//             $dropdown_menu.html(dropdown_html);
//             $dropdown_menu.addClass("show");
//             dropdownItems = $dropdown_menu.find(".dropdown-item");

//             var me = this;
//             $dropdown_menu.on("click", `.dropdown-item`, function () {
//               var dfs = [];
//               console.log($(this).attr("data-name"));
//               me.edit_field_group
//                 .get_field("route_link")
//                 .set_value($(this).attr("data-name"))
//                 .then(() => {
//                   me.update_code();
//                   $("#write-tab").addClass("active");
//                   $("#files-tab").removeClass("active");
//                   $("#write").addClass("show active");
//                   $("#files").removeClass("show active");
//                 });
//               clear_dropdown();
//             });
//           });
//       }, 500)
//     );

//     $input.on("focus", () => {
//       if (!$input.val()) {
//         clear_dropdown();
//       } else {
//         $input.trigger("input");
//       }
//     });

//     $input.keydown(function (e) {
//       // up: 38, down: 40
//       if (e.which == 40) {
//         navigate(0);
//       }
//     });

//     $dropdown_menu.keydown(function (e) {
//       // up: 38, down: 40
//       if (e.which == 38) {
//         navigate(-1);
//       } else if (e.which == 40) {
//         navigate(1);
//       } else if (e.which == 27) {
//         setTimeout(() => {
//           clear_dropdown();
//         }, 300);
//       }
//     });

//     // Clear dropdown when clicked
//     $(window).click(function () {
//       clear_dropdown();
//     });

//     $search_input.click(function (event) {
//       event.stopPropagation();
//     });

//     // Navigate the list
//     var navigate = function (diff) {
//       offsetIndex += diff;

//       if (offsetIndex >= dropdownItems.length) offsetIndex = 0;
//       if (offsetIndex < 0) offsetIndex = dropdownItems.length - 1;
//       $input.off("blur");
//       dropdownItems.eq(offsetIndex).focus();
//     };

//     function clear_dropdown() {
//       offsetIndex = 0;
//       $dropdown_menu.html("");
//       $dropdown_menu.removeClass("show");
//       dropdownItems = undefined;
//     }

//     // Remove focus state on hover
//     $dropdown_menu.mouseover(function () {
//       dropdownItems.blur();
//     });
//   }
// }

// let ismdwn = 0
// rpanrResize.addEventListener('mousedown', mD)

// function mD(event) {
//   ismdwn = 1
//   document.body.addEventListener('mousemove', mV)
//   document.body.addEventListener('mouseup', end)
// }

// function mV(event) {
//   if (ismdwn === 1) {
//     pan1.style.flexBasis = event.clientX + "px"
//   } else {
//     end()
//   }
// }
// const end = (e) => {
//   ismdwn = 0
//   document.body.removeEventListener('mouseup', end)
//   rpanrResize.removeEventListener('mousemove', mV)
// }

// var edit  = new EditAsset();
