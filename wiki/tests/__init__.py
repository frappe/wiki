# Version-aware base test case: Frappe v16 ships IntegrationTestCase, v15 only has
# FrappeTestCase. Tests import WikiTestCase so the same suite runs on both.
try:
	from frappe.tests import IntegrationTestCase as WikiTestCase
except ImportError:
	from frappe.tests.utils import FrappeTestCase, change_settings

	class WikiTestCase(FrappeTestCase):
		change_settings = staticmethod(change_settings)
