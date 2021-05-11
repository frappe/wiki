# -*- coding: utf-8 -*-
# Copyright (c) 2021, Frappe and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
from frappe.model.document import Document
import os
import shutil
# www/docs/user/manual/en/accounts/bank-reconciliation.md
class MigrateToWiki(Document):
	# app_name = erpnext_documentation
	# docs_directory = www/docs/user/manual/en
	# assets_directory = www/docs/assets/img
	# assets_prepend = {{docs_base_url}}/assets/img
	# documentation_route = /

	def on_update(self):
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
			"route": self.docs_directory,
			"title": self.docs_directory,
		}
		wiki_sidebar.update(wiki_sidebar_dict)
		wiki_sidebar.save()

	def set_docs_tree_generator(self):
		self.docs_tree_generator = os.walk(f'{frappe.get_app_path(self.app_name)}{os.sep}{self.docs_directory}')

	def set_assets_tree_generator(self):
		self.assets_tree_generator = os.walk(frappe.get_app_path(self.app_name) + os.sep + self.assets_directory)


	def migrate_wiki(self):
		for root, dirs, files in self.docs_tree_generator:
			self.migrate_dir(root, dirs, files)
			for file in files:
				self.migrate_file(root, file)



	def migrate_dir(self, root, dirs, files):
		for directory in dirs:
			if directory == '__pycache__': continue
			wiki_sidebar = frappe.new_doc("Wiki Sidebar")

			wiki_sidebar_dict = {
				"route": root[root.find(self.docs_directory): ] + os.sep + directory,
				"title": directory.capitalize(),
				"parent_wiki_sidebar": root[root.find(self.docs_directory): ],
			}

			wiki_sidebar.update(wiki_sidebar_dict)
			wiki_sidebar.save()


	def migrate_file(self, root, file):
		heading_index = -1
		if not file.endswith('.md'):
			return
		with open(f'{root}{os.sep}{file}') as f:
			lines = f.readlines()
		for index, line in enumerate(lines):
			if line.startswith('# '):
				heading_index = index
				break

		parent= root[root.find(self.docs_directory): ]
		route = f'{self.documentation_route}{os.sep}{parent}{os.sep}{file[:-3]}'

		title = lines[heading_index][2:] if heading_index != -1 else route.split(os.sep)[-1]
		content = ''.join(lines[heading_index + 1 : ]) if heading_index != -1 else ''.join(lines)

		# if self.docs_change_dict.get(root[root.find(self.docs_directory)+1: ]):
		# 	for asset in self.docs_change_dict.get(root[root.find(self.docs_directory)+1: ]):
				# content = content.replace(asset['orig_file_url'], asset['file_url'])
		print(self.docs_change_dict)
		for prev, new in self.docs_change_dict.items():
			content = content.replace(prev, new)

		if file.endswith('index.md') or file.endswith('contents.md'):
			with open(f'{root}{os.sep}index.txt') as f:
				lines = f.readlines()
			content = content.replace('{index}',"<ul><li>" +  "<li>".join(lines) + "</ul>")
			route = f'{self.documentation_route}{os.sep}{parent}'

		wiki_page = frappe.new_doc("Wiki Page")
		wiki_page_dict = {
			"title": title,
			"parent_wiki_sidebar": root,
			'allow_guest': 1,
			'published': 1,
			'content': content,
			'route': route,
			'parenttype': 'Wiki Page'
		}
		wiki_page.update(wiki_page_dict)
		wiki_page.save()


		wiki_sidebar_item = frappe.new_doc('Wiki Sidebar Item')
		wiki_sidebar_item_dict = {
			"wiki_page": wiki_page.name,
			"title": wiki_page.title,
			"parent": parent,
			'parenttype': 'Wiki Sidebar',
			'route': route,
			'parentfield': 'sidebar_items'
		}
		wiki_sidebar_item.update(wiki_sidebar_item_dict)
		wiki_sidebar_item.save()

	frappe.db.commit()

	def copy_assets(self):
		shutil.copytree(
			frappe.get_app_path(self.app_name) + os.sep + self.assets_directory,
			f"{os.getcwd()}{os.sep}{frappe.local.site}{os.sep}public{os.sep}files{os.sep}{self.app_name}{os.sep}{self.documentation_route}"
		)


	def create_files(self):
		self.docs_change_dict = {}
		file_doc = frappe.new_doc('File')

		file_doc.update({
			"doctype": "File",
			"folder": f'Home',
			"file_name": f'{self.app_name}',
			"is_private": 0,
			"is_folder": 1,
		})
		# file_doc.save(ignore_permissions=True)

		folder = f'Home{os.sep}{self.app_name}'
		for directory in self.documentation_route.split(os.sep):
			file_doc = frappe.new_doc('File')

			file_doc.update({
				"doctype": "File",
				"folder": folder,
				"file_name": directory,
				"is_private": 0,
				"is_folder": 1,
			})

			# file_doc.save(ignore_permissions=True)

			folder = f'{folder}{os.sep}{directory}'

		for root, dirs, files in self.assets_tree_generator:

			for directory in dirs:
				fold = f'{folder}{os.sep}{root[root.find(self.assets_directory)  + len(self.assets_directory) + 1:]}'
				fold=fold.replace(f'{os.sep}{os.sep}',os.sep)
				if fold.endswith(f'{os.sep}'):
					fold = fold[:-1]
				file_doc = frappe.new_doc('File')

				file_doc.update({
					"doctype": "File",
					"folder": fold,
					"file_name": directory,
					"is_private": 0,
					"is_folder": 1,
				})

				# file_doc.save(ignore_permissions=True)



			for file in files:
				if file == "__init__.py":
					continue

				# shutil.copy(
				# 	f'{root}{os.sep}{file}',
				# 	f'{os.getcwd()}{os.sep}{frappe.local.site}{os.sep}public{os.sep}files{os.sep}'
				# )

				fol = f'{folder}{os.sep}{root[root.find(self.assets_directory) + len(self.assets_directory):] }'
				fol=fol.replace(f'{os.sep}{os.sep}',os.sep)
				if fol.endswith(os.sep):
					fol = fol[:-1]
				print('filesjfhjk')
				print(fol)
				file_url = f'{os.sep}files{os.sep}{file}'
				print(file_url)
				file_doc = frappe.new_doc('File')
				file_doc.update({
					"doctype": "File",
					"folder": fol,
					"file_name": file,
					"is_private": 0,
					"file_url": file_url
				})
				# file_doc.save(ignore_permissions=True)

				orig_file_url = f'{self.assets_prepend}{os.sep}{root[root.find(self.assets_directory) + len(self.assets_directory) + 1:] }{os.sep}{file}'


				self.docs_change_dict[orig_file_url] = file_url
				self.docs_change_dict[orig_file_url.replace('{{docs_base_url}}', self.docs_base_url)] = file_url
				print("self.docs_change_dict")

				print(self.docs_change_dict)


