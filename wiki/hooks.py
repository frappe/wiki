app_name = "wiki"
app_title = "Wiki"
app_publisher = "Frappe"
app_description = "Simple Wiki App"
app_icon = "octicon octicon-file-directory"
app_color = "grey"
app_email = "developers@frappe.io"
app_license = "MIT"

add_to_apps_screen = [
	{
		"name": "wiki",
		"logo": "/assets/wiki/images/wiki-logo.png",
		"title": "Wiki",
		"route": "/app/wiki",
		"has_permission": "wiki.utils.check_app_permission",
	}
]

page_renderer = "wiki.wiki.doctype.wiki_page.wiki_renderer.WikiPageRenderer"

website_route_rules = [
	{"from_route": "/<path:wiki_page>/edit-wiki", "to_route": "/edit"},
	{"from_route": "/<path:wiki_page>/new-wiki", "to_route": "/new"},
	{"from_route": "/<path:wiki_page>/revisions", "to_route": "/revisions"},
]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/wiki/css/wiki.css"
# app_include_js = "/assets/wiki/js/wiki.js"

# include js, css files in header of web template
# web_include_css = "/assets/wiki/css/wiki.css"
# web_include_js = "/assets/wiki/js/wiki.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "wiki/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Installation
# ------------

# before_install = "wiki.install.before_install"
after_install = "wiki.install.after_install"

after_migrate = ["wiki.wiki.doctype.wiki_page.search.build_index_in_background"]

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "wiki.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# DocType Class
# ---------------
# Override standard doctype classes

# override_doctype_class = {
# 	"ToDo": "custom_app.overrides.CustomToDo"
# }

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
# 	"*": {
# 		"on_update": "method",
# 		"on_cancel": "method",
# 		"on_trash": "method"
# 	}
# }

# Scheduled Tasks
# ---------------

scheduler_events = {
	"cron": {
		"*/15 * * * *": ["wiki.wiki.doctype.wiki_page.search.build_index_in_background"],
	},
}

# scheduler_events = {
# 	"all": [
# 		"wiki.tasks.all"
# 	],
# 	"daily": [
# 		"wiki.tasks.daily"
# 	],
# 	"hourly": [
# 		"wiki.tasks.hourly"
# 	],
# 	"weekly": [
# 		"wiki.tasks.weekly"
# 	]
# 	"monthly": [
# 		"wiki.tasks.monthly"
# 	]
# }

# Testing
# -------

# before_tests = "wiki.install.before_tests"

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "wiki.event.get_events"
# }

# whitelisted_paths = {
# 	"/update-page": ["Wiki Page", "update"],
# 	"/new-page": ["Wiki Page", "new"],
# 	"/get-route": "wiki.wiki.doctype.wiki_page.wiki_page.get_route",
# }

#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "wiki.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]
