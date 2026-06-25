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

import hashlib
import hmac
import ipaddress
import secrets
import time
from typing import Any
from urllib.parse import urlencode, urlparse

import frappe
import jwt
import requests
from frappe import _
from frappe.utils import add_to_date, get_datetime, now_datetime

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


REPO_PAGE_SIZE = 30


def _repo_brief(repo: dict[str, Any]) -> dict[str, Any]:
	return {
		"full_name": repo.get("full_name"),
		"private": repo.get("private"),
		"default_branch": repo.get("default_branch"),
	}


def _installation_account(installation_id: str | int) -> tuple[str | None, str | None]:
	"""``(login, type)`` of the account an installation belongs to.

	Used to scope repo *search* to the right owner; reads App-scoped metadata, so
	it signs with the App JWT rather than the user token.
	"""
	resp = requests.get(
		f"{GITHUB_API}/app/installations/{installation_id}",
		headers=_headers(_app_jwt()),
		timeout=30,
	)
	resp.raise_for_status()
	account = resp.json().get("account") or {}
	return account.get("login"), account.get("type")


def repositories(
	installation_id: str | int,
	token: str,
	search: str | None = None,
	page: int = 1,
) -> dict[str, Any]:
	"""One page of repos for the picker — ``{"repositories": [...], "has_more": bool}``.

	Browsing lists the installation's own repos. Searching can't use that endpoint
	(it has no name filter), so it falls back to GitHub's search API scoped to the
	installation's account — fast even for orgs with thousands of repos, where
	eagerly walking every page was the bottleneck.
	"""
	page = max(int(page or 1), 1)
	search = (search or "").strip()

	if search:
		login, account_type = _installation_account(installation_id)
		scope = "org" if (account_type or "").lower() == "organization" else "user"
		query = f"{search} in:name fork:true {scope}:{login}"
		params = urlencode({"q": query, "per_page": REPO_PAGE_SIZE, "page": page})
		resp = requests.get(
			f"{GITHUB_API}/search/repositories?{params}",
			headers=_headers(token),
			timeout=30,
		)
		resp.raise_for_status()
		data = resp.json()
		repos = [_repo_brief(r) for r in data.get("items", [])]
		has_more = page * REPO_PAGE_SIZE < int(data.get("total_count", 0))
	else:
		params = urlencode({"per_page": REPO_PAGE_SIZE, "page": page})
		resp = requests.get(
			f"{GITHUB_API}/user/installations/{installation_id}/repositories?{params}",
			headers=_headers(token),
			timeout=30,
		)
		resp.raise_for_status()
		batch = resp.json().get("repositories", [])
		repos = [_repo_brief(r) for r in batch]
		has_more = len(batch) == REPO_PAGE_SIZE

	return {"repositories": repos, "has_more": has_more}


def repo_branches(repo_full_name: str, token: str) -> list[str]:
	"""Branch names for a repo (first 100 — covers virtually every repo)."""
	params = urlencode({"per_page": 100})
	resp = requests.get(
		f"{GITHUB_API}/repos/{repo_full_name}/branches?{params}",
		headers=_headers(token),
		timeout=30,
	)
	resp.raise_for_status()
	return [b.get("name") for b in resp.json() if b.get("name")]


# --------------------------------------------------------------------------- #
# Connect-account OAuth (user-to-server) — sources the per-user OAuth token
# --------------------------------------------------------------------------- #
CONNECTION_DOCTYPE = "Wiki GitHub Connection"


def _user_token_key(user: str) -> str:
	return f"github_user_token:{user}"


def _oauth_state_key(state: str) -> str:
	return f"github_oauth_state:{state}"


def _token_expiry(expires_in: Any) -> Any:
	"""Absolute expiry datetime from GitHub's ``*_in`` seconds (None = no expiry)."""
	if not expires_in:
		return None
	return add_to_date(now_datetime(), seconds=int(expires_in))


def _token_valid(expires_at: Any) -> bool:
	"""A null expiry means the token never expires; else require 60s of headroom."""
	if not expires_at:
		return True
	return get_datetime(expires_at) > add_to_date(now_datetime(), seconds=60)


def _cache_user_token(user: str, token: str, expires_at: Any) -> None:
	ttl = _USER_TOKEN_TTL
	if expires_at:
		secs = int((get_datetime(expires_at) - now_datetime()).total_seconds())
		ttl = max(60, min(ttl, secs))
	frappe.cache().set_value(_user_token_key(user), token, expires_in_sec=ttl)


def store_user_token(user: str, payload: dict[str, Any]) -> None:
	"""Persist a user's OAuth token (access + refresh + expiry) durably + in cache.

	``payload`` is GitHub's token response. The token is kept in a per-user
	``Wiki GitHub Connection`` so it survives cache eviction / bench restarts —
	the cache is just a fast path. Refreshing tokens (``refresh_token`` present)
	are renewed on demand in :func:`get_user_token`, so the connect-account
	round-trip is a one-time step per user.
	"""
	access = payload.get("access_token")
	if not access:
		return
	expires_at = _token_expiry(payload.get("expires_in"))

	doc = (
		frappe.get_doc(CONNECTION_DOCTYPE, user)
		if frappe.db.exists(CONNECTION_DOCTYPE, user)
		else frappe.new_doc(CONNECTION_DOCTYPE)
	)
	doc.user = user
	doc.access_token = access
	doc.refresh_token = payload.get("refresh_token")
	doc.expires_at = expires_at
	doc.refresh_token_expires_at = _token_expiry(payload.get("refresh_token_expires_in"))
	doc.save(ignore_permissions=True)

	_cache_user_token(user, access, expires_at)


def _refresh_user_token(doc) -> str | None:
	"""Use a stored refresh token to mint a fresh access token (or None)."""
	refresh = doc.get_password("refresh_token", raise_exception=False)
	if not refresh or not _token_valid(doc.refresh_token_expires_at):
		return None

	settings = _settings()
	client_id = settings.github_app_client_id
	client_secret = settings.get_password("github_app_client_secret", raise_exception=False)
	if not client_id or not client_secret:
		return None

	resp = requests.post(
		OAUTH_TOKEN_URL,
		headers={"Accept": "application/json"},
		data={
			"client_id": client_id,
			"client_secret": client_secret,
			"grant_type": "refresh_token",
			"refresh_token": refresh,
		},
		timeout=30,
	)
	resp.raise_for_status()
	payload = resp.json()
	if not payload.get("access_token"):
		return None
	store_user_token(doc.user, payload)
	return payload["access_token"]


def get_user_token(user: str | None = None) -> str | None:
	user = user or frappe.session.user
	cached = frappe.cache().get_value(_user_token_key(user))
	if cached:
		return cached

	if not frappe.db.exists(CONNECTION_DOCTYPE, user):
		return None
	doc = frappe.get_doc(CONNECTION_DOCTYPE, user)

	access = doc.get_password("access_token", raise_exception=False)
	if access and _token_valid(doc.expires_at):
		_cache_user_token(user, access, doc.expires_at)
		return access
	return _refresh_user_token(doc)


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


def exchange_oauth_code(code: str, redirect_uri: str) -> dict[str, Any]:
	"""Exchange an OAuth callback code for the full user-to-server token payload.

	Returns GitHub's token response (``access_token`` plus, when the App expires
	user tokens, ``refresh_token``/``expires_in``/``refresh_token_expires_in``)
	so the caller can persist a renewable connection.
	"""
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
	if not payload.get("access_token"):
		frappe.throw(
			_("GitHub did not return an access token: {0}").format(
				payload.get("error_description") or payload.get("error") or "unknown error"
			)
		)
	return payload


# --------------------------------------------------------------------------- #
# App Manifest flow — one-click App creation (the press/giki model)
# --------------------------------------------------------------------------- #
# GitHub creates the App from a POSTed manifest, then redirects back with a
# short-lived `code` that converts to the App's id/secrets/private key — so the
# admin never hand-creates the App or pastes five credentials.
MANIFEST_CREATE_URL = "https://github.com/settings/apps/new"
MANIFEST_ORG_CREATE_URL = "https://github.com/organizations/{org}/settings/apps/new"

# GitHub *requires* a public hook URL in a manifest and rejects localhost/private
# hosts, so on a non-public site we register this reserved (RFC 2606) placeholder
# with the webhook inactive — the admin repoints it once deployed publicly.
PLACEHOLDER_HOOK_URL = "https://example.com/github-webhook-placeholder"


def manifest_create_url(org: str | None = None) -> str:
	"""The GitHub form endpoint the manifest POSTs to (personal vs. org account)."""
	return MANIFEST_ORG_CREATE_URL.format(org=org) if org else MANIFEST_CREATE_URL


def is_public_host(url: str) -> bool:
	"""Whether GitHub could reach this URL over the public Internet.

	GitHub rejects an App manifest whose webhook URL isn't publicly reachable
	(e.g. ``wiki.localhost`` on a dev box), so we drop the webhook from the
	manifest for non-public hosts and let the admin set it later.
	"""
	host = (urlparse(url).hostname or "").lower()
	if not host or host == "localhost" or host.endswith((".localhost", ".local")):
		return False
	try:
		return ipaddress.ip_address(host).is_global
	except ValueError:
		return True  # a domain name (not a bare IP) → assume public


def build_app_manifest(
	name: str,
	homepage_url: str,
	redirect_url: str,
	callback_url: str,
	webhook_url: str | None = None,
) -> dict[str, Any]:
	"""Build the GitHub App manifest for one-way (read-only) repo sync.

	Permissions are the minimum the sync engine needs — read `contents` (file
	bodies + the git tree) and `metadata`. ``redirect_url`` is where GitHub
	returns the manifest code; ``callback_url`` is TB4b's user-OAuth callback.

	``hook_attributes.url`` is **required** by GitHub and must be a public host.
	When ``webhook_url`` is set (a public site) the App gets a live webhook
	subscribed to ``push`` for TB6 real-time sync. When ``None`` (localhost /
	private host) we register an **inactive placeholder** hook so the manifest
	still validates — the admin repoints it and enables ``push`` once deployed
	publicly, and syncs via "Sync now" meanwhile.
	"""
	manifest = {
		"name": name,
		"url": homepage_url,
		"redirect_url": redirect_url,
		"callback_urls": [callback_url],
		"public": False,
		"default_permissions": {"contents": "read", "metadata": "read"},
	}
	if webhook_url:
		manifest["hook_attributes"] = {"url": webhook_url, "active": True}
		manifest["default_events"] = ["push"]
	else:
		manifest["hook_attributes"] = {"url": PLACEHOLDER_HOOK_URL, "active": False}
	return manifest


def convert_app_manifest(code: str) -> dict[str, Any]:
	"""Exchange a temporary manifest ``code`` for the new App's config.

	The conversion endpoint needs no auth — the single-use code (valid ~1h) is
	itself the secret. The response carries ``id``, ``client_id``,
	``client_secret``, ``webhook_secret``, ``pem`` (private key) and ``html_url``.
	"""
	resp = requests.post(
		f"{GITHUB_API}/app-manifests/{code}/conversions",
		headers={"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": API_VERSION},
		timeout=30,
	)
	resp.raise_for_status()
	return resp.json()


def store_app_credentials(config: dict[str, Any]) -> None:
	"""Persist a converted App's credentials into the Wiki Settings singleton."""
	settings = frappe.get_doc("Wiki Settings")
	settings.github_app_id = str(config.get("id") or "")
	settings.github_app_client_id = config.get("client_id") or ""
	settings.github_app_client_secret = config.get("client_secret") or ""
	settings.github_app_private_key = config.get("pem") or ""
	settings.github_webhook_secret = config.get("webhook_secret") or ""
	html_url = config.get("html_url")
	if html_url:
		settings.github_app_public_link = f"{html_url}/installations/new"
	# Permission bypass is safe: the only caller (the App-manifest redirect)
	# verifies `has_permission("Wiki Settings", "write")` before reaching here.
	settings.save(ignore_permissions=True)
	frappe.clear_cache(doctype="Wiki Settings")


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
def my_repositories(installation_id: str | int, search: str | None = None, page: int = 1) -> dict[str, Any]:
	return repositories(installation_id, _require_user_token(), search=search, page=page)


@frappe.whitelist()
def my_repo_branches(repo_full_name: str) -> list[str]:
	return repo_branches(repo_full_name, _require_user_token())


@frappe.whitelist()
def app_install_url() -> str | None:
	"""Public link to install the configured App (so it shows up as an installation)."""
	return _settings().github_app_public_link or None


# --------------------------------------------------------------------------- #
# Push webhook — real-time sync (auto-configured by the App installation)
# --------------------------------------------------------------------------- #
def _verify_signature(body: bytes, signature: str | None, secret: str | None) -> bool:
	"""Constant-time check of GitHub's ``X-Hub-Signature-256`` (HMAC-SHA256)."""
	if not signature or not secret:
		return False
	expected = "sha256=" + hmac.new(secret.encode(), body or b"", hashlib.sha256).hexdigest()
	return hmac.compare_digest(expected, signature)


def _spaces_for_push(repo_full_name: str | None, branch: str | None) -> list[str]:
	"""Git-synced Wiki Spaces tracking this exact repo + branch."""
	if not repo_full_name or not branch:
		return []
	return frappe.get_all(
		"Wiki Space",
		filters={"git_synced": 1, "repo_full_name": repo_full_name, "branch": branch},
		pluck="name",
		limit=0,
	)


# Guest access is required: GitHub posts webhooks unauthenticated. The body is
# verified against the App's HMAC-SHA256 secret in the log's `validate` (which
# rejects a forged delivery) before any work runs.
@frappe.whitelist(allow_guest=True)  # nosemgrep
def webhook() -> dict[str, Any]:
	"""GitHub webhook receiver. Payload URL: ``/api/method/wiki.api.github.webhook``.

	Every delivery is persisted as a ``Wiki GitHub Webhook Log`` (named by the
	delivery id) for audit/debug; the doc verifies the signature on insert and
	then dispatches its side effects (a branch ``push`` enqueues a sync).
	"""
	delivery = frappe.get_request_header("X-GitHub-Delivery")
	# Idempotent on replay: GitHub re-sends the same delivery id after a 5xx, so a
	# duplicate must ack 200 (not DuplicateEntryError → 500 → retry loop) and not
	# re-dispatch.
	if delivery and frappe.db.exists("Wiki GitHub Webhook Log", delivery):
		return {"delivery": delivery, "duplicate": True}

	body = frappe.request.get_data() or b""
	log = frappe.get_doc(
		{
			"doctype": "Wiki GitHub Webhook Log",
			"name": delivery,
			"event": frappe.get_request_header("X-GitHub-Event"),
			"signature": frappe.get_request_header("X-Hub-Signature-256"),
			"payload": body.decode("utf-8"),
		}
	)
	log.insert(ignore_permissions=True)
	# Persist the delivery before dispatch, so the audit row survives even if a
	# side effect later fails (the request would otherwise roll the insert back).
	frappe.db.commit()  # nosemgrep: frappe-semgrep-rules.rules.frappe-manual-commit
	log.handle_events()
	return {"delivery": log.name, "event": log.event, "synced_spaces": log.synced_spaces}
