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

from wiki.wiki.doctype.wiki_page.search import remove_index, update_index


class WikiPage(WebsiteGenerator):
	def before_save(self):
		self.content = self.sanitize_html()

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
		update_index(self)

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

		clear_sidebar_cache()
		remove_index(self)

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

	def verify_permission(self, permtype):
		if permtype == "read" and self.allow_guest:
			return True
		permitted = frappe.has_permission(self.doctype, permtype, self)
		if not permitted:
			action = permtype
			if action == "write":
				action = "edit"
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
		headings = soup.find_all(["h2", "h3", "h4", "h5", "h6"])

		toc_html = ""
		for heading in headings:
			title = heading.get_text().strip()
			heading_id = re.sub(r"[^a-zA-Z0-9]+", "-", title.lower())
			heading["id"] = heading_id
			title = heading.get_text().strip()
			level = int(heading.name[1])
			toc_entry = (
				f"<li><a style='padding-left: {level - 1}rem' href='#{heading['id']}'>{title}</a></li>"
			)
			toc_html += toc_entry

		return toc_html

	def get_context(self, context):
		self.verify_permission("read")
		self.set_breadcrumbs(context)

		wiki_settings = frappe.get_single("Wiki Settings")
		wiki_space_name = frappe.get_value("Wiki Group Item", {"wiki_page": self.name}, "parent")
		wiki_space = frappe.get_doc("Wiki Space", wiki_space_name)

		context.no_cache = 1
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
		context.number_of_revisions = frappe.db.count("Wiki Page Revision Item", {"wiki_page": self.name})
		# TODO: group all context values
		context.hide_on_sidebar = frappe.get_value(
			"Wiki Group Item", {"wiki_page": self.name}, "hide_on_sidebar"
		)
		html = frappe.utils.md_to_html(self.content)
		context.content = html
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
			context.patch_new_code, context.patch_new_title = frappe.db.get_value(
				"Wiki Page Patch", frappe.form_dict.wikiPagePatch, ["new_code", "new_title"]
			)
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

			wiki_page = frappe.get_doc("Wiki Page", sidebar_item.wiki_page)

			if not wiki_page.allow_guest:
				permitted = frappe.has_permission(wiki_page.doctype, "read", wiki_page)
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
	sidebar = frappe.get_doc("Wiki Page", wiki_page).get_sidebar_items()
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
