# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

"""GitHub App auth plumbing for one-way git sync.

A GitHub App (configured once in `Wiki Settings`) lets a Wiki Space pull from
GitHub — including *private* repos — without storing long-lived per-space
secrets: we sign a short JWT with the App private key, exchange it for a
**short-lived installation access token** on demand, and discard the token
after the sync run.

HTTP goes through the module-level `requests` import so tests can redirect it.
`installations`/`repositories` take an explicit user OAuth token; the
connect-account flow (`www/github/{authorize,redirect}.py`) sources that token
via GitHub's user-to-server OAuth, caches it per Frappe user, and the whitelisted
`my_installations`/`my_repositories` wrappers read it back for the repo picker.
`installation_access_token` uses the App JWT and is what the sync engine calls
server-side to mint a short-lived token for private repos.
"""

from __future__ import annotations

import secrets
import time
from typing import Any
from urllib.parse import urlencode

import frappe
import jwt
import requests
from frappe import _

GITHUB_API = "https://api.github.com"
API_VERSION = "2022-11-28"

OAUTH_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
OAUTH_TOKEN_URL = "https://github.com/login/oauth/access_token"

# GitHub user-to-server tokens last ~8h; the CSRF state is single-use within minutes.
_USER_TOKEN_TTL = 8 * 60 * 60
_OAUTH_STATE_TTL = 10 * 60

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


# --------------------------------------------------------------------------- #
# Connect-account OAuth (user-to-server) — sources the per-user OAuth token
# --------------------------------------------------------------------------- #
def _user_token_key(user: str) -> str:
	return f"github_user_token:{user}"


def _oauth_state_key(state: str) -> str:
	return f"github_oauth_state:{state}"


def store_user_token(user: str, token: str) -> None:
	frappe.cache().set_value(_user_token_key(user), token, expires_in_sec=_USER_TOKEN_TTL)


def get_user_token(user: str | None = None) -> str | None:
	user = user or frappe.session.user
	return frappe.cache().get_value(_user_token_key(user))


def new_oauth_state() -> str:
	"""Mint a single-use CSRF state bound to the current user."""
	state = secrets.token_urlsafe(32)
	frappe.cache().set_value(_oauth_state_key(state), frappe.session.user, expires_in_sec=_OAUTH_STATE_TTL)
	return state


def verify_oauth_state(state: str | None) -> bool:
	"""Validate and consume a state token; must match the current user."""
	if not state:
		return False
	key = _oauth_state_key(state)
	user = frappe.cache().get_value(key)
	frappe.cache().delete_value(key)
	return bool(user) and user == frappe.session.user


def build_authorize_url(state: str, redirect_uri: str) -> str:
	"""GitHub OAuth authorize URL for this App's client id."""
	client_id = _settings().github_app_client_id
	if not client_id:
		frappe.throw(_("GitHub App is not configured in Wiki Settings."))
	params = urlencode({"client_id": client_id, "redirect_uri": redirect_uri, "state": state})
	return f"{OAUTH_AUTHORIZE_URL}?{params}"


def exchange_oauth_code(code: str, redirect_uri: str) -> str:
	"""Exchange an OAuth callback code for a user-to-server access token."""
	settings = _settings()
	client_id = settings.github_app_client_id
	client_secret = settings.get_password("github_app_client_secret", raise_exception=False)
	if not client_id or not client_secret:
		frappe.throw(_("GitHub App is not configured in Wiki Settings."))

	resp = requests.post(
		OAUTH_TOKEN_URL,
		headers={"Accept": "application/json"},
		data={
			"client_id": client_id,
			"client_secret": client_secret,
			"code": code,
			"redirect_uri": redirect_uri,
		},
		timeout=30,
	)
	resp.raise_for_status()
	payload = resp.json()
	token = payload.get("access_token")
	if not token:
		frappe.throw(
			_("GitHub did not return an access token: {0}").format(
				payload.get("error_description") or payload.get("error") or "unknown error"
			)
		)
	return token


def _require_user_token() -> str:
	token = get_user_token()
	if not token:
		frappe.throw(_("GitHub account is not connected."), frappe.PermissionError)
	return token


# --------------------------------------------------------------------------- #
# Whitelisted picker endpoints (read the connected user's cached OAuth token)
# --------------------------------------------------------------------------- #
@frappe.whitelist()
def is_connected() -> bool:
	return bool(get_user_token())


@frappe.whitelist()
def my_installations() -> list[dict[str, Any]]:
	return installations(_require_user_token())


@frappe.whitelist()
def my_repositories(installation_id: str | int) -> list[dict[str, Any]]:
	return repositories(installation_id, _require_user_token())
