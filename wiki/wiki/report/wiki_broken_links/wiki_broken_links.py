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
			"label": _("Wiki Page"),
			"fieldname": "wiki_page",
			"fieldtype": "Link",
			"options": "Wiki Page",
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
	data = []

	wiki_pages = frappe.db.get_all("Wiki Page", fields=["name", "content"])

	if filters and filters.get("wiki_space"):
		wiki_space = filters.get("wiki_space")
		wiki_pages = frappe.db.get_all(
			"Wiki Group Item",
			fields=["wiki_page as name", "wiki_page.content as content"],
			filters={"parent": wiki_space, "parenttype": "Wiki Space"},
		)

	include_images = filters and bool(filters.get("check_images"))
	check_internal_links = filters and bool(filters.get("check_internal_links"))

	for page in wiki_pages:
		broken_links_for_page = get_broken_links(page.content, include_images, not check_internal_links)
		rows = [{"broken_link": link, "wiki_page": page["name"]} for link in broken_links_for_page]
		data.extend(rows)

	return data


def get_broken_links(md_content: str, include_images: bool = True, ignore_relative_urls: bool = True):
	html = frappe.utils.md_to_html(md_content)
	soup = BeautifulSoup(html, "html.parser")

	links = soup.find_all("a")
	if include_images:
		links += soup.find_all("img")

	broken_links = []
	for el in links:
		url = el.attrs.get("href") or el.attrs.get("src")
		is_relative = is_relative_url(url)
		relative_url = None

		if is_relative and ignore_relative_urls:
			continue
		elif is_relative:
			from frappe.utils.data import get_url

			relative_url = url
			url = get_url(url)  # absolute URL

		try:
			response = requests.head(url, verify=False, timeout=5)
			if response.status_code >= 400:
				if is_relative:
					broken_links.append(relative_url)
				else:
					broken_links.append(url)
		except Exception:
			if is_relative:
				broken_links.append(relative_url)
			else:
				broken_links.append(url)

	return broken_links


def is_relative_url(url: str):
	return url.startswith("/")
