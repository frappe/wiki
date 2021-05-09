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
		wiki_sidebar = frappe.new_doc("Wiki Sidebar")
		wiki_sidebar_dict = {
			"title": self.docs_directory,
		}
		wiki_sidebar.update(wiki_sidebar_dict)
		wiki_sidebar.save()

	def set_docs_tree_generator(self):
		self.docs_tree_generator = os.walk(frappe.get_app_path(self.app_name) + '/' + self.docs_directory)

	def set_assets_tree_generator(self):
		self.assets_tree_generator = os.walk(frappe.get_app_path(self.app_name) + '/' + self.assets_directory)


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
				"title": root[root.find(self.docs_directory): ] + '/' + directory,
				"parent_wiki_sidebar": root[root.find(self.docs_directory): ],
			}

			wiki_sidebar.update(wiki_sidebar_dict)
			wiki_sidebar.save()


	def migrate_file(self, root, file):
		if not file.endswith('.md'):
			return
		with open(f'{root}/{file}') as f:
			lines = f.readlines()
		for index, line in enumerate(lines):
			if line.startswith('# '):
				heading_index = index
				break

		parent= root[root.find(self.docs_directory): ]
		route = f'{self.documentation_route}/{parent}/{file[:-3]}'

		title = lines[heading_index] if heading_index else route.split('/')[-1]
		content = ''.join(lines[heading_index + 1 : ]) if heading_index else '-'

		if self.docs_change_dict.get(root[root.find(self.docs_directory)+1: ]):
			for asset in self.docs_change_dict.get(root[root.find(self.docs_directory)+1: ]):
				content = content.replace(asset['orig_file_url'], asset['file_url'])

		if file.endswith('index.md'):
			with open(f'{root}/index.html') as f:
				lines = f.readlines()
			content = content.replace('{index}',"<ul><li>" +  "<li>".join(lines) + "</ul>")
			route = f'{self.documentation_route}/{parent}'

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
			"title": title,
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
			frappe.get_app_path(self.app_name) + '/' + self.assets_directory,
			f"{os.getcwd()}/{frappe.local.site}/public/files/{self.app_name}/{self.documentation_route}"
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
		file_doc.save(ignore_permissions=True)

		folder = f'Home/{self.app_name}'
		for directory in self.documentation_route.split('/'):
			file_doc = frappe.new_doc('File')

			file_doc.update({
				"doctype": "File",
				"folder": folder,
				"file_name": directory,
				"is_private": 0,
				"is_folder": 1,
			})

			file_doc.save(ignore_permissions=True)

			folder = f'{folder}/{directory}'

		for root, dirs, files in self.assets_tree_generator:

			for directory in dirs:
				print("sdmfn")
				print(folder)
				print(root)
				fold = f'Home/{self.app_name}/{root[root.find(self.assets_directory)  + len(self.assets_directory) + 1:]}/{self.documentation_route}'
				fold=fold.replace('//','/')
				file_doc = frappe.new_doc('File')

				file_doc.update({
					"doctype": "File",
					"folder": fold,
					"file_name": directory,
					"is_private": 0,
					"is_folder": 1,
				})

				file_doc.save(ignore_permissions=True)



			for file in files:
				print('filesjfhjk')
				print(file)
				file_doc = frappe.new_doc('File')
				file_url  = f"/files/{self.app_name}/{root[root.find(self.assets_directory) + len(self.assets_directory):]}/{file}"
				file_doc.update({
					"doctype": "File",
					"folder": f'Home/{self.app_name}/{self.documentation_route}/{root[root.find(self.assets_directory) + len(self.assets_directory):] }',
					"file_name": file,
					"is_private": 0,
					"file_url": file_url
				})
				file_doc.save(ignore_permissions=True)

				ind = f'{root[root.find(self.assets_directory) + len(self.assets_directory) + 1:] }'
				orig_file_url = f'{self.assets_prepend}/{root[root.find(self.assets_directory) + len(self.assets_directory) + 1:] }/{file}'

				mutation = {
					"orig_file_url": orig_file_url,
					"file_url": file_url
				}

				if self.docs_change_dict.get(ind):
					self.docs_change_dict[ind]= [mutation]
				else:
					self.docs_change_dict.get(ind).append(mutation)



