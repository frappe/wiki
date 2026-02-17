# Copyright (c) 2025, Frappe and Contributors
# See license.txt

"""
Performance benchmark for wiki reorder operations.

NOT part of the regular test suite — run manually:

    bench --site <site> run-tests --app wiki --module wiki.benchmarks.bench_reorder
"""

import json
import time

import frappe
from frappe.tests.utils import FrappeTestCase

from wiki.test_api import create_test_wiki_space, create_wiki_document


class TestReorderPerformance(FrappeTestCase):
	"""Performance test for reorder with a large wiki tree (80 groups, ~800 pages)."""

	def setUp(self):
		frappe.set_user("Administrator")

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.rollback()

	def test_reorder_performance_large_tree(self):
		"""Create 80 groups (up to 3 levels deep), ~800 pages, reorder, and measure time."""
		from wiki.api.wiki_space import reorder_wiki_documents

		space = create_test_wiki_space()
		root = space.root_group

		all_groups = []
		all_pages = []
		page_count = 0

		# Level 1: 20 groups directly under root
		level1_groups = []
		for i in range(20):
			g = create_wiki_document(root, f"L1 Group {i}", is_group=True)
			level1_groups.append(g)
			all_groups.append(g)

		# Level 2: 2 sub-groups under each L1 group (20 * 2 = 40)
		level2_groups = []
		for g1 in level1_groups:
			for j in range(2):
				g = create_wiki_document(g1.name, f"L2 Group {g1.name[-6:]}-{j}", is_group=True)
				level2_groups.append(g)
				all_groups.append(g)

		# Level 3: 1 sub-group under each L2 group (40 * 1 = 40, but cap at 20 to hit 80 total)
		level3_groups = []
		for g2 in level2_groups[:20]:
			g = create_wiki_document(g2.name, f"L3 Group {g2.name[-6:]}", is_group=True)
			level3_groups.append(g)
			all_groups.append(g)

		# Total groups: 20 + 40 + 20 = 80
		self.assertEqual(len(all_groups), 80)

		# Distribute ~800 pages across all groups (10 per group)
		for group in all_groups:
			for _k in range(10):
				p = create_wiki_document(group.name, f"Page {page_count}", content=f"Content {page_count}")
				all_pages.append(p)
				page_count += 1

		self.assertEqual(len(all_pages), 800)
		frappe.db.commit()  # nosemgrep

		# Pick a group with 10 children and reverse their order
		target_group = level1_groups[0]
		children = frappe.get_all(
			"Wiki Document",
			filters={"parent_wiki_document": target_group.name, "is_group": 0},
			fields=["name"],
			order_by="sort_order asc, name asc",
		)
		siblings_reversed = [c["name"] for c in reversed(children)]

		start = time.monotonic()
		reorder_wiki_documents(
			doc_name=siblings_reversed[0],
			new_parent=target_group.name,
			new_index=0,
			siblings=json.dumps(siblings_reversed),
		)
		elapsed = time.monotonic() - start

		# Verify the reorder actually took effect
		children_after = frappe.get_all(
			"Wiki Document",
			filters={"parent_wiki_document": target_group.name, "is_group": 0},
			fields=["name", "sort_order"],
			order_by="sort_order asc",
		)
		names_after = [c["name"] for c in children_after]
		self.assertEqual(names_after, siblings_reversed)

		print(f"\n[PERF] Reorder within same parent (800 pages, 80 groups): {elapsed:.3f}s")

		# Fail if unreasonably slow (> 30s is a red flag)
		self.assertLess(elapsed, 30, f"Reorder took {elapsed:.3f}s which exceeds 30s threshold")
