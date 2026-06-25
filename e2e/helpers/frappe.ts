import * as fs from 'fs';
import { APIRequestContext } from '@playwright/test';

/**
 * Frappe API response wrapper.
 */
export interface FrappeResponse<T = unknown> {
	message?: T;
	exc?: string;
	exc_type?: string;
	_server_messages?: string;
}

// Path to CSRF token file saved by auth.setup.ts
const CSRF_FILE = 'e2e/.auth/csrf.json';

// Cache for CSRF token (read from file once)
let csrfTokenCache: string | null = null;

/**
 * Get CSRF token from the file saved during auth setup.
 * The token is extracted from window.frappe.csrf_token after login.
 */
function getCsrfToken(): string {
	// Return cached token if available
	if (csrfTokenCache !== null) {
		return csrfTokenCache;
	}

	// Read token from file
	try {
		if (fs.existsSync(CSRF_FILE)) {
			const data = JSON.parse(fs.readFileSync(CSRF_FILE, 'utf-8'));
			csrfTokenCache = data.csrf_token || '';
			return csrfTokenCache;
		}
	} catch (error) {
		console.warn('Failed to read CSRF token file:', error);
	}

	csrfTokenCache = '';
	return '';
}

/**
 * Create a new document via Frappe REST API.
 */
export async function createDoc<T = Record<string, unknown>>(
	request: APIRequestContext,
	doctype: string,
	doc: Record<string, unknown>,
): Promise<T> {
	const csrfToken = getCsrfToken();

	const response = await request.post(`/api/resource/${doctype}`, {
		data: doc,
		headers: {
			'Content-Type': 'application/json',
			...(csrfToken ? { 'X-Frappe-CSRF-Token': csrfToken } : {}),
		},
	});

	if (!response.ok()) {
		const error = await response.text();
		throw new Error(`Failed to create ${doctype}: ${error}`);
	}

	const result = await response.json();
	return result.data as T;
}

/**
 * Get a document by name via Frappe REST API.
 */
export async function getDoc<T = Record<string, unknown>>(
	request: APIRequestContext,
	doctype: string,
	name: string,
): Promise<T> {
	const response = await request.get(
		`/api/resource/${doctype}/${encodeURIComponent(name)}`,
	);

	if (!response.ok()) {
		const error = await response.text();
		throw new Error(`Failed to get ${doctype}/${name}: ${error}`);
	}

	const result = await response.json();
	return result.data as T;
}

/**
 * Update a document via Frappe REST API.
 */
export async function updateDoc<T = Record<string, unknown>>(
	request: APIRequestContext,
	doctype: string,
	name: string,
	updates: Record<string, unknown>,
): Promise<T> {
	const csrfToken = getCsrfToken();

	const response = await request.put(
		`/api/resource/${doctype}/${encodeURIComponent(name)}`,
		{
			data: updates,
			headers: {
				'Content-Type': 'application/json',
				...(csrfToken ? { 'X-Frappe-CSRF-Token': csrfToken } : {}),
			},
		},
	);

	if (!response.ok()) {
		const error = await response.text();
		throw new Error(`Failed to update ${doctype}/${name}: ${error}`);
	}

	const result = await response.json();
	return result.data as T;
}

/**
 * Delete a document via Frappe REST API.
 */
export async function deleteDoc(
	request: APIRequestContext,
	doctype: string,
	name: string,
): Promise<void> {
	const csrfToken = getCsrfToken();

	const response = await request.delete(
		`/api/resource/${doctype}/${encodeURIComponent(name)}`,
		{
			headers: {
				...(csrfToken ? { 'X-Frappe-CSRF-Token': csrfToken } : {}),
			},
		},
	);

	if (!response.ok()) {
		const error = await response.text();
		throw new Error(`Failed to delete ${doctype}/${name}: ${error}`);
	}
}

/**
 * Call a Frappe whitelisted method.
 */
export async function callMethod<T = unknown>(
	request: APIRequestContext,
	method: string,
	args: Record<string, unknown> = {},
): Promise<T> {
	const csrfToken = getCsrfToken();

	const response = await request.post(`/api/method/${method}`, {
		data: args,
		headers: {
			'Content-Type': 'application/json',
			...(csrfToken ? { 'X-Frappe-CSRF-Token': csrfToken } : {}),
		},
	});

	if (!response.ok()) {
		const error = await response.text();
		throw new Error(`Failed to call ${method}: ${error}`);
	}

	const result: FrappeResponse<T> = await response.json();
	return result.message as T;
}

/**
 * Get a list of documents via Frappe REST API.
 */
export async function getList<T = Record<string, unknown>>(
	request: APIRequestContext,
	doctype: string,
	options: {
		fields?: string[];
		filters?: Record<string, unknown>;
		limit?: number;
		orderBy?: string;
	} = {},
): Promise<T[]> {
	const params = new URLSearchParams();

	if (options.fields) {
		params.set('fields', JSON.stringify(options.fields));
	}
	if (options.filters) {
		params.set('filters', JSON.stringify(options.filters));
	}
	if (options.limit !== undefined) {
		// 0 means "no limit" in Frappe — without this, the REST default of 20
		// silently truncates large result sets.
		params.set('limit_page_length', options.limit.toString());
	}
	if (options.orderBy) {
		params.set('order_by', options.orderBy);
	}

	const response = await request.get(
		`/api/resource/${doctype}?${params.toString()}`,
	);

	if (!response.ok()) {
		const error = await response.text();
		throw new Error(`Failed to get list of ${doctype}: ${error}`);
	}

	const result = await response.json();
	return result.data as T[];
}

/**
 * Check if a document exists.
 */
export async function docExists(
	request: APIRequestContext,
	doctype: string,
	name: string,
): Promise<boolean> {
	try {
		await getDoc(request, doctype, name);
		return true;
	} catch {
		return false;
	}
}
