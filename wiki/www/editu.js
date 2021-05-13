
// import ClassicEditor from '@ckeditor/build-classic.js';

// import Essentials from '@ckeditor/ckeditor5-essentials/src/essentials.js';
// import Bold from './@ckeditor/ckeditor5-basic-styles/src/bold.js';
// import Italic from './@ckeditor/ckeditor5-basic-styles/src/italic.js';
// // ...

// import Markdown from './@ckeditor/ckeditor5-markdown-gfm/src/markdown.js';






class EditAsset {
  constructor(opts) {
    console.log('checko')
    this.edited_files = {};
    this.make_code_field_group();
    // this.make_edit_field_group();
    this.make_submit_section_field_group();
    this.render_preview();
    this.add_attachment_handler();
    this.set_listeners();
    // // this.setup_search("#search-container", '{{ docs_search_scope or "" }}');

    // $(".web-footer .container")
    //   .removeClass("container")
    //   .addClass("container-fluid doc-container");


    // ClassicEditor.create(document.querySelector("#snippet-markdown"), {
    //   plugins: [
    //     Markdown,

    //     Essentials,
    //     Bold,
    //     Italic,
    //     // ...
    //   ],
    //   // ...
    // });

  }

  render_preview() {
    // frappe.ready(() => {

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
              // $preview.html(r.message.html);
              // $diff.html(r.message.diff);
            }
          },
        });
      }
    });
    // })
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
          // change: () => this.update_code(),
          hidden: 1,
        },
        // {
        //   label: __("Edit Code"),
        //   fieldname: "code",
        //   fieldtype: "Button",
        //   click: () => this.update_code(),
        // },
        // {
        //   label: __("Overwrite From Disk"),
        //   fieldname: "code_from_disk",
        //   fieldtype: "Button",
        //   click: () => this.update_code(true),
        // },
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
    frappe.call({
      method: "wiki.wiki.doctype.wiki_page.wiki_page.update",
      args: {
        name: $('[name="wiki_page"]').val(),
        wiki_page_patch: $('[name="wiki_page_patch"]').val(),
        message: $('[name="edit_message"]').val(),
        content: this.code_field_group.get_value("code"),
        attachments: this.attachments,
      },
      callback: (r) => {
        frappe.show_alert(
          "A Change Request has been generated. You can track your requests here after a few mins",
          5
        );
        window.location.href = "/contributions";
      },
    });
  }

  add_attachment_handler() {
    var me = this;
    $(".add-attachment").click(function () {
      me.new_attachment();
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
}

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




var edit  = new EditAsset();
