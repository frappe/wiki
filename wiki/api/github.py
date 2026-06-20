# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

"""GitHub App auth plumbing for one-way git sync.

A GitHub App (configured once in `Wiki Settings`) lets a Wiki Space pull from
GitHub — including *private* repos — without storing long-lived per-space
secrets: we sign a short JWT with the App private key, exchange it for a
**short-lived installation access token** on demand, and discard the token
after the sync run.

HTTP goes through the module-level `requests` import so tests can redirect it.
`installations`/`repositories` take an explicit user OAuth token (the
connect-account flow that sources it lands in TB4b); `installation_access_token`
uses the App JWT and is what the sync engine will call server-side.
"""

from __future__ import annotations

import time
from typing import Any

import frappe
import jwt
import requests
from frappe import _

GITHUB_API = "https://api.github.com"
API_VERSION = "2022-11-28"

# GitHub caps an App JWT's lifetime at 10 minutes; stay just under it and give
# 60s of clock-skew leeway on the issued-at claim.
_JWT_TTL = 9 * 60
_JWT_LEEWAY = 60


def _settings():
	return frappe.get_cached_doc("Wiki Settings")


def _app_jwt() -> str:
	"""Sign a short-lived RS256 JWT proving we are the configured GitHub App."""
	settings = _settings()
	app_id = settings.github_app_id
	private_key = settings.get_password("github_app_private_key", raise_exception=False)
	if not app_id or not private_key:
		frappe.throw(_("GitHub App is not configured in Wiki Settings."))

	now = int(time.time())
	payload = {"iat": now - _JWT_LEEWAY, "exp": now + _JWT_TTL, "iss": str(app_id)}
	return jwt.encode(payload, private_key, algorithm="RS256")


def _headers(token: str) -> dict[str, str]:
	return {
		"Accept": "application/vnd.github+json",
		"X-GitHub-Api-Version": API_VERSION,
		"Authorization": f"Bearer {token}",
	}


def installation_access_token(installation_id: str | int) -> str:
	"""Mint a short-lived installation access token (never stored).

	This is the token the sync engine passes to every REST call so private
	repos resolve; it expires within the hour, so we mint a fresh one per run.
	"""
	resp = requests.post(
		f"{GITHUB_API}/app/installations/{installation_id}/access_tokens",
		headers=_headers(_app_jwt()),
		timeout=30,
	)
	resp.raise_for_status()
	return resp.json()["token"]


def installations(token: str) -> list[dict[str, Any]]:
	"""List the App installations the connecting user can access."""
	resp = requests.get(
		f"{GITHUB_API}/user/installations?per_page=100",
		headers=_headers(token),
		timeout=30,
	)
	resp.raise_for_status()
	result = []
	for inst in resp.json().get("installations", []):
		account = inst.get("account") or {}
		result.append(
			{
				"id": inst.get("id"),
				"account": account.get("login"),
				"account_type": account.get("type"),
				"avatar_url": account.get("avatar_url"),
			}
		)
	return result


def repositories(installation_id: str | int, token: str) -> list[dict[str, Any]]:
	"""List repos the user can access through a given installation (paginated)."""
	result = []
	page = 1
	while True:
		resp = requests.get(
			f"{GITHUB_API}/user/installations/{installation_id}/repositories" f"?per_page=100&page={page}",
			headers=_headers(token),
			timeout=30,
		)
		resp.raise_for_status()
		batch = resp.json().get("repositories", [])
		for repo in batch:
			result.append(
				{
					"full_name": repo.get("full_name"),
					"private": repo.get("private"),
					"default_branch": repo.get("default_branch"),
				}
			)
		if len(batch) < 100:
			break
		page += 1
	return result
