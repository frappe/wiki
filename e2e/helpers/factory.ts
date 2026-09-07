import type { APIRequestContext } from '@playwright/test';
import { callMethod, createDoc, deleteDoc, getList } from './frappe';
import { appUrl } from './routes';
import type { WikiDocument, WikiSpace } from './wiki';

/**
 * Every space this factory creates is routed under this prefix, so the sweeper
 * in `global.teardown.ts` can delete leftovers from a killed run without any
 * chance of touching a real space.
 */
export const E2E_ROUTE_PREFIX = 'e2e';

/** A page to seed. Unknown keys are passed through to the Wiki Document. */
export interface PageSpec {
	title: string;
	content?: string;
	is_group?: boolean;
	is_published?: boolean;
	children?: PageSpec[];
	[field: string]: unknown;
}

/** A space to seed. Unknown keys are passed through to the Wiki Space. */
export interface SpaceSpec {
	route?: string;
	space_name?: string;
	is_published?: boolean;
	pages?: PageSpec[];
	[field: string]: unknown;
}

export interface SeededPage extends WikiDocument {
	children: SeededPage[];
}

export interface SeededSpace extends WikiSpace {
	/** The root group the Wiki Space created for itself, never a replacement. */
	rootGroup: string;
	/** Seeded pages, in spec order, each with its own `children`. */
	pages: SeededPage[];
	/** Look up a seeded page at any depth by title. Throws if absent. */
	page(title: string): SeededPage;
	/** `/wiki-app/spaces/<name>`, plus any deeper segments. */
	url(...segments: string[]): string;
}

let counter = 0;

/** A route no other spec (or parallel run) can collide with. */
export function uniqueRoute(slug = 'space'): string {
	counter += 1;
	return `${E2E_ROUTE_PREFIX}-${slug}-${counter}-${Date.now().toString(36)}`;
}

/** Flatten a page tree into breadth-first levels, keeping each node's parent. */
function levelsOf(
	pages: PageSpec[],
): { spec: PageSpec; parent: PageSpec | null }[][] {
	const levels: { spec: PageSpec; parent: PageSpec | null }[][] = [];
	let current = pages.map((spec) => ({
		spec,
		parent: null as PageSpec | null,
	}));
	while (current.length) {
		levels.push(current);
		current = current.flatMap(({ spec }) =>
			(spec.children ?? []).map((child) => ({ spec: child, parent: spec })),
		);
	}
	return levels;
}

/**
 * Creates wiki fixtures and remembers them so they can all be destroyed at once.
 *
 * Seeding costs `1 + depth + 1` requests — one to create the space, one bulk
 * insert per level of the page tree, and one read-back — rather than one per
 * document. Deeper levels cannot join the same bulk call: Wiki Document has no
 * `autoname`, and `set_new_name` discards any name we supply, so a child's
 * parent name is unknowable until its parent's insert returns.
 */
export class WikiFactory {
	private routes: string[] = [];

	constructor(private request: APIRequestContext) {}

	/**
	 * Seed a space and its page tree.
	 *
	 * Routes are left for the server to derive from the title and the ancestor
	 * chain, so seeded pages carry the same routes the UI would have produced.
	 */
	async space(spec: SpaceSpec = {}): Promise<SeededSpace> {
		const { pages = [], route, space_name, ...spaceFields } = spec;
		const spaceRoute = route ?? uniqueRoute();

		// Remembered before the create, so a request that times out server-side
		// still leaves us able to find and delete what it made.
		this.routes.push(spaceRoute);

		const space = await createDoc<WikiSpace & { root_group: string }>(
			this.request,
			'Wiki Space',
			{
				route: spaceRoute,
				space_name: space_name ?? spaceRoute,
				is_published: spec.is_published ?? true,
				...spaceFields,
			},
		);

		const namesBySpec = new Map<PageSpec, string>();
		for (const level of levelsOf(pages)) {
			const docs = level.map(({ spec: pageSpec, parent }) => {
				const { children, ...fields } = pageSpec;
				return {
					doctype: 'Wiki Document',
					is_published: true,
					content: `Content for ${pageSpec.title}`,
					...fields,
					parent_wiki_document: parent
						? namesBySpec.get(parent)
						: space.root_group,
				};
			});
			const names = await callMethod<string[]>(
				this.request,
				'frappe.client.insert_many',
				{ docs },
			);
			for (const [i, { spec: pageSpec }] of level.entries()) {
				namesBySpec.set(pageSpec, names[i]);
			}
		}

		const seeded = await this.readBack(namesBySpec, pages);
		const byTitle = new Map<string, SeededPage>();
		const index = (nodes: SeededPage[]) => {
			for (const node of nodes) {
				if (!byTitle.has(node.title)) byTitle.set(node.title, node);
				index(node.children);
			}
		};
		index(seeded);

		return {
			...space,
			route: spaceRoute,
			rootGroup: space.root_group,
			pages: seeded,
			page(title: string) {
				const found = byTitle.get(title);
				if (!found) {
					throw new Error(
						`No seeded page titled "${title}" in space ${spaceRoute}. ` +
							`Seeded: ${[...byTitle.keys()].join(', ') || '(none)'}`,
					);
				}
				return found;
			},
			url: (...segments: string[]) => appUrl('spaces', space.name, ...segments),
		};
	}

	/**
	 * One read to pick up what the server derived — routes, slugs, doc keys and
	 * auto-assigned sort orders — then rebuilt into the shape of the spec.
	 */
	private async readBack(
		namesBySpec: Map<PageSpec, string>,
		pages: PageSpec[],
	): Promise<SeededPage[]> {
		const names = [...namesBySpec.values()];
		if (!names.length) return [];

		const rows = await getList<WikiDocument>(this.request, 'Wiki Document', {
			fields: [
				'name',
				'title',
				'route',
				'slug',
				'doc_key',
				'is_group',
				'is_published',
				'sort_order',
				'parent_wiki_document',
			],
			filters: { name: ['in', names] },
			limit: 0,
		});
		const byName = new Map(rows.map((row) => [row.name, row]));

		const build = (specs: PageSpec[]): SeededPage[] =>
			specs.map((spec) => ({
				...(byName.get(namesBySpec.get(spec) as string) as WikiDocument),
				children: build(spec.children ?? []),
			}));
		return build(pages);
	}

	/**
	 * Destroy everything seeded through this factory.
	 *
	 * Spaces are resolved by route rather than by the create response, so a space
	 * the server made but whose response we never saw — a timed-out create, or a
	 * retry that seeded twice — is swept too. `Wiki Space.on_trash` cascades the
	 * document tree, revisions, sync logs and change requests, so a page a test
	 * created through the UI goes with it.
	 */
	async destroyAll(): Promise<void> {
		const routes = this.routes.splice(0);
		for (const route of routes) {
			await destroySpacesByRoute(this.request, route);
		}
	}
}

/** Delete every Wiki Space on `route`. Safe to call for a route that has none. */
export async function destroySpacesByRoute(
	request: APIRequestContext,
	route: string,
): Promise<void> {
	const found = await getList<{ name: string }>(request, 'Wiki Space', {
		fields: ['name'],
		filters: { route },
		limit: 0,
	}).catch(() => []);
	for (const space of found) {
		await deleteDoc(request, 'Wiki Space', space.name);
	}
}
