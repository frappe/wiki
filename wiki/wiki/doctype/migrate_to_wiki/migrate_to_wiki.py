# -*- coding: utf-8 -*-
# Copyright (c) 2021, Frappe and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
from frappe.model.document import Document
import os
# www/docs/user/manual/en/accounts/bank-reconciliation.md
class MigrateToWiki(Document):
	def on_update(self):
		base = 'www/docs/user/manual/en/projects'

		wiki_sidebar = frappe.new_doc("Wiki Sidebar")
		wiki_sidebar_dict = {
			"title": base,
		}
		wiki_sidebar.update(wiki_sidebar_dict)
		wiki_sidebar.save()
		print(frappe.get_app_path(self.app_name) + '/' +base)
		for root, dirs, files in os.walk(frappe.get_app_path(self.app_name) + '/' +base):

			for dir in dirs:
				if dir == '__pycache__': continue
				wiki_sidebar = frappe.new_doc("Wiki Sidebar")
				wiki_sidebar_dict = {
					"title": root[root.find(base): ] + '/' + dir,
					"parent_wiki_sidebar": root[root.find(base): ],
				}
				wiki_sidebar.update(wiki_sidebar_dict)
				wiki_sidebar.save()


			for file in files:
				if not file.endswith('.md'):
					continue
				with open(f'{root}/{file}') as f:
					lines = f.readlines()
				for index, line in enumerate(lines):
					if line.startswith('# '):
						heading_index = index
						break

				route= root[root.find(base): ]

				title = lines[heading_index] if heading_index else route
				content = ''.join(lines[heading_index + 1 : ]) if heading_index else '-'
				wiki_page = frappe.new_doc("Wiki Page")
				wiki_page_dict = {
					"title": title,
					"parent_wiki_sidebar": root,
					'allow_guest': 1,
					'published': 1,
					'content': content,
					'route': f'{route}/{file[:-3]}',
					'parenttype': 'Wiki Page'
				}

				wiki_page.update(wiki_page_dict)
				wiki_page.save()

				# pages.append(wiki_page_dict)

				wiki_sidebar_item = frappe.new_doc('Wiki Sidebar Item')
				wiki_sidebar_item_dict = {
					"title": title,
					"parent": route,
					'parenttype': 'Wiki Sidebar',
					'route': f'{route}/{file[:-3]}',
					'parentfield': 'sidebar_items'
				}
				wiki_sidebar_item.update(wiki_sidebar_item_dict)
				wiki_sidebar_item.save()
		
			frappe.db.commit()
