# Copyright (c) 2021, Frappe and contributors
# For license information, please see license.txt


import os
import shutil

import frappe
from frappe.core.doctype.file.utils import get_content_hash, get_file_name
from frappe.model.document import Document


# www/docs/user/manual/en/accounts/bank-reconciliation.md
class MigrateToWiki(Document):
	# app_name = erpnext_documentation
	# docs_directory = www/docs/user/manual/en
	# assets_directory = www/docs/assets/img
	# assets_prepend = {{docs_base_url}}/assets/img
	# documentation_route = /

	def validate(self):
		self.app_name = self.clean_paths(self.app_name)
		self.docs_directory = self.clean_paths(self.docs_directory)
		self.assets_directory = self.clean_paths(self.assets_directory)
		self.assets_prepend = self.clean_paths(self.assets_prepend)
		self.documentation_route = self.clean_paths(self.documentation_route)

	def clean_paths(self, path):
		if not path:
			path = ""
		return path.strip(" ").strip("/").replace("//", "/")

	def on_update(self):
		if frappe.flags.in_install:
			return
		self.create_first_path()
		self.set_docs_tree_generator()
		# self.copy_assets()
		self.set_assets_tree_generator()
		self.create_files()
		self.migrate_wiki()

	def create_first_path(self):
		self.docs_change_dict = {}
		wiki_sidebar = frappe.new_doc("Wiki Sidebar")
		wiki_sidebar_dict = {
			"route": self.documentation_route,
			"title": "Home",
			"is_group": True,
		}
		wiki_sidebar.update(wiki_sidebar_dict)
		try:
			wiki_sidebar.save()
		except frappe.DuplicateEntryError:
			return

	def set_docs_tree_generator(self):
		self.docs_tree_generator = os.walk(
			f"{frappe.get_app_path(self.app_name)}{os.sep}{self.docs_directory}"
		)

	def set_assets_tree_generator(self):
		self.assets_tree_generator = os.walk(
			frappe.get_app_path(self.app_name) + os.sep + self.assets_directory
		)

	def migrate_wiki(self):
		for root, dirs, files in self.docs_tree_generator:
			self.migrate_dir(root, dirs, files)
			for file in files:
				self.migrate_file(root, file, files)

	def migrate_dir(self, root, dirs, files):
		for directory in dirs:
			if directory == "__pycache__":
				continue
			wiki_sidebar = frappe.new_doc("Wiki Sidebar")
			parent_wiki_sidebar = f"{self.documentation_route}{os.sep}{root[root.find(self.docs_directory) + len(self.docs_directory) + 1: ]}".replace(
				"//", "/"
			).strip("/")
			wiki_sidebar_dict = {
				"route": f"{parent_wiki_sidebar}{os.sep}{directory}".replace("//", "/"),
				"title": directory.capitalize(),
				"parent_wiki_sidebar": parent_wiki_sidebar,
			}

			wiki_sidebar.update(wiki_sidebar_dict)
			wiki_sidebar.save()

			wiki_sidebar_item = frappe.new_doc("Wiki Sidebar Item")
			wiki_sidebar_item_dict = {
				"type": "Wiki Sidebar",
				"item": wiki_sidebar.name,
				"parent": parent_wiki_sidebar,
				"parenttype": "Wiki Sidebar",
				"parentfield": "sidebar_items",
			}
			wiki_sidebar_item.update(wiki_sidebar_item_dict)
			wiki_sidebar_item.save()

	def migrate_file(self, root, file, files):
		if file == "index.md" and "contents.md" in files:
			return
		heading_index = -1
		if not file.endswith(".md"):
			return
		with open(f"{root}{os.sep}{file}") as f:
			lines = f.readlines()
		for index, line in enumerate(lines):
			if line.startswith("#"):
				heading_index = index
				break

		parent = f"{self.documentation_route}{os.sep}{root[root.find(self.docs_directory) + len(self.docs_directory) + 1: ]}".replace(
			"//", "/"
		).strip("/")
		route = f"{parent}{os.sep}{file[:-3]}"

		title = lines[heading_index].strip("#").strip(" ") if heading_index != -1 else route.split(os.sep)[-1]
		content = "".join(lines[heading_index + 1 :]) if heading_index != -1 else "".join(lines)
		if "shifted to landing page" in content:
			return

		if content:
			for prev, new in self.docs_change_dict.items():
				content = content.replace(prev, new)
			content = content.replace(self.docs_directory.strip("w"), f"/{self.documentation_route}")

			if file.endswith("index.md") or file.endswith("contents.md"):
				try:
					with open(f"{root}{os.sep}index.txt") as f:
						lines = f.readlines()
					content = content.replace("{index}", "<ul><li>" + "<li>".join(lines) + "</ul>")
				except Exception:
					content = content.replace("{index}", "<ul><li>" + "<li>".join(files) + "</ul>")

				route = f"{parent}".strip("/")

		else:
			content = f"<a href='{parent}'>{parent}</a>"

		wiki_page = frappe.new_doc("Wiki Page")
		wiki_page_dict = {
			"title": title,
			"allow_guest": 1,
			"published": 1,
			"content": content,
			"route": route,
		}
		wiki_page.update(wiki_page_dict)
		try:
			wiki_page.save()
		except Exception:
			print(wiki_page.name)
			print(wiki_page.title)

		wiki_sidebar_item = frappe.new_doc("Wiki Sidebar Item")
		wiki_sidebar_item_dict = {
			"item": wiki_page.name,
			"title": wiki_page.title,
			"parent": parent,
			"parenttype": "Wiki Sidebar",
			"route": route,
			"parentfield": "sidebar_items",
		}
		wiki_sidebar_item.update(wiki_sidebar_item_dict)
		wiki_sidebar_item.save()

	frappe.db.commit()

	def copy_assets(self):
		shutil.copytree(
			frappe.get_app_path(self.app_name) + os.sep + self.assets_directory,
			f"{os.getcwd()}{os.sep}{frappe.local.site}{os.sep}public{os.sep}files{os.sep}{self.app_name}{os.sep}{self.documentation_route}",
		)

	def create_files(self):
		self.docs_change_dict = {}
		file_doc = frappe.new_doc("File")

		file_doc.update(
			{
				"doctype": "File",
				"folder": "Home",
				"file_name": f"{self.app_name}",
				"is_private": 0,
				"is_folder": 1,
			}
		)
		try:
			file_doc.save(ignore_permissions=True)
		except Exception as ex:
			print(ex)

		folder = f"Home{os.sep}{self.app_name}"
		for directory in self.documentation_route.split(os.sep):
			file_doc = frappe.new_doc("File")

			file_doc.update(
				{
					"doctype": "File",
					"folder": folder,
					"file_name": directory,
					"is_private": 0,
					"is_folder": 1,
				}
			)
			try:
				file_doc.save(ignore_permissions=True)
			except Exception as ex:
				print(ex)

			folder = f"{folder}{os.sep}{directory}"

		for root, dirs, files in self.assets_tree_generator:
			for directory in dirs:
				fold = f"{folder}{os.sep}{root[root.find(self.assets_directory)  + len(self.assets_directory) + 1:]}"
				fold = fold.replace(f"{os.sep}{os.sep}", os.sep)
				if fold.endswith(f"{os.sep}"):
					fold = fold[:-1]
				file_doc = frappe.new_doc("File")

				file_doc.update(
					{
						"doctype": "File",
						"folder": fold,
						"file_name": directory,
						"is_private": 0,
						"is_folder": 1,
					}
				)

				try:
					file_doc.save(ignore_permissions=True)
				except Exception as ex:
					print(ex)

			for file in files:
				if file == "__init__.py":
					continue
				if os.path.exists(
					f"{os.getcwd()}{os.sep}{frappe.local.site}{os.sep}public{os.sep}files{os.sep}{file}"
				):
					if self.create_new_assets:
						try:
							with open(f"{root}{os.sep}{file}", "rb") as f:
								content_hash = get_content_hash(f.read())
						except OSError:
							frappe.msgprint(
								frappe._("File {0} does not exist").format(f"{root}{os.sep}{file}")
							)
							raise

						new_file_name = get_file_name(file, content_hash[-6:])
						shutil.copy(
							f"{root}{os.sep}{file}",
							f"{os.getcwd()}{os.sep}{frappe.local.site}{os.sep}public{os.sep}files{os.sep}{new_file_name}",
						)
						file_url = f"{os.sep}files{os.sep}{new_file_name}"
					else:
						file_url = f"{os.sep}files{os.sep}{file}"
				else:
					shutil.copy(
						f"{root}{os.sep}{file}",
						f"{os.getcwd()}{os.sep}{frappe.local.site}{os.sep}public{os.sep}files{os.sep}",
					)
					file_url = f"{os.sep}files{os.sep}{file}"

				fol = (
					f"{folder}{os.sep}{root[root.find(self.assets_directory) + len(self.assets_directory):] }"
				)
				fol = fol.replace(f"{os.sep}{os.sep}", os.sep)
				if fol.endswith(os.sep):
					fol = fol[:-1]
				file_doc = frappe.new_doc("File")
				file_doc.update(
					{
						"doctype": "File",
						"folder": fol,
						"file_name": file,
						"is_private": 0,
						"file_url": file_url,
					}
				)
				try:
					file_doc.save(ignore_permissions=True)
				except Exception as ex:
					print(ex)

				orig_file_url = f"{self.assets_prepend}{os.sep}{root[root.find(self.assets_directory) + len(self.assets_directory) + 1:] }{os.sep}{file}"

				self.docs_change_dict[orig_file_url] = file_url
				self.docs_change_dict[orig_file_url.replace("{{docs_base_url}}", self.docs_base_url)] = (
					file_url
				)
