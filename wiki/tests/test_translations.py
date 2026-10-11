# Copyright (c) 2026, Frappe and Contributors
# See license.txt

import frappe
from frappe.translate import clear_cache

from wiki.tests import WikiTestCase as IntegrationTestCase
from wiki.www import wiki_app


class TestTranslatedMessages(IntegrationTestCase):
	def setUp(self):
		self.previous_lang = frappe.local.lang
		frappe.local.lang = "es"

	def tearDown(self):
		frappe.local.lang = self.previous_lang
		clear_cache()

	def test_boot_carries_the_wiki_catalog(self):
		messages = wiki_app.get_boot()["translated_messages"]
		self.assertEqual(messages["Settings"], "Configuración")

	def test_catalog_leaves_out_strings_only_other_apps_translate(self):
		self.assertNotIn("Workflow State", wiki_app.get_translated_messages())

	def test_catalog_includes_site_translations(self):
		frappe.get_doc(
			doctype="Translation",
			language="es",
			source_text="Wiki Test Only String",
			translated_text="Cadena solo de prueba",
		).insert()
		clear_cache()

		messages = wiki_app.get_translated_messages()

		self.assertEqual(messages["Wiki Test Only String"], "Cadena solo de prueba")
