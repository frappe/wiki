
// import ClassicEditor from '@ckeditor/build-classic.js';

// import Essentials from '@ckeditor/ckeditor5-essentials/src/essentials.js';
// import Bold from './@ckeditor/ckeditor5-basic-styles/src/bold.js';
// import Italic from './@ckeditor/ckeditor5-basic-styles/src/italic.js';
// // ...

// import Markdown from './@ckeditor/ckeditor5-markdown-gfm/src/markdown.js';

import  '../../../frappe/frappe/public/js/frappe/ui/keyboard.js'



window.EditAsset = class EditAsset {
  constructor(opts) {
    console.log('checko')
    this.edited_files = {};
    this.make_code_field_group();
    this.render_preview();
    this.add_attachment_handler();
    this.set_listeners();
    this.create_comment_box()
  }

  render_preview() {

    $('a[data-toggle="tab"]').on("shown.bs.tab", (e) => {
      let activeTab = $(e.target);

      if (
        activeTab.prop("id") === "preview-tab" ||
        activeTab.prop("id") === "diff-tab"
      ) {
        let content = $("textarea#content").val();
        let $preview = $(".wiki-preview");
        let $diff = $(".wiki-diff");
        if (!this.code_field_group.get_value("code")) {
          $preview.html("<div>Please select a route</div>");
          $diff.html("<div>Please select a route</div>");
          return;
        }
        $preview.html("Loading preview...");
        $diff.html("Loading diff...");
        frappe.call({
          method: "wiki.wiki.doctype.wiki_page.wiki_page.preview",
          args: {
            content: this.code_field_group.get_value("code"),
            path: this.route,
            name: $('[name="wiki_page"]').val(),
            attachments: this.attachments,
          },
          callback: (r) => {
            if (r.message) {
              $preview.html(r.message.html);
              $diff.html(r.message.diff)
            }
          },
        });
      }
    });
  }

  make_edit_field_group() {
    const route = $("#route").val();
    this.edit_field_group = new frappe.ui.FieldGroup({
      fields: [
        {
          label: __("Route Link"),
          fieldname: "route_link",
          fieldtype: "Data",
          default: route || "",
          hidden: 1,
        },
      ],
      body: $(".routedisp"),
    });
    this.edit_field_group.make();
  }

  make_code_field_group() {
    this.code_field_group = new frappe.ui.FieldGroup({
      fields: [
        {
          label: __("Edit Code"),
          fieldname: "code",
          fieldtype: "Code",
          columns: 4,
          reqd: 1,
          default: $('#content').val(),
          options: "Markdown",
        },
      ],
      body: $(".wiki-write").get(0),
    });
    this.code_field_group.make();
  }

  update_code(from_disk = false) {
    const route = this.edit_field_group.get_value("route_link");
    if (this.route)
      this.edited_files[this.route] = this.code_field_group.get_value("code");
    if (route === this.route && !from_disk) return;
    if (route in this.edited_files && !from_disk) {
      this.route = route;
      this.code_field_group
        .get_field("code")
        .set_value(this.edited_files[route]);
      this.build_file_table();
      return;
    }
    frappe.call({
      method: "edit_docs.www.edit.get_code",
      args: { route: route },
      callback: (r) => {
        this.route = route;
        this.code_field_group.get_field("code").set_value(r.message);
        this.build_file_table();
      },
    });
  }
  make_submit_section_field_group() {
    this.submit_section_field_group = new frappe.ui.FieldGroup({
      fields: [
        {
          label: __("Submit"),
          fieldname: "submit_button",
          fieldtype: "Button",
          primary: 1,
          btn_size: "lg",
          reqd: 1,
          click: () => this.raise_patch(),
        },
      ],
      body: $(".submit-section"),
    });
    this.submit_section_field_group.make();
  }

  raise_patch() {

    var me =this
    const submit_dialog = frappe.ui.di



    var dfs = [];
        dfs.push({
          fieldname: "edit_message",
          fieldtype: "Text",
        });
    
    let dialog = new frappe.ui.Dialog({
      fields: dfs,
      title: __("Please add a message explaining your change"),
      primary_action: function () {
        console.log(this.get_value("edit_message"))
        frappe.call({
          method: "wiki.wiki.doctype.wiki_page.wiki_page.update",
          args: {
            name: $('[name="wiki_page"]').val(),
            wiki_page_patch: $('[name="wiki_page_patch"]').val(),
            message: this.get_value("edit_message"),
            content: me.code_field_group.get_value("code"),
            attachments: me.attachments,
          },
          callback: (r) => {
            frappe.show_alert(
              "A Change Request has been generated. You can track your requests here after a few mins",
              5
            );
            window.location.href = "/contributions";
          },
        });

        this.hide()
      },
    });
    dialog.show();





   
  }

  add_attachment_handler() {
    var me = this;
    $(".add-attachment").click(function () {
      me.new_attachment();
    });
    $(".submit").click(function () {
      me.raise_patch();
    });
  }

  new_attachment(fieldname) {
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

    var table = $(
      `<table class="table table-bordered attachment-table" style="cursor:pointer; margin:0px;">
        <thead>
        	<tr>
            <th style="width: 30%">' ${__("File Name")}</th>
            <th style="width: 50%">${__("Use this Url")} </th>
            <th>${__("Actions")} </th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>`
    ).appendTo(wrapper);

    this.attachments.forEach((f) => {
      const row = $("<tr></tr>").appendTo(table.find("tbody"));
      $(`<td>${f.file_name}</td>`).appendTo(row);
      $(`<td>${f.file_url}</td>`).appendTo(
        row
      );
      $(`<td>
          <a class="btn btn-default btn-xs center delete-button"  data-name = "${f.file_name}" >
				    Delete
			    </a>
        </td>`).appendTo(row);
    });

    // table.on("click", () => this.table_click_handler());
  }

  set_listeners() {
    var me = this;
    $(` .wiki-attachment `).on("click", `.edit-button`, function () {
      var dfs = [];
      me.attachments.forEach((f) => {
        if (f.file_name == $(this).attr("data-name")) {
          dfs.push({
            fieldname: f.file_name,
            fieldtype: "Data",
            label: f.file_name,
          });
        }
      });
      let dialog = new frappe.ui.Dialog({
        fields: dfs,
        title: __("Add path where this file should be saved."),
        primary_action: function () {
          var values = this.get_values();
          if (values) {
            this.hide();
            me.attachments.forEach((f) => {
              f.save_path = values[f.file_name];
              me.save_paths[f.file_name] = values[f.file_name];
            });
            me.build_attachment_table();
          }
        },
      });
      dialog.show();
      dialog.set_values(me.save_paths);
    });

    $(` .wiki-attachment `).on("click", `.delete-button`, function () {
      frappe.confirm(
        `Are you sure you want to delete the file "${$(this).attr(
          "data-name"
        )}"`,
        () => {
          // action to perform if Yes is selected
          me.attachments.forEach((f, index, object) => {
            if (f.file_name == $(this).attr("data-name")) {
              object.splice(index, 1);
            }
            me.build_attachment_table();
          });
        }
      );
    });

    $(` .wiki-files `).on("click", `.delete-button`, function () {
      frappe.confirm(
        `Are you sure you want to reset changes for this route "${$(this).attr(
          "data-name"
        )}"`,
        () => {
          // action to perform if Yes is selected

          delete me.edited_files[$(this).attr("data-name")];
          me.build_file_table();
        }
      );
    });

    $(` .wiki-files `).on("click", `.edit-button`, function () {
      // action to perform if Yes is selected

      me.edit_field_group
        .get_field("route_link")
        .set_value($(this).attr("data-name"))
        .then(() => {
          me.update_code();
          $("#write-tab").addClass("active");
          $("#files-tab").removeClass("active");
          $("#write").addClass("show active");
          $("#files").removeClass("show active");
        });
    });
  }

  build_file_table() {
    var wrapper = $(".wiki-files");
    wrapper.empty();
    var table = $(
      '<table class="table table-bordered" style="cursor:pointer; margin:0px;"><thead>\
	<tr><th>' +
        __("Route") +
        "</th><th>" +
        __("Actions") +
        "</th></tr>\
	</thead><tbody></tbody></table>"
    ).appendTo(wrapper);

    for (var file in this.edited_files) {
      const row = $("<tr></tr>").appendTo(table.find("tbody"));
      $("<td>" + file + "</td>").appendTo(row);
      $(`<td>
      <a class="btn btn-default btn-xs center edit-button"  data-name = "${file}" >
        Edit
      </a>
      &nbsp&nbsp
      <a class="btn btn-default btn-xs center delete-button"  data-name = "${file}" >
        Delete
      </a>
    </td>`).appendTo(row);
    }
    if (!(this.route in this.edited_files)) {
      const row = $("<tr></tr>").appendTo(table.find("tbody"));
      $("<td>" + this.route + "</td>").appendTo(row);
      $(`<td>
      <a class="btn btn-default btn-xs center edit-button"  data-name = "${this.route}" >
        Edit
      </a>
      &nbsp&nbsp
      <a class="btn btn-default btn-xs center delete-button"  data-name = "${this.route}" >
        Delete
      </a>
    </td>`).appendTo(row);
    }
  }

  create_comment_box() {
     this.comment_box = frappe.ui.form.make_control({
      parent: $('.comment-box'),
      df: {
          fieldname: 'new_comment',
          fieldtype: 'Comment'
      },
      enable_mentions: false,
      render_input: true,
      only_input: true,
      on_submit: (comment) => {

				if (strip_html(comment).trim() != "") {
          this.comment_box.disable();


          frappe.call({
            method: "wiki.wiki.doctype.wiki_page_patch.wiki_page_patch.add_comment_to_patch",
            args: {
              reference_name: $('[name="wiki_page_patch"]').val(),
              content: comment,
              comment_email: frappe.session.user,
              comment_by: frappe.session.user_fullname
            },
            callback: (r) => {
              comment = r.message
              if (comment) {
                console.log(comment)
                this.comment_box.set_value('');

                
                const new_comment = $(`
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
                              ${comment.owner}
                              <span class="text-muted margin-left">
                                <span class="frappe-timestamp "
                                  data-timestamp="${comment.creation}"
                                  title="${comment.creation}">${ comment.timepassed }</span>
                              </span>
                            </span>
                          </span>
                        </span>
                        <div class="content">
                          ${comment.content}
                        </div>
                      </div>
                    </div>
                  </div>
                `)

                $(".timeline-items").prepend(new_comment)

              }
            },
            always: () => {
              this.comment_box.enable();

            }
          });
				}
			}
  })
  }
}



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

