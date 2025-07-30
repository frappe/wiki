# Copyright (c) 2020, Frappe and contributors
# For license information, please see license.txt


import re
from urllib.parse import urlencode

import frappe
from bleach_allowlist import bleach_allowlist
from frappe import _
from frappe.core.doctype.file.utils import get_random_filename
from frappe.utils.data import sbool
from frappe.utils.html_utils import (
	acceptable_attributes,
	acceptable_elements,
	is_json,
	mathml_elements,
	svg_attributes,
	svg_elements,
)
from frappe.website.doctype.website_settings.website_settings import modify_header_footer_items
from frappe.website.website_generator import WebsiteGenerator

from wiki.wiki.doctype.wiki_page.search import build_index_in_background, drop_index
from wiki.wiki.doctype.wiki_settings.wiki_settings import get_all_spaces


class WikiPage(WebsiteGenerator):
	def before_save(self):
		if old_title := frappe.db.get_value("Wiki Page", self.name, "title"):
			if old_title != self.title:
				clear_sidebar_cache()

	def after_insert(self):
		frappe.cache().hdel("website_page", self.name)

		# set via the clone method
		if hasattr(frappe.local, "in_clone") and frappe.local.in_clone:
			return

		revision = frappe.new_doc("Wiki Page Revision")
		revision.append("wiki_pages", {"wiki_page": self.name})
		revision.content = self.content
		revision.message = "Create Wiki Page"
		revision.raised_by = frappe.session.user
		revision.insert()

	def on_update(self):
		build_index_in_background()
		self.clear_page_html_cache()

	def on_trash(self):
		frappe.db.sql("DELETE FROM `tabWiki Page Revision Item` WHERE wiki_page = %s", self.name)

		frappe.db.sql(
			"""DELETE FROM `tabWiki Page Revision` WHERE name in
			(
				SELECT name FROM `tabWiki Page Revision`
				EXCEPT
				SELECT DISTINCT parent from `tabWiki Page Revision Item`
			)"""
		)

		for name in frappe.get_all("Wiki Page Patch", {"wiki_page": self.name, "new": 0}, pluck="name"):
			patch = frappe.get_doc("Wiki Page Patch", name)
			try:
				patch.cancel()
			except frappe.exceptions.DocstatusTransitionError:
				pass
			patch.delete()

		for name in frappe.get_all("Wiki Page Patch", {"wiki_page": self.name, "new": 1}, pluck="name"):
			frappe.db.set_value("Wiki Page Patch", name, "wiki_page", "")

		wiki_sidebar_name = frappe.get_value("Wiki Group Item", {"wiki_page": self.name})
		frappe.delete_doc("Wiki Group Item", wiki_sidebar_name)

		self.clear_page_html_cache()
		clear_sidebar_cache()
		drop_index()
		build_index_in_background()

	def sanitize_html(self):
		"""
		Sanitize HTML tags, attributes and style to prevent XSS attacks
		Based on bleach clean, bleach whitelist and html5lib's Sanitizer defaults

		Does not sanitize JSON, as it could lead to future problems

		Kanged from frappe.utils.html_utils.sanitize_html to allow only iframes with youtube embeds
		"""
		import bleach
		from bleach.css_sanitizer import CSSSanitizer
		from bs4 import BeautifulSoup

		html = self.content

		if is_json(html):
			return html

		if not bool(BeautifulSoup(html, "html.parser").find()):
			return html

		tags = (
			acceptable_elements
			+ svg_elements
			+ mathml_elements
			+ ["html", "head", "meta", "link", "body", "style", "o:p", "iframe"]
		)

		def attributes_filter(tag, name, value):
			if name.startswith("data-"):
				return True
			return name in acceptable_attributes

		css_sanitizer = CSSSanitizer(bleach_allowlist.all_styles)

		# returns html with escaped tags, escaped orphan >, <, etc.
		escaped_html = bleach.clean(
			html,
			tags=set(tags),
			attributes={"*": attributes_filter, "svg": svg_attributes},
			css_sanitizer=css_sanitizer,
			strip_comments=False,
			protocols=["cid", "http", "https", "mailto"],
		)

		# sanitize iframe tags that aren't youtube links
		soup = BeautifulSoup(escaped_html, "html.parser")
		iframes = soup.find_all("iframe")
		for iframe in iframes:
			if "youtube.com/embed/" not in iframe["src"]:
				iframe.replace_with(str(iframe))

		escaped_html = str(soup)
		return escaped_html

	def update_page(self, title, content, edit_message, raised_by=None):
		"""
		Update Wiki Page and create a Wiki Page Revision
		"""
		self.title = title

		if content != self.content:
			self.content = content
			revision = frappe.new_doc("Wiki Page Revision")
			revision.append("wiki_pages", {"wiki_page": self.name})
			revision.content = content
			revision.message = edit_message
			revision.raised_by = raised_by
			revision.insert()

		self.save()

	def verify_permission(self):
		wiki_settings = frappe.get_single("Wiki Settings")
		user_is_guest = frappe.session.user == "Guest"

		disable_guest_access = False
		if wiki_settings.disable_guest_access and user_is_guest:
			disable_guest_access = True

		access_permitted = self.allow_guest or not user_is_guest

		if not access_permitted or disable_guest_access:
			frappe.local.response["type"] = "redirect"
			frappe.local.response["location"] = "/login?" + urlencode({"redirect-to": frappe.request.url})
			raise frappe.Redirect

	def set_breadcrumbs(self, context):
		context.add_breadcrumbs = True
		if frappe.form_dict:
			context.parents = [{"route": "/" + self.route, "label": self.title}]
		else:
			parents = []
			splits = self.route.split("/")
			if splits:
				for index, _route in enumerate(splits[:-1], start=1):
					full_route = "/".join(splits[:index])
					wiki_page = frappe.get_all(
						"Wiki Page", filters=[["route", "=", full_route]], fields=["title"]
					)
					if wiki_page:
						parents.append({"route": "/" + full_route, "label": wiki_page[0].title})

				context.parents = parents

	def get_space_route(self):
		if space := frappe.get_value("Wiki Group Item", {"wiki_page": self.name}, "parent"):
			return frappe.get_value("Wiki Space", space, "route")
		else:
			frappe.throw("Wiki Page doesn't have a Wiki Space associated with it. Please add them via Desk.")

	def calculate_toc_html(self, html):
		from bs4 import BeautifulSoup

		soup = BeautifulSoup(html, "html.parser")
		headings = soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"])
		titleHref = re.sub(r"[^\u00C0-\u1FFF\u2C00-\uD7FF\w\- ]", "", self.title).replace(" ", "-").lower()
		# Add the title as the first entry in the TOC
		toc_html = f"<li><a  style='padding-left: 1rem' href='#{titleHref}'>{self.title}</a></li>"

		for heading in headings:
			title = heading.get_text().strip()
			heading_id = re.sub(r"[^\u00C0-\u1FFF\u2C00-\uD7FF\w\- ]", "", title).replace(" ", "-").lower()
			heading["id"] = heading_id
			title = heading.get_text().strip()
			level = int(heading.name[1]) + 1
			toc_entry = (
				f"<li><a style='padding-left: {level - 1}rem' href='#{heading['id']}'>{title}</a></li>"
			)
			toc_html += toc_entry

		return toc_html

	def get_context(self, context):
		self.verify_permission()
		self.set_breadcrumbs(context)

		# Get count of pending patches for admin banner
		if frappe.session.user != "Guest":
			context.is_admin = frappe.has_permission("Wiki Page Patch", "write")
			if context.is_admin:
				wiki_space_name = frappe.get_value("Wiki Group Item", {"wiki_page": self.name}, "parent")
				# Get all Wiki Pages in this space
				wiki_pages_in_space = frappe.get_all(
					"Wiki Group Item", filters={"parent": wiki_space_name}, pluck="wiki_page"
				)
				# Count pending patches for all pages in the space
				context.pending_patches_count = frappe.db.count(
					"Wiki Page Patch", {"wiki_page": ["in", wiki_pages_in_space], "status": "Under Review"}
				)

		wiki_settings = frappe.get_single("Wiki Settings")

		# Extract wiki_space names in the original order
		wiki_space_names = [entry.wiki_space for entry in wiki_settings.app_switcher_list]

		# Fetch all linked Wiki Space documents
		if wiki_space_names:
			wiki_spaces = frappe.get_all(
				"Wiki Space",
				filters={"name": ["in", wiki_space_names]},
				fields=["name", "space_name", "app_switcher_logo", "route"],
			)

			# Create a dictionary for quick lookup
			wiki_spaces_dict = {doc.name: doc for doc in wiki_spaces}

			# Reorder the documents based on the original list's order
			ordered_wiki_spaces = [
				wiki_spaces_dict[name] for name in wiki_space_names if name in wiki_spaces_dict
			]
		else:
			ordered_wiki_spaces = []

		context.spaces = ordered_wiki_spaces

		wiki_space_name = frappe.get_value("Wiki Group Item", {"wiki_page": self.name}, "parent")
		wiki_space = (
			frappe.get_cached_doc("Wiki Space", wiki_space_name) if wiki_space_name else frappe._dict()
		)
		context.wiki_space_name = wiki_space_name
		# Do not cache in developer mode
		context.no_cache = (
			frappe.local.conf.developer_mode or frappe.local.dev_server
		)  # Changes will invalidate HTML cache
		context.navbar_search = wiki_settings.add_search_bar
		context.light_mode_logo = wiki_space.light_mode_logo or wiki_settings.logo
		context.dark_mode_logo = wiki_space.dark_mode_logo or wiki_settings.dark_mode_logo
		if wiki_space.light_mode_logo or wiki_space.dark_mode_logo:
			context.home_page = "/" + wiki_space.route
		context.script = wiki_settings.javascript
		context.show_feedback = wiki_settings.enable_feedback
		context.ask_for_contact_details = wiki_settings.ask_for_contact_details
		context.wiki_search_scope = self.get_space_route()
		context.metatags = {
			"title": self.title,
			"description": self.meta_description,
			"keywords": self.meta_keywords,
			"image": self.meta_image,
			"og:image:width": "1200",
			"og:image:height": "630",
		}
		context.edit_wiki_page = frappe.form_dict.get("editWiki")
		context.new_wiki_page = frappe.form_dict.get("newWiki")
		context.last_revision = self.get_last_revision()
		context.show_dropdown = frappe.session.user != "Guest"
		context.number_of_revisions = frappe.db.count("Wiki Page Revision Item", {"wiki_page": self.name})
		# TODO: group all context values
		context.hide_on_sidebar = frappe.get_value(
			"Wiki Group Item", {"wiki_page": self.name}, "hide_on_sidebar"
		)
		html = frappe.utils.md_to_html(self.content)
		context.content = self.content
		context.page_toc_html = (
			self.calculate_toc_html(html) if wiki_settings.enable_table_of_contents else None
		)

		revisions = frappe.db.get_all(
			"Wiki Page Revision",
			filters=[["wiki_page", "=", self.name]],
			fields=["content", "creation", "owner", "name", "raised_by", "raised_by_username"],
		)
		context.current_revision = revisions[0]
		if len(revisions) > 1:
			context.previous_revision = revisions[1]
		else:
			context.previous_revision = {"content": "<h3>No Revisions</h3>", "name": ""}

		context.show_sidebar = True
		context.hide_login = True
		context.name = self.name
		if (frappe.form_dict.editWiki or frappe.form_dict.newWiki) and frappe.form_dict.wikiPagePatch:
			context.title, context.content = frappe.db.get_value(
				"Wiki Page Patch", frappe.form_dict.wikiPagePatch, ["new_title", "new_code"]
			)
		if wiki_space.favicon:
			context.favicon = wiki_space.favicon
		context = context.update(
			{
				"navbar_items": modify_header_footer_items(wiki_space.navbar_items or wiki_settings.navbar),
				"post_login": [
					{"label": _("My Account"), "url": "/me"},
					{"label": _("Logout"), "url": "/?cmd=web_logout"},
					{
						"label": _("Contributions ") + get_open_contributions(),
						"url": "/contributions",
					},
					{
						"label": _("My Drafts ") + get_open_drafts(),
						"url": "/drafts",
					},
				],
			}
		)

	def get_items(self, sidebar_items):
		topmost = frappe.get_value("Wiki Group Item", {"wiki_page": self.name}, ["parent"])

		sidebar_html = frappe.cache().hget("wiki_sidebar", topmost)
		if not sidebar_html or frappe.conf.disable_website_cache or frappe.conf.developer_mode:
			context = frappe._dict({})
			wiki_settings = frappe.get_single("Wiki Settings")
			context.active_sidebar_group = frappe.get_value(
				"Wiki Group Item", {"wiki_page": self.name}, ["parent_label"]
			)
			context.current_route = self.route
			context.collapse_sidebar_groups = wiki_settings.collapse_sidebar_groups
			context.sidebar_items = sidebar_items
			context.wiki_search_scope = self.get_space_route()
			sidebar_html = frappe.render_template(
				"wiki/wiki/doctype/wiki_page/templates/web_sidebar.html", context
			)
			frappe.cache().hset("wiki_sidebar", topmost, sidebar_html)
		return sidebar_html

	def get_sidebar_items(self):
		wiki_sidebar = frappe.get_doc("Wiki Space", {"route": self.get_space_route()}).wiki_sidebars
		sidebar = {}

		for sidebar_item in wiki_sidebar:
			if sidebar_item.hide_on_sidebar:
				continue

			wiki_page = frappe.get_cached_doc("Wiki Page", sidebar_item.wiki_page)

			permitted = wiki_page.allow_guest or frappe.session.user != "Guest"
			if not permitted:
				continue

			if sidebar_item.parent_label not in sidebar:
				sidebar[sidebar_item.parent_label] = [
					{
						"name": wiki_page.name,
						"type": "Wiki Page",
						"title": wiki_page.title,
						"route": wiki_page.route,
						"group_name": sidebar_item.parent_label,
					}
				]
			else:
				sidebar[sidebar_item.parent_label] += [
					{
						"name": wiki_page.name,
						"type": "Wiki Page",
						"title": wiki_page.title,
						"route": wiki_page.route,
						"group_name": sidebar_item.parent_label,
					}
				]

		return self.get_items(sidebar)

	def get_last_revision(self):
		last_revision = frappe.db.get_value(
			"Wiki Page Revision Item", filters={"wiki_page": self.name}, fieldname="parent"
		)
		return frappe.get_doc("Wiki Page Revision", last_revision)

	def clone(self, original_space, new_space):
		# used in after_insert of Wiki Page to resist create of Wiki Page Revision
		frappe.local.in_clone = True

		cloned_wiki_page = frappe.copy_doc(self, ignore_no_copy=True)
		cloned_wiki_page.route = cloned_wiki_page.route.replace(original_space, new_space)

		cloned_wiki_page.flags.ignore_mandatory = True
		cloned_wiki_page.save()

		items = frappe.get_all(
			"Wiki Page Revision",
			filters={
				"wiki_page": self.name,
			},
			fields=["name"],
			pluck="name",
			order_by="`tabWiki Page Revision`.creation",
		)

		for item in items:
			revision = frappe.get_doc("Wiki Page Revision", item)
			revision.append("wiki_pages", {"wiki_page": cloned_wiki_page.name})
			revision.save()

		self.update_time_and_user("Wiki Page", cloned_wiki_page.name, self)

		return cloned_wiki_page

	def update_time_and_user(self, dt, dn, new_doc):
		for field in ("modified", "modified_by", "creation", "owner"):
			frappe.db.set_value(dt, dn, field, new_doc.get(field))

	def clear_page_html_cache(self):
		html_cache_key = f"wiki_page_html:{self.name}"

		frappe.cache.hdel(html_cache_key, "content")
		frappe.cache.hdel(html_cache_key, "page_title")
		frappe.cache.hdel(html_cache_key, "toc_html")
		frappe.cache.hdel(html_cache_key, "next_page")
		frappe.cache.hdel(html_cache_key, "prev_page")


def get_open_contributions():
	count = len(
		frappe.get_list(
			"Wiki Page Patch",
			filters=[["status", "=", "Under Review"], ["raised_by", "=", frappe.session.user]],
		)
	)
	return f'<span class="count">{count}</span>'


def get_open_drafts():
	count = len(
		frappe.get_list(
			"Wiki Page Patch",
			filters=[["status", "=", "Draft"], ["owner", "=", frappe.session.user]],
		)
	)
	return f'<span class="count">{count}</span>'


def clear_sidebar_cache():
	for key in frappe.cache.hgetall("wiki_sidebar").keys():
		frappe.cache.hdel("wiki_sidebar", key)


@frappe.whitelist()
def preview(original_code, new_code, name):
	from lxml.html.diff import htmldiff

	return htmldiff(original_code, new_code)


@frappe.whitelist()
def extract_images_from_html(content):
	frappe.flags.has_dataurl = False
	file_ids = {"name": []}

	def _save_file(match):
		data = match.group(1)
		data = data.split("data:")[1]
		headers, content = data.split(",")

		if "filename=" in headers:
			filename = headers.split("filename=")[-1]

			# decode filename
			if not isinstance(filename, str):
				filename = str(filename, "utf-8")
		else:
			mtype = headers.split(";")[0]
			filename = get_random_filename(content_type=mtype)

		_file = frappe.get_doc({"doctype": "File", "file_name": filename, "content": content, "decode": True})
		_file.save(ignore_permissions=True)
		file_url = _file.file_url
		file_ids["name"] += [_file.name]
		if not frappe.flags.has_dataurl:
			frappe.flags.has_dataurl = True

		return f'<img src="{file_url}"'

	if content and isinstance(content, str):
		content = re.sub(r'<img[^>]*src\s*=\s*["\'](?=data:)(.*?)["\']', _save_file, content)
	return content, file_ids["name"]


@frappe.whitelist()
def convert_markdown(markdown):
	html = frappe.utils.md_to_html(markdown)
	return html


@frappe.whitelist()
def update(
	name,
	content,
	title,
	attachments="{}",
	message="",
	wiki_page_patch=None,
	new=False,
	new_sidebar_group="",
	new_sidebar_items="",
	draft=False,
):
	context = {"route": name}
	context = frappe._dict(context)
	content, file_ids = extract_images_from_html(content)

	if not content:
		frappe.throw(_("Content is required"))

	new = sbool(new)
	draft = sbool(draft)

	status = "Draft" if draft else "Under Review"
	if wiki_page_patch:
		patch = frappe.get_doc("Wiki Page Patch", wiki_page_patch)
		patch.new_title = title
		patch.new_code = content
		patch.status = status
		patch.message = message
		patch.new = new
		patch.new_sidebar_group = new_sidebar_group
		patch.new_sidebar_items = new_sidebar_items
		patch.save()

	else:
		patch = frappe.new_doc("Wiki Page Patch")

		patch_dict = {
			"wiki_page": name,
			"status": status,
			"raised_by": frappe.session.user,
			"new_code": content,
			"message": message,
			"new": new,
			"new_title": title,
			"new_sidebar_group": new_sidebar_group,
			"new_sidebar_items": new_sidebar_items,
		}

		patch.update(patch_dict)

		patch.save()

		if file_ids:
			update_file_links(file_ids, patch.name)

	out = frappe._dict()

	if frappe.has_permission(doctype="Wiki Page Patch", ptype="submit", throw=False) and not draft:
		patch.approved_by = frappe.session.user
		patch.status = "Approved"
		patch.submit()
		out.approved = True

	frappe.db.commit()
	if draft:
		out.route = "drafts"
	elif not frappe.has_permission(doctype="Wiki Page Patch", ptype="submit", throw=False):
		out.route = "contributions"
	elif hasattr(patch, "new_wiki_page"):
		out.route = patch.new_wiki_page.route
	else:
		out.route = patch.wiki_page_doc.route

	return out


def update_file_links(file_ids, patch_name):
	for file_id in file_ids:
		file = frappe.get_doc("File", file_id)
		file.attached_to_doctype = "Wiki Page Patch"
		file.attached_to_name = patch_name
		file.save()


def get_source_generator(resolved_route, jenv):
	path = resolved_route.controller.split(".")
	path[-1] = "templates"
	path.append(path[-2] + ".html")
	path = "/".join(path)
	return jenv.loader.get_source(jenv, path)[0]


def get_source(resolved_route, jenv):
	if resolved_route.page_or_generator == "Generator":
		return get_source_generator(resolved_route, jenv)

	elif resolved_route.page_or_generator == "Page":
		return jenv.loader.get_source(jenv, resolved_route.template)[0]


@frappe.whitelist(allow_guest=True)
def get_sidebar_for_page(wiki_page):
	sidebar = frappe.get_cached_doc("Wiki Page", wiki_page).get_sidebar_items()
	return sidebar


@frappe.whitelist()
def approve(wiki_page_patch):
	if not frappe.has_permission(doctype="Wiki Page Patch", ptype="submit", throw=False):
		frappe.throw(
			_("You are not permitted to approve, Please wait for a moderator to respond"),
			frappe.PermissionError,
		)

	patch = frappe.get_doc("Wiki Page Patch", wiki_page_patch)
	patch.approved_by = frappe.session.user
	patch.status = "Approved"
	patch.submit()


@frappe.whitelist()
def delete_wiki_page(wiki_page_route):
	if not frappe.has_permission(doctype="Wiki Page", ptype="delete", throw=False):
		frappe.throw(
			_("You are not permitted to delete a Wiki Page"),
			frappe.PermissionError,
		)
	wiki_page_name = frappe.get_value("Wiki Page", {"route": wiki_page_route})
	if wiki_page_name:
		frappe.delete_doc("Wiki Page", wiki_page_name)
		return True

	frappe.throw(_("The Wiki Page you are trying to delete doesn't exist"))


@frappe.whitelist(allow_guest=True)
def has_edit_permission():
	return frappe.has_permission(doctype="Wiki Page", ptype="write", throw=False)


@frappe.whitelist()
def update_page_settings(name, settings):
	from frappe.utils import sbool

	frappe.has_permission(doctype="Wiki Page", ptype="write", doc=name, throw=True)
	clear_sidebar_cache()
	settings = frappe.parse_json(settings)

	frappe.db.set_value(
		"Wiki Group Item", {"wiki_page": name}, "hide_on_sidebar", sbool(settings.hide_on_sidebar)
	)

	frappe.db.set_value("Wiki Page", name, "route", settings.route)


@frappe.whitelist()
def get_markdown_content(wikiPageName, wikiPagePatch):
	if wikiPagePatch:
		new_code, new_title = frappe.db.get_value("Wiki Page Patch", wikiPagePatch, ["new_code", "new_title"])
		return {"content": new_code, "title": new_title}
	return frappe.db.get_value("Wiki Page", wikiPageName, ["content", "title"], as_dict=True)


@frappe.whitelist(allow_guest=True)
def get_page_content(wiki_page_name: str):
	html_cache_key = f"wiki_page_html:{wiki_page_name}"

	content = frappe.cache.hget(html_cache_key, "content")
	page_title = frappe.cache.hget(html_cache_key, "page_title")
	# TOC can be "None" if user has disabled it
	toc_html = frappe.cache.hget(html_cache_key, "toc_html")
	next_page = frappe.cache.hget(html_cache_key, "next_page")
	prev_page = frappe.cache.hget(html_cache_key, "prev_page")

	wiki_page = frappe.get_cached_doc("Wiki Page", wiki_page_name)
	wiki_settings = frappe.get_single("Wiki Settings")

	user_is_guest = frappe.session.user == "Guest"

	if user_is_guest and (not wiki_page.allow_guest or wiki_settings.disable_guest_access):
		frappe.local.response.http_status_code = 403
		frappe.throw(_("You are not permitted to access this page"), frappe.PermissionError)

	if not all([content, page_title, next_page, prev_page]):
		md_content = wiki_page.content

		content = frappe.utils.md_to_html(md_content)
		toc_html = wiki_page.calculate_toc_html(content) if wiki_settings.enable_table_of_contents else None
		page_title = wiki_page.title

		wiki_space_name = frappe.get_value("Wiki Group Item", {"wiki_page": wiki_page_name}, "parent")
		sidebar_items = frappe.get_all(
			"Wiki Group Item",
			filters={"parent": wiki_space_name, "hide_on_sidebar": 0},
			fields=["wiki_page", "idx"],
			order_by="idx",
		)

		current_idx = next(
			(i for i, item in enumerate(sidebar_items) if item.wiki_page == wiki_page_name), -1
		)
		next_page = prev_page = None

		if current_idx != -1:
			if current_idx > 0:
				prev_page = frappe.get_value(
					"Wiki Page", sidebar_items[current_idx - 1].wiki_page, ["title", "route"], as_dict=True
				)
			if current_idx < len(sidebar_items) - 1:
				next_page = frappe.get_value(
					"Wiki Page", sidebar_items[current_idx + 1].wiki_page, ["title", "route"], as_dict=True
				)

		frappe.cache.hset(html_cache_key, "content", content)
		frappe.cache.hset(html_cache_key, "page_title", page_title)
		frappe.cache.hset(html_cache_key, "toc_html", toc_html)
		frappe.cache.hset(html_cache_key, "next_page", next_page)
		frappe.cache.hset(html_cache_key, "prev_page", prev_page)

	return {
		"title": page_title,
		"content": content,
		"toc_html": toc_html,
		"next_page": next_page,
		"prev_page": prev_page,
	}
