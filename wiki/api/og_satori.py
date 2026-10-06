# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

"""OG card renderer for sites without ``frappe.utils.preview`` (Frappe v15).

The same card as the Chromium path, drawn by satori (element tree to SVG) and
resvg (SVG to PNG) in a short Node script. satori cannot parse oklch() and never
fetches anything, so the card carries hex colours and every image goes in as a
``data:`` URI built here.
"""

import base64
import io
import json
import os
import re
import shutil
import subprocess
from functools import lru_cache
from urllib.parse import unquote

import frappe
from PIL import Image

NODE_PACKAGES = ("satori", os.path.join("@resvg", "resvg-js"))

RENDER_TIMEOUT = 30

MARK_SIZE = 132
GLYPH_SIZE = 76
LOGO_MAX_WIDTH = 520

# The light-mode frappe-ui tokens the Chromium template declares as oklch(),
# in hex because satori cannot parse oklch(). The token drift test converts
# frappe-ui's values and compares them with these.
COLORS = {
	"ink-gray-9": "#0f0f0f",
	"ink-gray-7": "#383838",
	"ink-gray-5": "#7c7c7c",
	"surface-gray-2": "#f3f3f3",
	"surface-base": "#ffffff",
	"surface-blue-2": "#e6f4ff",
	"ink-blue-7": "#0475d3",
	"surface-green-2": "#e4faeb",
	"ink-green-7": "#14804d",
	"surface-amber-2": "#fff4d3",
	"ink-amber-7": "#bb6f0a",
	"surface-red-2": "#ffe7e7",
	"ink-red-7": "#b41d1d",
	"surface-violet-2": "#eee8ff",
	"ink-violet-7": "#4f3da1",
}

FONTS = (("Inter-SemiBold.woff", 600), ("Inter-Medium.woff", 500))

SVG_SIZE_PATTERN = re.compile(r'viewBox="[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)"')


@lru_cache(maxsize=1)
def available() -> bool:
	"""Node on PATH and the satori packages installed beside the app."""
	if not shutil.which("node"):
		return False
	node_modules = os.path.join(_app_root(), "node_modules")
	return all(os.path.exists(os.path.join(node_modules, name, "package.json")) for name in NODE_PACKAGES)


def render_jpeg(ctx: dict, width: int, height: int) -> bytes:
	payload = {
		"tree": card_tree(ctx, width, height),
		"width": width,
		"height": height,
		"fonts": [
			{"name": "Inter", "weight": weight, "path": frappe.get_app_path("wiki", "public", "fonts", name)}
			for name, weight in FONTS
		],
	}
	result = subprocess.run(
		[shutil.which("node"), frappe.get_app_path("wiki", "og", "og_satori.mjs")],
		input=json.dumps(payload).encode(),
		capture_output=True,
		timeout=RENDER_TIMEOUT,
	)
	if result.returncode:
		raise RuntimeError(result.stderr.decode(errors="replace"))
	return _png_to_jpeg(result.stdout)


def card_tree(ctx: dict, width: int, height: int) -> dict:
	"""The og_image.html layout as satori's element tree.

	A tree rather than HTML: text goes in as plain data, so there is nothing to
	escape and no markup a page title could inject.
	"""
	main = []
	if ctx["breadcrumb_trail"]:
		main.append(
			_element(
				"div",
				{
					"display": "block",
					"fontSize": 32,
					"fontWeight": 600,
					"letterSpacing": 0.32,
					"color": COLORS["ink-gray-5"],
					"marginBottom": 20,
					"whiteSpace": "nowrap",
					"overflow": "hidden",
					"textOverflow": "ellipsis",
				},
				ctx["breadcrumb_trail"],
			)
		)
	main.append(
		_element(
			"div",
			{
				"display": "block",
				"fontSize": ctx["title_font_size"],
				"fontWeight": 600,
				"lineHeight": 1.15,
				"color": COLORS["ink-gray-9"],
				"lineClamp": 3,
			},
			ctx["title"],
		)
	)

	return _element(
		"div",
		{
			"width": width,
			"height": height,
			"padding": 72,
			"display": "flex",
			"flexDirection": "column",
			"justifyContent": "space-between",
			"backgroundColor": COLORS["surface-base"],
			"fontFamily": "Inter",
		},
		[
			_element("div", {"display": "flex"}, _mark(ctx)),
			_element("div", {"display": "flex", "flexDirection": "column"}, main),
			_element(
				"div",
				{
					"display": "flex",
					"fontSize": 28,
					"fontWeight": 500,
					"letterSpacing": 0.28,
					"color": COLORS["ink-gray-7"],
				},
				ctx["space_name"],
			),
		],
	)


def _mark(ctx: dict) -> list:
	logo = _logo(ctx["logo_url"])
	if logo:
		return [_image(logo["src"], logo["width"], logo["height"], {"objectFit": "contain"})]
	if ctx["avatar_url"]:
		return [_image(_base64_data_uri(ctx["avatar_url"]), MARK_SIZE, MARK_SIZE, {"borderRadius": 24})]
	if ctx["icon_svg"]:
		tile = {
			"display": "flex",
			"width": MARK_SIZE,
			"height": MARK_SIZE,
			"borderRadius": 24,
			"alignItems": "center",
			"justifyContent": "center",
			"backgroundColor": COLORS[f"surface-{ctx['mark_color']}-2"],
		}
		glyph = _image(_icon_data_uri(ctx["icon_svg"], ctx["mark_color"]), GLYPH_SIZE, GLYPH_SIZE)
		return [_element("div", tile, [glyph])]
	return []


def _element(tag: str, style: dict, children=None) -> dict:
	return {"type": tag, "props": {"style": style, "children": children}}


def _image(src: str, width: int, height: int, style: dict | None = None) -> dict:
	return {"type": "img", "props": {"src": src, "width": width, "height": height, "style": style or {}}}


def _logo(url: str) -> dict | None:
	"""The uploaded logo as a ``data:`` URI, sized like the Chromium card's
	132px-tall, at most 520px-wide box. An unreadable logo is left out, as a
	broken ``<img>`` is in Chromium, rather than failing every card in the space."""
	try:
		content = _read_asset(url)
		if not content:
			return None

		if _is_svg(content):
			size = _svg_size(content)
			src = _data_uri("image/svg+xml", content)
		else:
			# resvg drops WebP without an error, and wiki converts uploads to WebP.
			image = Image.open(io.BytesIO(content))
			size = image.size
			buffer = io.BytesIO()
			image.convert("RGBA").save(buffer, format="PNG")
			src = _data_uri("image/png", buffer.getvalue())
	except (OSError, Image.UnidentifiedImageError):
		return None

	width = min(LOGO_MAX_WIDTH, round(MARK_SIZE * size[0] / size[1]))
	return {"src": src, "width": width, "height": MARK_SIZE}


def _read_asset(url: str) -> bytes | None:
	if url.startswith("/files/"):
		name = frappe.db.get_value("File", {"file_url": url, "is_private": 0})
		if not name:
			return None
		# get_content() decodes anything that is valid UTF-8, an SVG included.
		content = frappe.get_doc("File", name).get_content()
		return content.encode() if isinstance(content, str) else content

	if url.startswith("/assets/"):
		# normpath, not realpath: sites/assets holds symlinks into each app.
		assets_dir = os.path.join(os.path.abspath(frappe.local.sites_path), "assets")
		path = os.path.normpath(os.path.join(assets_dir, url.removeprefix("/assets/")))
		if not path.startswith(assets_dir + os.sep) or not os.path.isfile(path):
			return None
		# nosemgrep: frappe-semgrep-rules.rules.security.frappe-security-file-traversal
		with open(path, "rb") as f:
			return f.read()

	return None


def _base64_data_uri(uri: str) -> str:
	"""Generated avatars are percent-encoded UTF-8, which satori's ``btoa``
	rejects."""
	header, _, payload = uri.partition(",")
	if not payload or header.endswith(";base64"):
		return uri
	return _data_uri("image/svg+xml", unquote(payload).encode())


def _icon_data_uri(icon_svg: str, color: str) -> str:
	"""The lucide glyph with its colour written in: ``currentColor`` does not
	reach into an ``<img>``."""
	if not icon_svg:
		return ""
	svg = icon_svg.replace('stroke="currentColor"', f'stroke="{COLORS[f"ink-{color}-7"]}"').replace(
		"<svg ",
		f'<svg xmlns="http://www.w3.org/2000/svg" width="{GLYPH_SIZE}" height="{GLYPH_SIZE}" ',
		1,
	)
	return _data_uri("image/svg+xml", svg.encode())


def _png_to_jpeg(png: bytes) -> bytes:
	buffer = io.BytesIO()
	Image.open(io.BytesIO(png)).convert("RGB").save(buffer, format="JPEG", quality=90)
	return buffer.getvalue()


def _is_svg(content: bytes) -> bool:
	head = content[:256].lstrip().lower()
	return head.startswith(b"<svg") or (head.startswith(b"<?xml") and b"<svg" in content[:1024].lower())


def _svg_size(content: bytes) -> tuple[float, float]:
	match = SVG_SIZE_PATTERN.search(content.decode(errors="replace"))
	if not match or not float(match[2]):
		return (1, 1)
	return (float(match[1]), float(match[2]))


def _data_uri(mime: str, content: bytes) -> str:
	return f"data:{mime};base64,{base64.b64encode(content).decode()}"


def _app_root() -> str:
	return os.path.dirname(frappe.get_app_path("wiki"))
