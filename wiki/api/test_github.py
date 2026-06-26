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

	def test_repositories_returns_single_page_with_has_more(self):
		# A full page signals there's more to fetch; the picker pages on demand
		# rather than walking every page up front (the slow path we removed).
		full_page = [
			{"full_name": f"acme/repo{i}", "private": True, "default_branch": "main"}
			for i in range(github.REPO_PAGE_SIZE)
		]
		fake = _FakeRequests(get=lambda url, headers: _FakeResponse({"repositories": full_page}))
		github.requests = fake

		result = github.repositories(42, "user-oauth-token", page=1)

		self.assertEqual(len(fake.get_calls), 1)  # one page, not the whole list
		self.assertTrue(result["has_more"])
		self.assertEqual(len(result["repositories"]), github.REPO_PAGE_SIZE)
		self.assertIn(f"per_page={github.REPO_PAGE_SIZE}", fake.get_calls[0][0])

	def test_repositories_last_page_reports_no_more(self):
		short_page = [{"full_name": "acme/last", "private": False, "default_branch": "develop"}]
		fake = _FakeRequests(get=lambda url, headers: _FakeResponse({"repositories": short_page}))
		github.requests = fake

		result = github.repositories(42, "user-oauth-token", page=2)

		self.assertFalse(result["has_more"])
		self.assertEqual(result["repositories"][0]["full_name"], "acme/last")
		self.assertEqual(result["repositories"][0]["default_branch"], "develop")

	def test_repositories_search_uses_scoped_search_api(self):
		self._configure_app(private_key=_rsa_keypair()[0])

		def _get(url, headers):
			if "/app/installations/42" in url:
				return _FakeResponse({"account": {"login": "acme", "type": "Organization"}})
			# Search endpoint hit with the org-scoped query.
			self.assertIn("/search/repositories", url)
			self.assertIn("org%3Aacme", url)
			self.assertIn("docs+in%3Aname", url)
			return _FakeResponse(
				{
					"total_count": 100,
					"items": [{"full_name": "acme/docs", "private": True, "default_branch": "main"}],
				}
			)

		github.requests = _FakeRequests(get=_get)
		result = github.repositories(42, "user-oauth-token", search="docs", page=1)

		self.assertTrue(result["has_more"])  # 100 > page*30
		self.assertEqual(result["repositories"][0]["full_name"], "acme/docs")

	def test_repo_branches_lists_names(self):
		fake = _FakeRequests(get=lambda url, headers: _FakeResponse([{"name": "main"}, {"name": "develop"}]))
		github.requests = fake

		result = github.repo_branches("acme/docs", "user-oauth-token")

		self.assertEqual(result, ["main", "develop"])
		self.assertIn("/repos/acme/docs/branches", fake.get_calls[0][0])

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

		payload = github.exchange_oauth_code("the-code", "https://wiki.test/github/redirect")
		self.assertEqual(payload["access_token"], "gho_usertoken")
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
		# Clean slate: ignore any real persisted connection for this user (rolled back).
		if frappe.db.exists(github.CONNECTION_DOCTYPE, user):
			frappe.delete_doc(github.CONNECTION_DOCTYPE, user, ignore_permissions=True, force=True)

		# Not connected → wrappers refuse.
		self.assertFalse(github.is_connected())
		self.assertRaises(frappe.PermissionError, github.my_installations)

		github.store_user_token(user, {"access_token": "gho_cached"})
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

	def _reset_connection(self, user):
		if frappe.db.exists(github.CONNECTION_DOCTYPE, user):
			frappe.delete_doc(github.CONNECTION_DOCTYPE, user, ignore_permissions=True, force=True)
		frappe.cache().delete_value(github._user_token_key(user))
		self.addCleanup(frappe.cache().delete_value, github._user_token_key(user))

	def test_token_persists_across_cache_eviction(self):
		# The whole point of the DocType: surviving a bench restart (cache loss)
		# so the user doesn't have to reconnect.
		user = frappe.session.user
		self._reset_connection(user)

		github.store_user_token(user, {"access_token": "gho_persist"})  # non-expiring
		frappe.cache().delete_value(github._user_token_key(user))  # simulate restart

		self.assertEqual(github.get_user_token(user), "gho_persist")  # served from DB

	def test_expired_token_is_refreshed_from_persistence(self):
		user = frappe.session.user
		self._reset_connection(user)
		self._configure_app(client_id="Iv1.abc", client_secret="secret")

		github.store_user_token(
			user,
			{
				"access_token": "gho_old",
				"refresh_token": "ghr_refresh",
				"expires_in": -10,  # already expired
				"refresh_token_expires_in": 15552000,
			},
		)
		frappe.cache().delete_value(github._user_token_key(user))  # force the DB path

		def _post(url, headers):
			return _FakeResponse(
				{
					"access_token": "gho_new",
					"refresh_token": "ghr_new",
					"expires_in": 28800,
					"refresh_token_expires_in": 15552000,
				}
			)

		fake = _FakeRequests(post=_post)
		github.requests = fake

		self.assertEqual(github.get_user_token(user), "gho_new")
		self.assertEqual(fake.last_post_data["grant_type"], "refresh_token")
		self.assertEqual(fake.last_post_data["refresh_token"], "ghr_refresh")


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

	# ----- delivery log + routing ----- #

	def _deliver(self, body: bytes, signature: str, event: str):
		"""Mirror the webhook endpoint: persist the delivery, then dispatch it."""
		log = frappe.get_doc(
			{
				"doctype": "Wiki GitHub Webhook Log",
				"name": f"delivery-{frappe.generate_hash(length=8)}",
				"event": event,
				"signature": signature,
				"payload": body.decode(),
			}
		)
		log.insert(ignore_permissions=True)
		log.handle_events()
		return log

	def test_invalid_signature_is_rejected(self):
		body = self._push_body()
		self.assertRaises(frappe.PermissionError, self._deliver, body, "sha256=wrong", "push")
		self.assertEqual(self.enqueued, [])
		# A forged delivery must not be persisted.
		self.assertEqual(frappe.db.count("Wiki GitHub Webhook Log"), 0)

	def test_push_enqueues_only_branch_matched_space(self):
		main_space = self._synced_space(branch="main")
		self._synced_space(branch="develop")  # same repo, other branch — must be skipped

		body = self._push_body(ref="refs/heads/main")
		log = self._deliver(body, self._sign(body), "push")

		self.assertEqual(log.branch, "main")
		self.assertEqual(log.git_reference_type, "branch")
		self.assertEqual(log.synced_spaces, main_space.name)
		self.assertEqual(len(self.enqueued), 1)
		_args, kwargs = self.enqueued[0]
		self.assertEqual(kwargs["space_name"], main_space.name)
		self.assertEqual(kwargs["trigger"], "Webhook")

	def test_non_push_event_is_logged_but_ignored(self):
		self._synced_space(branch="main")
		body = self._push_body()
		log = self._deliver(body, self._sign(body), "issues")
		# Logged for audit, but no sync side effects.
		self.assertTrue(frappe.db.exists("Wiki GitHub Webhook Log", log.name))
		self.assertFalse(log.synced_spaces)
		self.assertEqual(self.enqueued, [])

	def test_ping_event_acknowledged(self):
		log = self._deliver(b"{}", self._sign(b"{}"), "ping")
		self.assertTrue(frappe.db.exists("Wiki GitHub Webhook Log", log.name))
		self.assertEqual(self.enqueued, [])

	def test_tag_push_matches_no_space(self):
		self._synced_space(branch="main")
		body = self._push_body(ref="refs/tags/v1.0")
		log = self._deliver(body, self._sign(body), "push")
		self.assertEqual(log.git_reference_type, "tag")
		self.assertFalse(log.synced_spaces)
		self.assertEqual(self.enqueued, [])

	def _call_webhook(self, body: bytes, signature: str, event: str, delivery: str):
		"""Drive the actual endpoint with a stubbed request (and a no-op commit)."""
		headers = {
			"X-GitHub-Delivery": delivery,
			"X-GitHub-Event": event,
			"X-Hub-Signature-256": signature,
		}
		real_header, real_request = github.frappe.get_request_header, getattr(frappe.local, "request", None)
		real_commit = frappe.db.commit
		github.frappe.get_request_header = lambda key, default=None: headers.get(key, default)
		frappe.local.request = type("R", (), {"get_data": staticmethod(lambda: body)})()
		frappe.db.commit = lambda *a, **k: None
		try:
			return github.webhook()
		finally:
			github.frappe.get_request_header = real_header
			frappe.local.request = real_request
			frappe.db.commit = real_commit

	def test_duplicate_delivery_is_idempotent(self):
		# GitHub re-sends the same delivery id after a 5xx; the replay must ack
		# without a DuplicateEntryError, a second log row, or a re-enqueue.
		space = self._synced_space(branch="main")
		body = self._push_body(ref="refs/heads/main")
		sig = self._sign(body)

		first = self._call_webhook(body, sig, "push", "dup-1")
		self.assertEqual(first["synced_spaces"], space.name)
		self.assertEqual(len(self.enqueued), 1)

		second = self._call_webhook(body, sig, "push", "dup-1")
		self.assertTrue(second["duplicate"])
		self.assertEqual(len(self.enqueued), 1)  # not re-enqueued
		self.assertEqual(frappe.db.count("Wiki GitHub Webhook Log", {"name": "dup-1"}), 1)
