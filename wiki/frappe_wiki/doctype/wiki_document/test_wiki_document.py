# Copyright (c) 2025, Frappe and Contributors
# See license.txt

import unittest
from types import SimpleNamespace

import frappe
from frappe.tests import IntegrationTestCase

from wiki.frappe_wiki.doctype.wiki_document.wiki_document import process_navbar_items
from wiki.wiki.markdown import render_markdown, render_markdown_with_toc

# On IntegrationTestCase, the doctype test records and all
# link-field test record dependencies are recursively loaded
# Use these module variables to add/remove to/from that list
EXTRA_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]
IGNORE_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]


class IntegrationTestWikiDocument(IntegrationTestCase):
	"""
	Integration tests for WikiDocument.
	Use this class for testing interactions between multiple components.
	"""

	pass


class TestGetWebContext(IntegrationTestCase):
	"""
	Unit tests for the get_web_context method of WikiDocument.
	Tests navigation (prev/next doc) edge cases and wiki spaces switcher.
	"""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.test_docs = []
		cls.test_spaces = []

	def tearDown(self):
		# Clean up test documents
		for doc_name in reversed(self.test_docs):
			if frappe.db.exists("Wiki Document", doc_name):
				frappe.delete_doc("Wiki Document", doc_name, force=True)
		self.test_docs = []

		# Clean up test spaces
		for space_name in self.test_spaces:
			if frappe.db.exists("Wiki Space", space_name):
				frappe.delete_doc("Wiki Space", space_name, force=True)
		self.test_spaces = []

	def _create_wiki_document(
		self, title, parent=None, is_group=False, is_published=True, sort_order=0, content=None
	):
		"""Helper to create a wiki document for testing."""
		doc = frappe.get_doc(
			{
				"doctype": "Wiki Document",
				"title": title,
				"parent_wiki_document": parent,
				"is_group": is_group,
				"is_published": is_published,
				"sort_order": sort_order,
				"content": content if content is not None else f"Content for {title}",
			}
		)
		doc.insert(ignore_permissions=True)
		self.test_docs.append(doc.name)
		return doc

	def _create_wiki_space(
		self, space_name, route, root_group, show_in_switcher=True, is_published=True, switcher_order=0
	):
		"""Helper to create a wiki space for testing."""
		doc = frappe.get_doc(
			{
				"doctype": "Wiki Space",
				"space_name": space_name,
				"route": route,
				"root_group": root_group,
				"show_in_switcher": show_in_switcher,
				"is_published": is_published,
				"switcher_order": switcher_order,
			}
		)
		doc.insert(ignore_permissions=True)
		self.test_spaces.append(doc.name)
		return doc

	def test_first_document_has_no_prev_doc(self):
		"""Test that the first document in the tree has no previous document."""
		# Create a simple tree: Root Group -> Doc1 -> Doc2 -> Doc3
		root_group = self._create_wiki_document("Test Root Group", is_group=True)
		doc1 = self._create_wiki_document("First Document", parent=root_group.name)
		self._create_wiki_document("Second Document", parent=root_group.name)
		self._create_wiki_document("Third Document", parent=root_group.name)

		# Create wiki space
		self._create_wiki_space("Test Space", "test-space", root_group.name)

		# Get context for the first document
		doc1.reload()
		context = doc1.get_web_context()

		# First document should have no prev_doc but should have next_doc
		self.assertIsNone(context["prev_doc"])
		self.assertIsNotNone(context["next_doc"])
		self.assertEqual(context["next_doc"]["title"], "Second Document")

	def test_last_document_has_no_next_doc(self):
		"""Test that the last document in the tree has no next document."""
		# Create a simple tree: Root Group -> Doc1 -> Doc2 -> Doc3
		root_group = self._create_wiki_document("Test Root Group Last", is_group=True)
		self._create_wiki_document("First Doc", parent=root_group.name)
		self._create_wiki_document("Second Doc", parent=root_group.name)
		doc3 = self._create_wiki_document("Third Doc", parent=root_group.name)

		# Create wiki space
		self._create_wiki_space("Test Space Last", "test-space-last", root_group.name)

		# Get context for the last document
		doc3.reload()
		context = doc3.get_web_context()

		# Last document should have prev_doc but no next_doc
		self.assertIsNotNone(context["prev_doc"])
		self.assertEqual(context["prev_doc"]["title"], "Second Doc")
		self.assertIsNone(context["next_doc"])

	def test_middle_document_has_both_prev_and_next(self):
		"""Test that a middle document has both prev and next documents."""
		# Create a simple tree: Root Group -> Doc1 -> Doc2 -> Doc3
		root_group = self._create_wiki_document("Test Root Group Middle", is_group=True)
		self._create_wiki_document("First Page", parent=root_group.name)
		doc2 = self._create_wiki_document("Middle Page", parent=root_group.name)
		self._create_wiki_document("Last Page", parent=root_group.name)

		# Create wiki space
		self._create_wiki_space("Test Space Middle", "test-space-middle", root_group.name)

		# Get context for the middle document
		doc2.reload()
		context = doc2.get_web_context()

		# Middle document should have both prev_doc and next_doc
		self.assertIsNotNone(context["prev_doc"])
		self.assertEqual(context["prev_doc"]["title"], "First Page")
		self.assertIsNotNone(context["next_doc"])
		self.assertEqual(context["next_doc"]["title"], "Last Page")

	def test_single_document_has_no_prev_or_next(self):
		"""Test that a single document in the tree has neither prev nor next."""
		# Create a tree with only one document
		root_group = self._create_wiki_document("Test Root Group Single", is_group=True)
		only_doc = self._create_wiki_document("Only Document", parent=root_group.name)

		# Create wiki space
		self._create_wiki_space("Test Space Single", "test-space-single", root_group.name)

		# Get context for the only document
		only_doc.reload()
		context = only_doc.get_web_context()

		# Single document should have neither prev_doc nor next_doc
		self.assertIsNone(context["prev_doc"])
		self.assertIsNone(context["next_doc"])

	def test_wiki_spaces_for_switcher_includes_current_space_even_if_not_published(self):
		"""
		Test that wiki_spaces_for_switcher includes the current space
		even when show_in_switcher is disabled, because of or_filters.
		"""
		# Create three wiki spaces with their root groups
		root1 = self._create_wiki_document("Root Group Space 1", is_group=True)
		doc1 = self._create_wiki_document("Doc in Space 1", parent=root1.name)

		root2 = self._create_wiki_document("Root Group Space 2", is_group=True)
		self._create_wiki_document("Doc in Space 2", parent=root2.name)

		root3 = self._create_wiki_document("Root Group Space 3", is_group=True)
		self._create_wiki_document("Doc in Space 3", parent=root3.name)

		# Create spaces - Space 1 has show_in_switcher=False but current doc belongs to it
		self._create_wiki_space("Space One", "space-one", root1.name, show_in_switcher=False)
		self._create_wiki_space("Space Two", "space-two", root2.name, show_in_switcher=True)
		self._create_wiki_space("Space Three", "space-three", root3.name, show_in_switcher=True)

		# Get context for doc in Space 1 (which has show_in_switcher=False)
		doc1.reload()
		context = doc1.get_web_context()

		# wiki_spaces_for_switcher should include all 3 test spaces:
		# - Space 1 because it's the current space (or_filter: name=space1.name)
		# - Space 2 and 3 because show_in_switcher=True
		# Note: There may be other pre-existing spaces in the database
		switcher_spaces = context["wiki_spaces_for_switcher"]
		space_names = [s["space_name"] for s in switcher_spaces]

		self.assertIn("Space One", space_names)
		self.assertIn("Space Two", space_names)
		self.assertIn("Space Three", space_names)
		# Ensure at least our 3 test spaces are included
		self.assertGreaterEqual(len(switcher_spaces), 3)

	def test_wiki_spaces_for_switcher_excludes_hidden_spaces(self):
		"""
		Test that wiki_spaces_for_switcher excludes spaces with show_in_switcher=False
		when viewing a document from a different space.
		"""
		# Create three wiki spaces with their root groups
		root1 = self._create_wiki_document("Root Hidden Space", is_group=True)
		self._create_wiki_document("Doc in Hidden Space", parent=root1.name)

		root2 = self._create_wiki_document("Root Visible Space", is_group=True)
		doc2 = self._create_wiki_document("Doc in Visible Space", parent=root2.name)

		root3 = self._create_wiki_document("Root Another Visible", is_group=True)
		self._create_wiki_document("Doc in Another Visible", parent=root3.name)

		# Create spaces - Space 1 (Hidden) has show_in_switcher=False
		self._create_wiki_space("Hidden Space", "hidden-space", root1.name, show_in_switcher=False)
		self._create_wiki_space("Visible Space", "visible-space", root2.name, show_in_switcher=True)
		self._create_wiki_space("Another Visible", "another-visible", root3.name, show_in_switcher=True)

		# Get context for doc in Visible Space
		doc2.reload()
		context = doc2.get_web_context()

		# wiki_spaces_for_switcher should include only visible spaces + current space
		# Since current space (Visible Space) has show_in_switcher=True,
		# Hidden Space should be excluded
		switcher_spaces = context["wiki_spaces_for_switcher"]
		space_names = [s["space_name"] for s in switcher_spaces]

		self.assertNotIn("Hidden Space", space_names)
		self.assertIn("Visible Space", space_names)
		self.assertIn("Another Visible", space_names)
		# At least our 2 visible test spaces should be included
		self.assertGreaterEqual(len(switcher_spaces), 2)

	def test_orphan_document_without_wiki_space(self):
		"""
		Test that get_web_context handles a document that is not associated
		with any Wiki Space (no parent, standalone published document).
		"""
		# Create a standalone document with no parent and no wiki space
		orphan_doc = self._create_wiki_document(
			"Orphan Published Document",
			parent=None,
			is_group=False,
			is_published=True,
		)

		# Get context for the orphan document
		orphan_doc.reload()
		context = orphan_doc.get_web_context()

		# The document should still return a valid context
		# Even without a wiki space, these should be handled gracefully
		self.assertIsNone(context.get("prev_doc"))
		self.assertIsNone(context.get("next_doc"))
		self.assertIsNone(context.get("wiki_space"))
		self.assertEqual(context.get("wiki_spaces_for_switcher"), [])
		self.assertEqual(context.get("navbar_items"), [])
		self.assertEqual(context.get("nested_tree"), [])
		self.assertIsNone(context.get("favicon"))

		# hide_chrome should be True to hide sidebar, search, navbar
		self.assertTrue(context.get("hide_chrome"))

		# Content should still be rendered
		self.assertIsNotNone(context.get("rendered_content"))
		self.assertEqual(context.get("title"), "Orphan Published Document")

	def test_get_web_context_renders_video_markdown_as_html_video_block(self):
		"""Video markdown should render as HTML5 video in public page context."""
		root_group = self._create_wiki_document("Root Video Group", is_group=True)
		video_doc = self._create_wiki_document(
			"Video Document",
			parent=root_group.name,
			content="![Demo Video](/files/demo-video.mp4)",
		)
		self._create_wiki_space("Video Space", "video-space", root_group.name)

		video_doc.reload()
		context = video_doc.get_web_context()

		self.assertIn('<div data-type="video-block"', context["rendered_content"])
		self.assertIn(
			'<video src="/files/demo-video.mp4" controls preload="metadata">',
			context["rendered_content"],
		)
		self.assertIn('<source src="/files/demo-video.mp4" />', context["rendered_content"])
		self.assertNotIn('<img src="/files/demo-video.mp4"', context["rendered_content"])

	def test_wiki_spaces_for_switcher_ordered_by_switcher_order_then_name(self):
		"""
		Test that wiki_spaces_for_switcher is ordered by switcher_order first,
		then alphabetically by space_name.
		"""
		# Create wiki spaces with their root groups
		root1 = self._create_wiki_document("Root Zebra Space", is_group=True)
		doc1 = self._create_wiki_document("Doc in Zebra Space", parent=root1.name)

		root2 = self._create_wiki_document("Root Alpha Space", is_group=True)
		self._create_wiki_document("Doc in Alpha Space", parent=root2.name)

		root3 = self._create_wiki_document("Root Beta Space", is_group=True)
		self._create_wiki_document("Doc in Beta Space", parent=root3.name)

		root4 = self._create_wiki_document("Root Gamma Space", is_group=True)
		self._create_wiki_document("Doc in Gamma Space", parent=root4.name)

		# Create spaces with different switcher_order values
		# Zebra has order 1, so should come first despite name
		# Alpha and Beta both have order 2, so should be sorted alphabetically
		# Gamma has order 3, so should come last
		self._create_wiki_space("Zebra Space", "zebra-space", root1.name, switcher_order=1)
		self._create_wiki_space("Alpha Space", "alpha-space", root2.name, switcher_order=2)
		self._create_wiki_space("Beta Space", "beta-space", root3.name, switcher_order=2)
		self._create_wiki_space("Gamma Space", "gamma-space", root4.name, switcher_order=3)

		# Get context for doc in Zebra Space
		doc1.reload()
		context = doc1.get_web_context()

		switcher_spaces = context["wiki_spaces_for_switcher"]
		space_names = [s["space_name"] for s in switcher_spaces]

		# Filter to only our test spaces to avoid interference from other spaces
		test_space_names = ["Zebra Space", "Alpha Space", "Beta Space", "Gamma Space"]
		filtered_spaces = [name for name in space_names if name in test_space_names]

		# Expected order: Zebra (order 1), Alpha (order 2), Beta (order 2), Gamma (order 3)
		expected_order = ["Zebra Space", "Alpha Space", "Beta Space", "Gamma Space"]
		self.assertEqual(filtered_spaces, expected_order)


class TestMarkdownCallouts(unittest.TestCase):
	"""
	Unit tests for the markdown callout/aside rendering.
	Tests the Astro Starlight-style :::type[title] syntax.
	"""

	def test_basic_note_callout(self):
		"""Test basic :::note callout with default title"""
		md = """:::note
This is a note
:::"""
		html = render_markdown(md)
		self.assertIn('class="callout callout-note"', html)
		self.assertIn('<span class="callout-title">Note</span>', html)
		self.assertIn("This is a note", html)

	def test_tip_callout(self):
		"""Test :::tip callout"""
		md = """:::tip
This is a tip
:::"""
		html = render_markdown(md)
		self.assertIn('class="callout callout-tip"', html)
		self.assertIn('<span class="callout-title">Tip</span>', html)

	def test_caution_callout(self):
		"""Test :::caution callout"""
		md = """:::caution
This is a caution
:::"""
		html = render_markdown(md)
		self.assertIn('class="callout callout-caution"', html)
		self.assertIn('<span class="callout-title">Caution</span>', html)

	def test_danger_callout(self):
		"""Test :::danger callout"""
		md = """:::danger
This is dangerous
:::"""
		html = render_markdown(md)
		self.assertIn('class="callout callout-danger"', html)
		self.assertIn('<span class="callout-title">Danger</span>', html)

	def test_warning_alias_for_caution(self):
		"""Test :::warning is aliased to caution"""
		md = """:::warning
This is a warning
:::"""
		html = render_markdown(md)
		# warning should be rendered as caution
		self.assertIn('class="callout callout-caution"', html)

	def test_custom_title(self):
		"""Test callout with custom title in brackets"""
		md = """:::tip[Did you know?]
This is a tip with a custom title
:::"""
		html = render_markdown(md)
		self.assertIn('class="callout callout-tip"', html)
		self.assertIn('<span class="callout-title">Did you know?</span>', html)

	def test_custom_title_all_types(self):
		"""Test custom titles work for all callout types"""
		types_and_titles = [
			("note", "Important Information"),
			("tip", "Pro Tip"),
			("caution", "Be Careful"),
			("danger", "Critical Warning"),
		]
		for callout_type, title in types_and_titles:
			md = f""":::{callout_type}[{title}]
Content here
:::"""
			html = render_markdown(md)
			self.assertIn(f'class="callout callout-{callout_type}"', html)
			self.assertIn(f'<span class="callout-title">{title}</span>', html)

	def test_custom_title_with_special_characters(self):
		"""Test custom title with special characters"""
		md = """:::note[What's this? A "special" title!]
Content here
:::"""
		html = render_markdown(md)
		self.assertIn('<span class="callout-title">What\'s this? A "special" title!</span>', html)

	def test_custom_title_empty_brackets(self):
		"""Test callout with empty brackets uses default title"""
		md = """:::note[]
Content here
:::"""
		html = render_markdown(md)
		self.assertIn('<span class="callout-title">Note</span>', html)

	def test_custom_title_warning_alias(self):
		"""Test custom title with warning type (aliased to caution)"""
		md = """:::warning[Watch Out!]
Be careful here
:::"""
		html = render_markdown(md)
		self.assertIn('class="callout callout-caution"', html)
		self.assertIn('<span class="callout-title">Watch Out!</span>', html)

	def test_callout_with_markdown_content(self):
		"""Test callout with markdown formatting inside"""
		md = """:::note
This has **bold** and *italic* text
:::"""
		html = render_markdown(md)
		self.assertIn("<strong>bold</strong>", html)
		self.assertIn("<em>italic</em>", html)

	def test_callout_with_link(self):
		"""Test callout with markdown link"""
		md = """:::note
Check out [this link](https://example.com)
:::"""
		html = render_markdown(md)
		self.assertIn('<a href="https://example.com">this link</a>', html)

	def test_callout_with_code_block(self):
		"""Test callout with fenced code block inside"""
		md = """:::note
Here's some code:

```python
print("Hello")
```
:::"""
		html = render_markdown(md)
		self.assertIn('class="callout callout-note"', html)
		# Quotes may be HTML-encoded as &quot;
		self.assertTrue('print("Hello")' in html or "print(&quot;Hello&quot;)" in html)
		self.assertIn("<code", html)
		self.assertIn("language-python", html)

	def test_callout_with_list(self):
		"""Test callout with bullet list"""
		md = """:::tip
Here are some items:

- Item 1
- Item 2
- Item 3
:::"""
		html = render_markdown(md)
		self.assertIn("<li>Item 1</li>", html)
		self.assertIn("<li>Item 2</li>", html)

	def test_multiple_callouts(self):
		"""Test multiple callouts in same document"""
		md = """:::note
First callout
:::

Some text in between

:::danger
Second callout
:::"""
		html = render_markdown(md)
		self.assertIn("callout-note", html)
		self.assertIn("callout-danger", html)
		self.assertIn("First callout", html)
		self.assertIn("Second callout", html)

	def test_callout_has_icon(self):
		"""Test that callouts include SVG icons"""
		md = """:::note
Content
:::"""
		html = render_markdown(md)
		self.assertIn("<svg", html)
		self.assertIn("</svg>", html)

	def test_empty_content(self):
		"""Test render_markdown with empty string"""
		self.assertEqual(render_markdown(""), "")
		self.assertEqual(render_markdown(None), "")

	def test_regular_markdown_still_works(self):
		"""Test that regular markdown without callouts still renders"""
		md = """# Heading

This is a paragraph with **bold** text.

- List item 1
- List item 2
"""
		html = render_markdown(md)
		self.assertIn('<h1 id="heading">Heading</h1>', html)
		self.assertIn("<strong>bold</strong>", html)
		self.assertIn("<li>List item 1</li>", html)

	def test_callout_mixed_with_regular_content(self):
		"""Test callout mixed with regular markdown"""
		md = """# Introduction

This is some intro text.

:::note
Important note here
:::

And this is the conclusion.
"""
		html = render_markdown(md)
		self.assertIn('<h1 id="introduction">Introduction</h1>', html)
		self.assertIn("callout-note", html)
		self.assertIn("Important note here", html)
		self.assertIn("conclusion", html)

	def test_markdown_toc_for_security_faq(self):
		"""Test TOC extraction for security FAQ markdown content."""
		md = """## Infrastructure & Hosting

### What uptime guarantee do you provide?

We provide hosting via multiple cloud providers with the following uptime guarantees:

| Provider      | Uptime Guarantee                                                                                                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AWS           | [99.0 - 99.5%](https://aws.amazon.com/compute/sla/?did=sla_card&trk=sla_card)                                                                                                                                              |
| Digital Ocean | [99.99%](https://www.digitalocean.com/sla/cpu-droplets)                                                                                                                                                                    |
| OCI           | [99.9%](https://www.oracle.com/content/published/api/v1.1/assets/CONT95B931480DF242229DF530A64F0D0245/native/Oracle+PaaS+and+IaaS+Public+Cloud+Services+Pillar+Document.pdf?channelToken=117bec9b3b4e4e90a1c4c9069d210baf) |

We monitor uptime of each server and notify users via email if their server is consistently down. Engineers are notified via call for extended downtime.

### Do you have maintenance windows?

No specific maintenance window policy is in place due to varying activity types. We inform users beforehand via email about potential downtime during maintenance activities.

### Is EBS volume/storage encrypted?

No, EBS volumes/storage attached to Frappe Cloud instances are not encrypted.

## Network Security & Access Control

### How is network security implemented?

We use a combination of security groups and firewalls to secure networks. VPCs isolate resources and restrict access. Only necessary ports are open to the public internet; all other ports are blocked by default.

### How do you manage server access?

We use SSH with certificates and/or public keys for server access. Passwords are not used. Users can only access benches with SSH certificates.

### Is there a WAF protecting applications?

Our infrastructure relies on AWS security groups for basic firewall functionality. There is no dedicated WAF solution.

### Is there an IPS/IDS solution in place?

No, there is no Intrusion Prevention/Detection System currently implemented.

### What DDoS mitigation measures are in place?

We do not have specific DDoS mitigation measures in place currently.

## Data Protection & Encryption

### What database is used? (RDS, Aurora, etc.)

We use MariaDB as the database for Frappe Cloud instances. We manage the database directly on the server on an AWS EC2 instance, not using services like RDS or Aurora.

### Is there High Availability for databases?

There is no High Availability setup for databases by default. We allow [dedicated server](https://docs.frappe.io/cloud/servers/servers-introduction) users to set up their own replication on request basis. You can raise a ticket for the same on our [support portal](https://support.frappe.io).

### Is there automated failover for databases?

No, there is no automated failover for databases on Frappe Cloud.

### What is the RPO and RTO for databases?

The RPO (Recovery Point Objective) for databases is up to 24 hours, as backups are taken daily. The RTO (Recovery Time Objective) can vary based on the size of the database and the time taken to restore from backups, typically ranging from a few hours to several hours. It is noted to be under 15 mintues as per our drills.

### Is point-in-time recovery available?

No, point-in-time recovery is not available for databases on Frappe Cloud.

### What encryption is used for communication?

We use HTTPS for all internet communication. SSH connections are also encrypted.

### Are databases encrypted at rest?

No, MariaDB databases are not encrypted at rest.

### Are backups encrypted?

Backups are unencrypted by default. Users can enable encryption by following our [backup encryption documentation](https://docs.frappe.io/framework/user/en/guides/basics/how-to-enable-backup-encryption). This uses fernet encryption (AES + HMAC).

## Security Monitoring & Management

### What antimalware software is used?

We use ClamAV for antimalware protection on all servers. Virus definitions are updated manually as needed. Regular scans are not implemented to maintain performance.

### Is there an EDR solution monitoring servers?

No, there is no Endpoint Detection and Response solution currently implemented.

### Are containers scanned for vulnerabilities?

No, containers are not scanned for malware or vulnerabilities.

### Do you use multi-factor authentication?

Yes, we have 2FA enabled for all logins to third-party services.

## Patch Management & Updates

### How are OS security patches managed?

We use unattended upgrades to deploy patches automatically on a daily basis across all servers.

### How are Frappe Framework updates handled?

On shared benches, Frappe Framework updates are managed by the Frappe Cloud team, typically occurring weekly or with major updates. Private bench users can manage updates themselves. See [bench documentation](https://docs.frappe.io/cloud/benches) for details.

### How are MariaDB updates managed?

MariaDB security updates are handled via Ubuntu's unattended-upgrades system.

### How are Python and dependency updates managed?

Python and other dependencies are managed via benches. Users can manage them through `Bench `> `Dependencies`.

### Do you have a formal patch management policy?

Yes, we have a comprehensive patch management process that covers implementation and tracking of ongoing patch compliance for all systems within our IT scope.

**Process Triggers:**

- Ongoing patch updating process
- Vulnerability assessment results
- Vulnerability alerts from vendors/OEM/security forums

**Server Patch Deployment Process:**

- Critical security patches applied automatically via Ubuntu's unattended upgrades
- Previous backups or application utilities used for system rollback when needed

### Where can I check for recent security patches?

You can check security advisories on relevant GitHub repositories:

- Frappe Framework: [Security Board](https://github.com/frappe/frappe/security/advisories)
- Frappe Cloud: [Security Board](https://github.com/frappe/press/security/advisories)

## Version Information

### How can I check current Frappe version?

You can check the current Frappe version by going to `Bench `> `Apps`.

### How can I check current MariaDB version?

You can check the current MariaDB version by going to `Server` > `Actions `> `View Database Configuration`.

### How can I check current Python version?

You can check the current Python version by going to `Bench `> `Dependencies`.

## Backup & Disaster Recovery

### What backup policy do you follow?

We take logical site backups as per our [backup policy](https://frappecloud.com/docs/sites/backups). Server-wide snapshots (including data volume) are taken daily, and are retained for 2 days.

### What disaster recovery measures are in place?

We maintain server-wide multi-AZ snapshots taken daily. In case of disaster, we plan to restore from these snapshots.

> **Note:** For KSA, backups are not multi-AZ yet. We intend to improve this in the future. [Reference](https://docs.oracle.com/en-us/iaas/Content/Block/Concepts/blockvolumebackups.htm#Copying)

## Compliance & Certifications

### What certifications do you have?

Yes, we are certified under ISO 9001:2015, ISO 27001:2022, and SOC-2 Type-2 standards. Check [our compliance page](https://frappe.io/quality-and-information-security) for more information.

### Do you conduct penetration testing?

Yes, the Frappe Cloud platform undergone formal third-party penetration testing within the last 12-18 months.

### Do you conduct vulnerability scans?

Yes, we conduct regular internal and external vulnerability scans on our cloud infrastructure as part of our ongoing vulnerability management program.
"""

		_, toc_headings = render_markdown_with_toc(md)

		expected_texts = [
			"Infrastructure & Hosting",
			"What uptime guarantee do you provide?",
			"Do you have maintenance windows?",
			"Is EBS volume/storage encrypted?",
			"Network Security & Access Control",
			"How is network security implemented?",
			"How do you manage server access?",
			"Is there a WAF protecting applications?",
			"Is there an IPS/IDS solution in place?",
			"What DDoS mitigation measures are in place?",
			"Data Protection & Encryption",
			"What database is used? (RDS, Aurora, etc.)",
			"Is there High Availability for databases?",
			"Is there automated failover for databases?",
			"What is the RPO and RTO for databases?",
			"Is point-in-time recovery available?",
			"What encryption is used for communication?",
			"Are databases encrypted at rest?",
			"Are backups encrypted?",
			"Security Monitoring & Management",
			"What antimalware software is used?",
			"Is there an EDR solution monitoring servers?",
			"Are containers scanned for vulnerabilities?",
			"Do you use multi-factor authentication?",
			"Patch Management & Updates",
			"How are OS security patches managed?",
			"How are Frappe Framework updates handled?",
			"How are MariaDB updates managed?",
			"How are Python and dependency updates managed?",
			"Do you have a formal patch management policy?",
			"Where can I check for recent security patches?",
			"Version Information",
			"How can I check current Frappe version?",
			"How can I check current MariaDB version?",
			"How can I check current Python version?",
			"Backup & Disaster Recovery",
			"What backup policy do you follow?",
			"What disaster recovery measures are in place?",
			"Compliance & Certifications",
			"What certifications do you have?",
			"Do you conduct penetration testing?",
			"Do you conduct vulnerability scans?",
		]

		self.assertEqual([heading["text"] for heading in toc_headings], expected_texts)

		h2_headings = {
			"Infrastructure & Hosting",
			"Network Security & Access Control",
			"Data Protection & Encryption",
			"Security Monitoring & Management",
			"Patch Management & Updates",
			"Version Information",
			"Backup & Disaster Recovery",
			"Compliance & Certifications",
		}
		for heading in toc_headings:
			expected_level = 2 if heading["text"] in h2_headings else 3
			self.assertEqual(heading["level"], expected_level)

		ids = [heading["id"] for heading in toc_headings]
		self.assertTrue(all(ids))
		self.assertEqual(len(ids), len(set(ids)))


class TestProcessNavbarItems(unittest.TestCase):
	"""
	Unit tests for the process_navbar_items function.
	Tests icon detection for known services and navbar item processing.
	"""

	def _make_navbar_item(self, label, url, open_in_new_tab=False, right=False):
		"""Helper to create a mock navbar item (mimics Top Bar Item)."""
		return SimpleNamespace(
			label=label,
			url=url,
			open_in_new_tab=open_in_new_tab,
			right=right,
		)

	def test_github_url_detected(self):
		"""Test that GitHub URLs are detected and assigned the github icon."""
		items = [self._make_navbar_item("GitHub", "https://github.com/frappe/wiki")]
		result = process_navbar_items(items)

		self.assertEqual(len(result), 1)
		self.assertEqual(result[0]["icon"], "github")
		self.assertEqual(result[0]["label"], "GitHub")
		self.assertEqual(result[0]["url"], "https://github.com/frappe/wiki")

	def test_github_with_www_prefix(self):
		"""Test that www.github.com URLs are also detected."""
		items = [self._make_navbar_item("GitHub", "https://www.github.com/frappe")]
		result = process_navbar_items(items)

		self.assertEqual(result[0]["icon"], "github")

	def test_youtube_url_detected(self):
		"""Test that YouTube URLs are detected."""
		items = [self._make_navbar_item("YouTube", "https://youtube.com/channel/xyz")]
		result = process_navbar_items(items)

		self.assertEqual(result[0]["icon"], "youtube")

	def test_twitter_url_detected(self):
		"""Test that Twitter URLs are detected."""
		items = [self._make_navbar_item("Twitter", "https://twitter.com/fraaboride")]
		result = process_navbar_items(items)

		self.assertEqual(result[0]["icon"], "twitter")

	def test_x_com_maps_to_twitter(self):
		"""Test that x.com URLs are mapped to twitter icon."""
		items = [self._make_navbar_item("X", "https://x.com/frappeframework")]
		result = process_navbar_items(items)

		self.assertEqual(result[0]["icon"], "twitter")

	def test_discord_url_detected(self):
		"""Test that Discord URLs are detected."""
		items = [self._make_navbar_item("Discord", "https://discord.com/invite/abc")]
		result = process_navbar_items(items)

		self.assertEqual(result[0]["icon"], "discord")

	def test_discord_gg_url_detected(self):
		"""Test that discord.gg invite URLs are detected."""
		items = [self._make_navbar_item("Join Discord", "https://discord.gg/abc123")]
		result = process_navbar_items(items)

		self.assertEqual(result[0]["icon"], "discord")

	def test_linkedin_url_detected(self):
		"""Test that LinkedIn URLs are detected."""
		items = [self._make_navbar_item("LinkedIn", "https://linkedin.com/company/frappe")]
		result = process_navbar_items(items)

		self.assertEqual(result[0]["icon"], "linkedin")

	def test_slack_url_detected(self):
		"""Test that Slack URLs are detected."""
		items = [self._make_navbar_item("Slack", "https://slack.com/workspace")]
		result = process_navbar_items(items)

		self.assertEqual(result[0]["icon"], "slack")

	def test_facebook_url_detected(self):
		"""Test that Facebook URLs are detected."""
		items = [self._make_navbar_item("Facebook", "https://facebook.com/frappe")]
		result = process_navbar_items(items)

		self.assertEqual(result[0]["icon"], "facebook")

	def test_instagram_url_detected(self):
		"""Test that Instagram URLs are detected."""
		items = [self._make_navbar_item("Instagram", "https://instagram.com/frappe")]
		result = process_navbar_items(items)

		self.assertEqual(result[0]["icon"], "instagram")

	def test_reddit_url_detected(self):
		"""Test that Reddit URLs are detected."""
		items = [self._make_navbar_item("Reddit", "https://reddit.com/r/erpnext")]
		result = process_navbar_items(items)

		self.assertEqual(result[0]["icon"], "reddit")

	def test_unknown_url_has_no_icon(self):
		"""Test that unknown/custom URLs have no icon assigned."""
		items = [self._make_navbar_item("Custom Link", "https://example.com")]
		result = process_navbar_items(items)

		self.assertIsNone(result[0]["icon"])
		self.assertEqual(result[0]["label"], "Custom Link")

	def test_empty_url_has_no_icon(self):
		"""Test that items with empty URL have no icon."""
		items = [self._make_navbar_item("Empty", "")]
		result = process_navbar_items(items)

		self.assertIsNone(result[0]["icon"])

	def test_none_url_has_no_icon(self):
		"""Test that items with None URL have no icon."""
		items = [self._make_navbar_item("None URL", None)]
		result = process_navbar_items(items)

		self.assertIsNone(result[0]["icon"])

	def test_preserves_open_in_new_tab(self):
		"""Test that open_in_new_tab flag is preserved."""
		items = [self._make_navbar_item("Link", "https://example.com", open_in_new_tab=True)]
		result = process_navbar_items(items)

		self.assertTrue(result[0]["open_in_new_tab"])

	def test_preserves_right_alignment(self):
		"""Test that right alignment flag is preserved."""
		items = [self._make_navbar_item("Link", "https://example.com", right=True)]
		result = process_navbar_items(items)

		self.assertTrue(result[0]["right"])

	def test_multiple_items_processed(self):
		"""Test that multiple items are all processed correctly."""
		items = [
			self._make_navbar_item("GitHub", "https://github.com/frappe"),
			self._make_navbar_item("Docs", "https://docs.frappe.io"),
			self._make_navbar_item("Discord", "https://discord.gg/frappe"),
		]
		result = process_navbar_items(items)

		self.assertEqual(len(result), 3)
		self.assertEqual(result[0]["icon"], "github")
		self.assertIsNone(result[1]["icon"])  # docs.frappe.io is not a known service
		self.assertEqual(result[2]["icon"], "discord")

	def test_empty_list(self):
		"""Test that empty list returns empty list."""
		result = process_navbar_items([])

		self.assertEqual(result, [])

	def test_subdomain_not_matched(self):
		"""Test that subdomains like api.github.com are still matched."""
		items = [self._make_navbar_item("API", "https://api.github.com/repos")]
		result = process_navbar_items(items)

		# api.github.com contains github.com so it should match
		self.assertEqual(result[0]["icon"], "github")

	def test_url_with_path_matched(self):
		"""Test that URLs with paths are correctly matched."""
		items = [
			self._make_navbar_item("Repo", "https://github.com/frappe/wiki/issues"),
			self._make_navbar_item("Video", "https://youtube.com/watch?v=abc123"),
		]
		result = process_navbar_items(items)

		self.assertEqual(result[0]["icon"], "github")
		self.assertEqual(result[1]["icon"], "youtube")


class TestSetRoute(IntegrationTestCase):
	"""
	Unit tests for the set_route method of WikiDocument.
	Tests route generation for nested documents to prevent path duplication.
	"""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.test_docs = []
		cls.test_spaces = []

	def tearDown(self):
		# Clean up test documents (in reverse order to handle parent-child dependencies)
		for doc_name in reversed(self.test_docs):
			if frappe.db.exists("Wiki Document", doc_name):
				frappe.delete_doc("Wiki Document", doc_name, force=True)
		self.test_docs = []

		# Clean up test spaces
		for space_name in self.test_spaces:
			if frappe.db.exists("Wiki Space", space_name):
				frappe.delete_doc("Wiki Space", space_name, force=True)
		self.test_spaces = []

	def _create_wiki_document(self, title, parent=None, is_group=False, slug=None):
		"""Helper to create a wiki document for testing."""
		doc = frappe.get_doc(
			{
				"doctype": "Wiki Document",
				"title": title,
				"parent_wiki_document": parent,
				"is_group": is_group,
				"slug": slug,
				"content": f"Content for {title}",
			}
		)
		doc.insert(ignore_permissions=True)
		self.test_docs.append(doc.name)
		return doc

	def _create_wiki_space(self, space_name, route, root_group):
		"""Helper to create a wiki space for testing."""
		doc = frappe.get_doc(
			{
				"doctype": "Wiki Space",
				"space_name": space_name,
				"route": route,
				"root_group": root_group,
			}
		)
		doc.insert(ignore_permissions=True)
		self.test_spaces.append(doc.name)
		# Track auto-created root_group for cleanup
		if not root_group and doc.root_group:
			self.test_docs.append(doc.root_group)
		return doc

	def test_nested_document_route_no_duplication(self):
		"""
		Test that deeply nested documents generate correct routes without path duplication.

		This is a regression test for a bug where routes were being generated as:
		documentation/documentation/doctypes/documentation/doctypes/submittable/workflows
		instead of:
		documentation/doctypes/submittable/workflows

		The bug occurred because set_route() was appending full ancestor routes
		(which already included the space prefix) instead of just ancestor slugs.
		"""
		# Create wiki space first (this auto-creates a root_group)
		space = self._create_wiki_space("Documentation Space", "documentation", None)
		root_group_name = space.root_group

		# Create the document hierarchy under the space's root_group: Root -> DocTypes -> Submittable -> Workflows
		doctypes = self._create_wiki_document(
			"DocTypes", parent=root_group_name, is_group=True, slug="doctypes"
		)
		submittable = self._create_wiki_document(
			"Submittable", parent=doctypes.name, is_group=True, slug="submittable"
		)
		workflows = self._create_wiki_document("Workflows", parent=submittable.name, slug="workflows")

		# Verify routes are correct without duplication
		self.assertEqual(doctypes.route, "documentation/doctypes")
		self.assertEqual(submittable.route, "documentation/doctypes/submittable")
		self.assertEqual(workflows.route, "documentation/doctypes/submittable/workflows")

		# Verify no path segment appears more than once (except as part of different segments)
		self.assertNotIn("documentation/documentation", workflows.route)
		self.assertNotIn("doctypes/doctypes", workflows.route)

	def test_route_regeneration_on_existing_document(self):
		"""
		Test that clearing and regenerating a route on an existing document
		produces the correct path without duplication.

		This specifically tests the code path where is_new() returns False
		and get_ancestors() is used instead of traversing parent_wiki_document.
		"""
		# Create wiki space first (this auto-creates a root_group)
		space = self._create_wiki_space("Regen Test Space", "regen-space", None)
		root_group_name = space.root_group

		# Create the document hierarchy under the space's root_group
		parent_folder = self._create_wiki_document(
			"Parent Folder", parent=root_group_name, is_group=True, slug="parent"
		)
		child_doc = self._create_wiki_document("Child Doc", parent=parent_folder.name, slug="child")

		# Verify initial route is correct
		self.assertEqual(child_doc.route, "regen-space/parent/child")

		# Clear route and save to trigger regeneration
		child_doc.route = None
		child_doc.save()

		# Reload and verify route is still correct
		child_doc.reload()
		self.assertEqual(child_doc.route, "regen-space/parent/child")

	def test_single_level_nesting_route(self):
		"""Test route generation for a document one level deep."""
		# Create wiki space first (this auto-creates a root_group)
		space = self._create_wiki_space("Single Level Space", "single", None)
		root_group_name = space.root_group

		# Create child document under the space's root_group
		child = self._create_wiki_document("Child Page", parent=root_group_name, slug="child-page")

		self.assertEqual(child.route, "single/child-page")
