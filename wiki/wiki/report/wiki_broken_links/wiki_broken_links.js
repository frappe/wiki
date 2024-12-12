// Copyright (c) 2024, Frappe and contributors
// For license information, please see license.txt

frappe.query_reports["Wiki Broken Links"] = {
  filters: [
    {
      fieldname: "wiki_space",
      label: __("Wiki Space"),
      fieldtype: "Link",
      options: "Wiki Space",
    },
    {
      fieldname: "check_images",
      label: __("Include images?"),
      fieldtype: "Check",
      default: 1,
    },
    {
      fieldname: "check_internal_links",
      label: __("Include internal links?"),
      fieldtype: "Check",
      default: 0,
    },
  ],
};
