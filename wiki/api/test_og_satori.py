# Copyright (c) 2026, Frappe and Contributors
# See license.txt

import base64
import io
import subprocess
import unittest
from unittest.mock import patch

import frappe
from PIL import Image

from wiki.api import og_image, og_satori
from wiki.tests import WikiTestCase as IntegrationTestCase
from wiki.utils import lucide_svg


def card_context(**overrides):
	return {
		"title": "Install & <configure>",
		"title_font_size": 76,
		"breadcrumb_trail": "Guides / Setup",
		"space_name": "Handbook",
		"logo_url": "",
		"avatar_url": "",
		"icon_svg": "",
		"mark_color": "",
		**overrides,
	}


def decode_data_uri(uri):
	header, _, payload = uri.partition(",")
	return header, base64.b64decode(payload)


def find_images(node):
	if node["type"] == "img":
		return [node]
	children = node["props"]["children"]
	if not isinstance(children, list):
		return []
	return [image for child in children for image in find_images(child)]


class TestCardRenderer(unittest.TestCase):
	def test_prefers_chromium_then_satori(self):
		with patch.object(og_satori, "available", return_value=True):
			with patch.object(og_image, "get_preview_from_html", object()):
				self.assertEqual(og_image.card_renderer(), "chromium")
			with patch.object(og_image, "get_preview_from_html", None):
				self.assertEqual(og_image.card_renderer(), "satori")

	def test_no_renderer_turns_cards_off(self):
		with (
			patch.object(og_satori, "available", return_value=False),
			patch.object(og_image, "get_preview_from_html", None),
		):
			self.assertIsNone(og_image.card_renderer())
			self.assertFalse(og_image.cards_supported())

	def test_renderer_is_part_of_the_fingerprint(self):
		ctx = card_context()
		with patch.object(og_image, "card_renderer", return_value="satori"):
			satori_fingerprint = og_image.og_fingerprint(ctx)
		with patch.object(og_image, "card_renderer", return_value="chromium"):
			self.assertNotEqual(og_image.og_fingerprint(ctx), satori_fingerprint)


class TestSatoriCard(IntegrationTestCase):
	def test_text_goes_in_verbatim(self):
		tree = og_satori.card_tree(card_context(), 1200, 630)
		_mark, main, footer = tree["props"]["children"]
		breadcrumb, title = main["props"]["children"]

		self.assertEqual(title["props"]["children"], "Install & <configure>")
		self.assertEqual(breadcrumb["props"]["children"], "Guides / Setup")
		self.assertEqual(footer["props"]["children"], "Handbook")

	def test_icon_carries_its_colour(self):
		ctx = card_context(icon_svg=lucide_svg("lucide-book", "og-glyph"), mark_color="green")
		[glyph] = find_images(og_satori.card_tree(ctx, 1200, 630))
		header, svg = decode_data_uri(glyph["props"]["src"])

		self.assertEqual(header, "data:image/svg+xml;base64")
		self.assertIn(f'stroke="{og_satori.COLORS["ink-green-7"]}"', svg.decode())
		self.assertIn('xmlns="http://www.w3.org/2000/svg"', svg.decode())
		self.assertNotIn("currentColor", svg.decode())

	def test_generated_avatar_is_base64_encoded(self):
		avatar = "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E"
		[image] = find_images(og_satori.card_tree(card_context(avatar_url=avatar), 1200, 630))

		header, svg = decode_data_uri(image["props"]["src"])
		self.assertEqual(header, "data:image/svg+xml;base64")
		self.assertEqual(svg, b'<svg xmlns="http://www.w3.org/2000/svg"></svg>')

	def test_webp_logo_is_converted_to_png(self):
		buffer = io.BytesIO()
		Image.new("RGB", (200, 100), "blue").save(buffer, format="WEBP")
		file = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"og-logo-{frappe.generate_hash(length=6)}.webp",
				"content": buffer.getvalue(),
				"is_private": 0,
			}
		).insert(ignore_permissions=True)

		[image] = find_images(og_satori.card_tree(card_context(logo_url=file.file_url), 1200, 630))

		header, png = decode_data_uri(image["props"]["src"])
		self.assertEqual(header, "data:image/png;base64")
		self.assertEqual(Image.open(io.BytesIO(png)).format, "PNG")
		self.assertEqual(
			(image["props"]["width"], image["props"]["height"]),
			(og_satori.MARK_SIZE * 2, og_satori.MARK_SIZE),
		)

	def test_svg_logo_keeps_its_aspect_ratio(self):
		file = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"og-logo-{frappe.generate_hash(length=6)}.svg",
				"content": b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"></svg>',
				"is_private": 0,
			}
		).insert(ignore_permissions=True)

		[image] = find_images(og_satori.card_tree(card_context(logo_url=file.file_url), 1200, 630))

		self.assertTrue(image["props"]["src"].startswith("data:image/svg+xml;base64,"))
		self.assertEqual(image["props"]["width"], og_satori.MARK_SIZE * 3)

	def test_unreadable_logo_is_left_out(self):
		file = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"og-logo-{frappe.generate_hash(length=6)}.png",
				"content": b"not an image",
				"is_private": 0,
			}
		).insert(ignore_permissions=True)

		self.assertEqual(
			find_images(og_satori.card_tree(card_context(logo_url=file.file_url), 1200, 630)), []
		)

	def test_asset_paths_cannot_leave_the_assets_directory(self):
		self.assertIsNone(og_satori._read_asset("/assets/../site_config.json"))
		self.assertIsNone(og_satori._read_asset("/assets/wiki/../../../../etc/passwd"))
		self.assertTrue(og_satori._read_asset("/assets/wiki/images/wiki-logo.png"))

	def test_node_failure_is_a_failed_card(self):
		failures = (
			subprocess.CompletedProcess([], 1, b"", b"boom"),
			subprocess.TimeoutExpired("node", og_satori.RENDER_TIMEOUT),
		)
		for failure in failures:
			doc_key = frappe.generate_hash(length=10)
			run = {"side_effect": failure} if isinstance(failure, Exception) else {"return_value": failure}
			with (
				self.subTest(failure=type(failure).__name__),
				patch.object(og_image, "card_renderer", return_value="satori"),
				patch.object(og_satori.subprocess, "run", **run),
				patch.object(og_image, "_write_cached") as write,
				patch.object(frappe, "log_error"),
			):
				with self.assertRaises(og_image.CardFailed):
					og_image._generate_and_store(
						doc_key, card_context(), "fp", "/tmp/card.jpg", trigger="request"
					)
				write.assert_not_called()

	def test_renders_a_card_sized_jpeg(self):
		if not og_satori.available():
			raise unittest.SkipTest("Node or the satori packages are not installed")

		ctx = card_context(icon_svg=lucide_svg("lucide-book", "og-glyph"), mark_color="blue")
		image = Image.open(io.BytesIO(og_satori.render_jpeg(ctx, og_image.OG_WIDTH, og_image.OG_HEIGHT)))

		self.assertEqual(image.format, "JPEG")
		self.assertEqual(image.size, (og_image.OG_WIDTH, og_image.OG_HEIGHT))
