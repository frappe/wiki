# Copyright (c) 2026, Frappe and Contributors
# See license.txt

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

	def post(self, url, headers=None, timeout=None):
		self.post_calls.append((url, headers))
		return self._post(url, headers)


class TestGithubAuth(FrappeTestCase):
	def setUp(self):
		self._real_requests = github.requests

	def tearDown(self):
		github.requests = self._real_requests
		frappe.flags.in_test_github_keys = False
		frappe.db.rollback()
		frappe.clear_cache(doctype="Wiki Settings")

	def _configure_app(self, app_id="123456", private_key=None):
		settings = frappe.get_doc("Wiki Settings")
		settings.github_app_id = app_id
		if private_key is not None:
			settings.github_app_private_key = private_key
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
