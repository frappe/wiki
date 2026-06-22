# Copyright (c) 2026, Frappe and Contributors
# See license.txt

import hashlib
import hmac
import json

import frappe
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from frappe.tests.utils import FrappeTestCase

from wiki.api import github


def _rsa_keypair():
	key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
	private_pem = key.private_bytes(
		encoding=serialization.Encoding.PEM,
		format=serialization.PrivateFormat.PKCS8,
		encryption_algorithm=serialization.NoEncryption(),
	).decode()
	public_pem = (
		key.public_key()
		.public_bytes(
			encoding=serialization.Encoding.PEM,
			format=serialization.PublicFormat.SubjectPublicKeyInfo,
		)
		.decode()
	)
	return private_pem, public_pem


class _FakeResponse:
	def __init__(self, payload, status=200):
		self._payload = payload
		self.status_code = status

	def json(self):
		return self._payload

	def raise_for_status(self):
		if self.status_code >= 400:
			raise github.requests.HTTPError(f"HTTP {self.status_code}")


class _FakeRequests:
	"""Stand-in for the `requests` module: records calls, returns canned responses.

	Installed as `github.requests` so the module's `requests.get/post` resolve
	here without touching the real HTTP library.
	"""

	HTTPError = github.requests.HTTPError

	def __init__(self, get=None, post=None):
		self._get = get
		self._post = post
		self.get_calls = []
		self.post_calls = []

	def get(self, url, headers=None, timeout=None):
		self.get_calls.append((url, headers))
		return self._get(url, headers)

	def post(self, url, headers=None, data=None, timeout=None):
		self.post_calls.append((url, headers))
		self.last_post_data = data
		return self._post(url, headers)


class TestGithubAuth(FrappeTestCase):
	def setUp(self):
		self._real_requests = github.requests

	def tearDown(self):
		github.requests = self._real_requests
		frappe.flags.in_test_github_keys = False
		frappe.db.rollback()
		frappe.clear_cache(doctype="Wiki Settings")

	def _configure_app(self, app_id="123456", private_key=None, client_id=None, client_secret=None):
		settings = frappe.get_doc("Wiki Settings")
		settings.github_app_id = app_id
		if private_key is not None:
			settings.github_app_private_key = private_key
		if client_id is not None:
			settings.github_app_client_id = client_id
		if client_secret is not None:
			settings.github_app_client_secret = client_secret
		settings.save()
		frappe.clear_cache(doctype="Wiki Settings")

	def test_app_jwt_signed_with_private_key(self):
		private_pem, public_pem = _rsa_keypair()
		self._configure_app(app_id="654321", private_key=private_pem)

		token = github._app_jwt()
		# Verifying with the public half proves we signed with the App key (RS256).
		decoded = jwt.decode(token, public_pem, algorithms=["RS256"], options={"verify_exp": False})
		self.assertEqual(decoded["iss"], "654321")
		self.assertLess(decoded["iat"], decoded["exp"])
		# Lifetime stays under GitHub's 10-minute cap.
		self.assertLessEqual(decoded["exp"] - decoded["iat"], 10 * 60)

	def test_app_jwt_throws_when_unconfigured(self):
		self._configure_app(app_id="", private_key="")
		self.assertRaises(frappe.ValidationError, github._app_jwt)

	def test_installation_access_token_minted(self):
		private_pem, _ = _rsa_keypair()
		self._configure_app(private_key=private_pem)

		def _post(url, headers):
			return _FakeResponse({"token": "ghs_installationtoken", "expires_at": "2026-06-21T12:00:00Z"})

		fake = _FakeRequests(post=_post)
		github.requests = fake

		token = github.installation_access_token(99)
		self.assertEqual(token, "ghs_installationtoken")
		# Hits the App's access-tokens endpoint, authenticated with the App JWT.
		url, headers = fake.post_calls[0]
		self.assertEqual(url, f"{github.GITHUB_API}/app/installations/99/access_tokens")
		self.assertTrue(headers["Authorization"].startswith("Bearer "))

	def test_installations_parsed(self):
		def _get(url, headers):
			return _FakeResponse(
				{
					"installations": [
						{
							"id": 42,
							"account": {
								"login": "acme",
								"type": "Organization",
								"avatar_url": "https://x/y.png",
							},
						}
					]
				}
			)

		github.requests = _FakeRequests(get=_get)
		result = github.installations("user-oauth-token")
		self.assertEqual(len(result), 1)
		self.assertEqual(result[0]["id"], 42)
		self.assertEqual(result[0]["account"], "acme")
		self.assertEqual(result[0]["account_type"], "Organization")

	def test_repositories_parsed_and_paginated(self):
		# First page is full (100) → engine must fetch a second page.
		page1 = [
			{"full_name": f"acme/repo{i}", "private": True, "default_branch": "main"} for i in range(100)
		]
		page2 = [{"full_name": "acme/last", "private": False, "default_branch": "develop"}]

		def _get(url, headers):
			payload = page1 if "page=1" in url else page2
			return _FakeResponse({"repositories": payload})

		fake = _FakeRequests(get=_get)
		github.requests = fake
		result = github.repositories(42, "user-oauth-token")

		self.assertEqual(len(result), 101)
		self.assertEqual(len(fake.get_calls), 2)  # paginated
		self.assertEqual(result[-1]["full_name"], "acme/last")
		self.assertFalse(result[-1]["private"])
		self.assertEqual(result[-1]["default_branch"], "develop")

	# ----- connect-account OAuth (TB4b) ----- #

	def test_oauth_state_round_trips_and_is_single_use(self):
		state = github.new_oauth_state()
		# Valid once, then consumed.
		self.assertTrue(github.verify_oauth_state(state))
		self.assertFalse(github.verify_oauth_state(state))
		# Unknown / empty states are rejected.
		self.assertFalse(github.verify_oauth_state("not-a-real-state"))
		self.assertFalse(github.verify_oauth_state(None))

	def test_authorize_url_carries_client_id_state_redirect(self):
		self._configure_app(client_id="Iv1.abc123")
		url = github.build_authorize_url("state-xyz", "https://wiki.test/github/redirect")
		self.assertTrue(url.startswith(github.OAUTH_AUTHORIZE_URL))
		self.assertIn("client_id=Iv1.abc123", url)
		self.assertIn("state=state-xyz", url)
		self.assertIn("redirect_uri=https%3A%2F%2Fwiki.test%2Fgithub%2Fredirect", url)

	def test_exchange_oauth_code_posts_credentials_and_returns_token(self):
		self._configure_app(client_id="Iv1.abc123", client_secret="shhh-secret")

		def _post(url, headers):
			return _FakeResponse({"access_token": "gho_usertoken", "token_type": "bearer"})

		fake = _FakeRequests(post=_post)
		github.requests = fake

		token = github.exchange_oauth_code("the-code", "https://wiki.test/github/redirect")
		self.assertEqual(token, "gho_usertoken")
		url, _headers = fake.post_calls[0]
		self.assertEqual(url, github.OAUTH_TOKEN_URL)
		# Client id/secret + code travel in the POST body, not the URL.
		self.assertEqual(fake.last_post_data["client_id"], "Iv1.abc123")
		self.assertEqual(fake.last_post_data["client_secret"], "shhh-secret")
		self.assertEqual(fake.last_post_data["code"], "the-code")

	def test_exchange_oauth_code_throws_on_error_payload(self):
		self._configure_app(client_id="Iv1.abc123", client_secret="shhh-secret")

		def _post(url, headers):
			return _FakeResponse({"error": "bad_verification_code", "error_description": "expired"})

		github.requests = _FakeRequests(post=_post)
		self.assertRaises(frappe.ValidationError, github.exchange_oauth_code, "x", "y")

	def test_user_token_cache_round_trip_and_my_wrappers_require_it(self):
		user = frappe.session.user
		frappe.cache().delete_value(github._user_token_key(user))

		# Not connected → wrappers refuse.
		self.assertFalse(github.is_connected())
		self.assertRaises(frappe.PermissionError, github.my_installations)

		github.store_user_token(user, "gho_cached")
		self.addCleanup(frappe.cache().delete_value, github._user_token_key(user))
		self.assertTrue(github.is_connected())
		self.assertEqual(github.get_user_token(), "gho_cached")

		# The whitelisted wrapper forwards the cached token to the lister.
		captured = {}

		def _get(url, headers):
			captured["auth"] = headers["Authorization"]
			return _FakeResponse({"installations": []})

		github.requests = _FakeRequests(get=_get)
		github.my_installations()
		self.assertEqual(captured["auth"], "Bearer gho_cached")


class TestGithubAppManifest(FrappeTestCase):
	"""TB7 — one-click App creation via GitHub's manifest flow."""

	def setUp(self):
		self._real_requests = github.requests

	def tearDown(self):
		github.requests = self._real_requests
		frappe.db.rollback()
		frappe.clear_cache(doctype="Wiki Settings")

	def test_build_app_manifest_for_readonly_sync(self):
		manifest = github.build_app_manifest(
			name="Wiki Sync (wiki.test)",
			homepage_url="https://wiki.test",
			redirect_url="https://wiki.test/github/manifest_redirect",
			callback_url="https://wiki.test/github/redirect",
			webhook_url="https://wiki.test/api/method/wiki.api.github.webhook",
		)
		# Minimum permissions for one-way sync: read contents + metadata only.
		self.assertEqual(manifest["default_permissions"], {"contents": "read", "metadata": "read"})
		self.assertEqual(manifest["default_events"], ["push"])
		self.assertFalse(manifest["public"])
		self.assertEqual(manifest["redirect_url"], "https://wiki.test/github/manifest_redirect")
		self.assertEqual(manifest["callback_urls"], ["https://wiki.test/github/redirect"])
		self.assertEqual(
			manifest["hook_attributes"]["url"],
			"https://wiki.test/api/method/wiki.api.github.webhook",
		)
		self.assertTrue(manifest["hook_attributes"]["active"])
		self.assertEqual(manifest["name"], "Wiki Sync (wiki.test)")
		self.assertEqual(manifest["url"], "https://wiki.test")

	def test_manifest_uses_inactive_placeholder_for_unreachable_host(self):
		# GitHub requires hook_attributes.url and rejects non-public hosts, so on
		# localhost the manifest registers an inactive placeholder hook (no events).
		self.assertFalse(github.is_public_host("https://wiki.localhost"))
		self.assertFalse(github.is_public_host("http://127.0.0.1:8000"))
		self.assertTrue(github.is_public_host("https://docs.frappe.io"))

		manifest = github.build_app_manifest(
			name="Wiki Sync",
			homepage_url="https://wiki.localhost",
			redirect_url="https://wiki.localhost/github/manifest_redirect",
			callback_url="https://wiki.localhost/github/redirect",
			webhook_url=None,
		)
		self.assertEqual(manifest["hook_attributes"]["url"], github.PLACEHOLDER_HOOK_URL)
		self.assertFalse(manifest["hook_attributes"]["active"])
		# No event subscription on an inactive placeholder hook.
		self.assertNotIn("default_events", manifest)

	def test_manifest_create_url_personal_vs_org(self):
		self.assertEqual(github.manifest_create_url(), github.MANIFEST_CREATE_URL)
		self.assertEqual(
			github.manifest_create_url("acme"),
			"https://github.com/organizations/acme/settings/apps/new",
		)

	def test_convert_app_manifest_posts_to_conversions(self):
		config = {
			"id": 778899,
			"client_id": "Iv1.manifest",
			"client_secret": "manifestsecret",
			"webhook_secret": "hookshhh",
			"pem": "-----BEGIN RSA PRIVATE KEY-----\nx\n-----END RSA PRIVATE KEY-----\n",
			"html_url": "https://github.com/apps/wiki-sync",
		}

		def _post(url, headers):
			return _FakeResponse(config)

		fake = _FakeRequests(post=_post)
		github.requests = fake

		result = github.convert_app_manifest("temp-code")
		self.assertEqual(result, config)
		url, _headers = fake.post_calls[0]
		self.assertEqual(url, f"{github.GITHUB_API}/app-manifests/temp-code/conversions")

	def test_store_app_credentials_writes_all_fields(self):
		github.store_app_credentials(
			{
				"id": 778899,
				"client_id": "Iv1.manifest",
				"client_secret": "manifestsecret",
				"webhook_secret": "hookshhh",
				"pem": "-----BEGIN RSA PRIVATE KEY-----\nx\n-----END RSA PRIVATE KEY-----\n",
				"html_url": "https://github.com/apps/wiki-sync",
			}
		)
		settings = frappe.get_doc("Wiki Settings")
		self.assertEqual(settings.github_app_id, "778899")
		self.assertEqual(settings.github_app_client_id, "Iv1.manifest")
		# Public link is derived from the App's html_url.
		self.assertEqual(
			settings.github_app_public_link,
			"https://github.com/apps/wiki-sync/installations/new",
		)
		# Secrets are encrypted at rest — read them back through get_password.
		self.assertEqual(settings.get_password("github_app_client_secret"), "manifestsecret")
		self.assertEqual(settings.get_password("github_webhook_secret"), "hookshhh")
		self.assertIn("BEGIN RSA PRIVATE KEY", settings.get_password("github_app_private_key"))
		# The picker reads the install link back to offer "Install GitHub App".
		self.assertEqual(github.app_install_url(), "https://github.com/apps/wiki-sync/installations/new")


class TestGithubWebhook(FrappeTestCase):
	"""Push webhook: signature gate + branch-matched routing to git-synced spaces."""

	WEBHOOK_SECRET = "shhh-webhook"

	def setUp(self):
		settings = frappe.get_doc("Wiki Settings")
		settings.github_webhook_secret = self.WEBHOOK_SECRET
		settings.save()
		frappe.clear_cache(doctype="Wiki Settings")
		self._real_enqueue = frappe.enqueue
		self.enqueued = []
		frappe.enqueue = lambda *args, **kwargs: self.enqueued.append((args, kwargs))

	def tearDown(self):
		frappe.enqueue = self._real_enqueue
		frappe.db.rollback()
		frappe.clear_cache(doctype="Wiki Settings")

	def _synced_space(self, repo="acme/docs", branch="main"):
		space = frappe.new_doc("Wiki Space")
		space.space_name = "Synced"
		space.route = f"synced-{frappe.generate_hash(length=6)}"
		space.git_synced = 1
		space.repo_full_name = repo
		space.branch = branch
		space.insert()
		return space

	def _sign(self, body: bytes, secret: str | None = None) -> str:
		secret = self.WEBHOOK_SECRET if secret is None else secret
		return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()

	def _push_body(self, repo="acme/docs", ref="refs/heads/main") -> bytes:
		return json.dumps({"repository": {"full_name": repo}, "ref": ref}).encode()

	# ----- signature verification ----- #

	def test_verify_signature_valid(self):
		body = b'{"hello": "world"}'
		self.assertTrue(github._verify_signature(body, self._sign(body), self.WEBHOOK_SECRET))

	def test_verify_signature_invalid(self):
		body = b'{"hello": "world"}'
		self.assertFalse(github._verify_signature(body, self._sign(b"tampered"), self.WEBHOOK_SECRET))

	def test_verify_signature_missing(self):
		self.assertFalse(github._verify_signature(b"{}", None, self.WEBHOOK_SECRET))
		self.assertFalse(github._verify_signature(b"{}", "sha256=abc", None))

	# ----- dispatch / routing ----- #

	def test_invalid_signature_is_rejected(self):
		body = self._push_body()
		self.assertRaises(frappe.PermissionError, github._dispatch_webhook, body, "sha256=wrong", "push")
		self.assertEqual(self.enqueued, [])

	def test_push_enqueues_only_branch_matched_space(self):
		main_space = self._synced_space(branch="main")
		self._synced_space(branch="develop")  # same repo, other branch — must be skipped

		body = self._push_body(ref="refs/heads/main")
		result = github._dispatch_webhook(body, self._sign(body), "push")

		self.assertEqual(result["synced_spaces"], [main_space.name])
		self.assertEqual(result["branch"], "main")
		self.assertEqual(len(self.enqueued), 1)
		_args, kwargs = self.enqueued[0]
		self.assertEqual(kwargs["space_name"], main_space.name)
		self.assertEqual(kwargs["trigger"], "Webhook")

	def test_non_push_event_is_ignored(self):
		self._synced_space(branch="main")
		body = self._push_body()
		result = github._dispatch_webhook(body, self._sign(body), "issues")
		self.assertEqual(result, {"ignored": "issues"})
		self.assertEqual(self.enqueued, [])

	def test_ping_event_acknowledged(self):
		body = b"{}"
		result = github._dispatch_webhook(body, self._sign(body), "ping")
		self.assertTrue(result["ok"])
		self.assertEqual(self.enqueued, [])

	def test_tag_push_matches_no_space(self):
		self._synced_space(branch="main")
		body = self._push_body(ref="refs/tags/v1.0")
		result = github._dispatch_webhook(body, self._sign(body), "push")
		self.assertEqual(result["synced_spaces"], [])
		self.assertEqual(self.enqueued, [])
