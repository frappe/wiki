# Copyright (c) 2024, Frappe and contributors
# For license information, please see license.txt

import frappe
import requests
from bs4 import BeautifulSoup
from frappe import _


def execute(filters: dict | None = None):
	"""Return columns and data for the report.

	This is the main entry point for the report. It accepts the filters as a
	dictionary and should return columns and data. It is called by the framework
	every time the report is refreshed or a filter is updated.
	"""
	columns = get_columns()
	data = get_data(filters)

	return columns, data


def get_columns() -> list[dict]:
	"""Return columns for the report.

	One field definition per column, just like a DocType field definition.
	"""
	return [
		{
			"label": _("Wiki Document"),
			"fieldname": "wiki_document",
			"fieldtype": "Link",
			"options": "Wiki Document",
			"width": 200,
		},
		{
			"label": _("Broken Link"),
			"fieldname": "broken_link",
			"fieldtype": "Data",
			"options": "URL",
			"width": 400,
		},
	]


def get_data(filters: dict | None = None) -> list[list]:
	"""Return data for the report.

	The report data is a list of rows, with each row being a list of cell values.
	"""
	from frappe.utils.nestedset import get_descendants_of

	data = []

	doc_filters = {}
	if filters and filters.get("published_only"):
		doc_filters["is_published"] = 1

	if filters and filters.get("wiki_space"):
		wiki_space = filters.get("wiki_space")
		space_doc = frappe.get_cached_doc("Wiki Space", wiki_space)
		if space_doc.root_group:
			# Get all descendants of the root group
			descendants = get_descendants_of("Wiki Document", space_doc.root_group, ignore_permissions=True)
			if descendants:
				doc_filters["name"] = ("in", descendants)
				wiki_documents = frappe.db.get_all(
					"Wiki Document",
					fields=["name", "content"],
					filters=doc_filters,
				)
			else:
				wiki_documents = []
		else:
			wiki_documents = []
	else:
		wiki_documents = frappe.db.get_all("Wiki Document", fields=["name", "content"], filters=doc_filters)

	include_images = filters and bool(filters.get("check_images"))
	check_internal_links = filters and bool(filters.get("check_internal_links"))

	for doc in wiki_documents:
		broken_links_for_doc = get_broken_links(doc.content, include_images, check_internal_links)
		rows = [{"broken_link": link, "wiki_document": doc["name"]} for link in broken_links_for_doc]
		data.extend(rows)

	return data


def get_broken_links(
	md_content: str, include_images: bool = True, include_relative_urls: bool = False
) -> list[str]:
	html = frappe.utils.md_to_html(md_content)
	soup = BeautifulSoup(html, "html.parser")

	links = soup.find_all("a")
	if include_images:
		links += soup.find_all("img")

	broken_links = []
	for el in links:
		url = el.attrs.get("href") or el.attrs.get("src")

		if is_hash_link(url):
			continue

		is_relative = is_relative_url(url)
		relative_url = None

		if is_relative and not include_relative_urls:
			continue

		if is_relative:
			relative_url = url
			url = frappe.utils.data.get_url(url)  # absolute URL

		is_broken = is_broken_link(url)
		if is_broken:
			if is_relative:
				broken_links.append(relative_url)  # original URL
			else:
				broken_links.append(url)

	return broken_links


def is_relative_url(url: str) -> bool:
	return url.startswith("/")


def is_hash_link(url: str) -> bool:
	return url.startswith("#")


# Sent with every check so sites don't reject us as a bot. The default
# python-requests User-Agent is widely blocked, which made valid third-party
# links respond with 403/405/429 and get mis-flagged as broken.
BROWSER_USER_AGENT = (
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
	"(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def is_broken_link(url: str) -> bool:
	try:
		status_code = get_request_status_code(url)
	except Exception:
		# Host unreachable (DNS failure, refused/reset connection, timeout):
		# the link can't be loaded at all, so treat it as broken.
		return True

	return is_dead_status(status_code)


def is_dead_status(status_code: int) -> bool:
	# 404 Not Found and 410 Gone mean the page is definitively missing, and 5xx
	# means the server is failing. Codes like 401/403/405/429 usually indicate
	# auth walls or bot protection on pages that are otherwise valid, so they
	# must not be treated as broken.
	return status_code in (404, 410) or 500 <= status_code <= 599


def get_request_status_code(url: str) -> int:
	headers = {"User-Agent": BROWSER_USER_AGENT}
	# Try HEAD first (faster). Many sites block HEAD or answer it with 403/405,
	# so retry with GET only when HEAD was inconclusive. A HEAD that already
	# reports the link dead (404/410/5xx) is trusted as-is, otherwise a
	# bot-blocked GET could mask a genuinely broken link.
	response = requests.head(url, headers=headers, verify=False, timeout=5, allow_redirects=True)
	if response.status_code >= 400 and not is_dead_status(response.status_code):
		response = requests.get(
			url, headers=headers, verify=False, timeout=5, allow_redirects=True, stream=True
		)
		response.close()  # Close connection immediately, we only need status code
	return response.status_code
