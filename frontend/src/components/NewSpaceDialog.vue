<template>
	<!-- Extracted whole from the retired space list page: this dialog, not the
	     list around it, was the page's real job. It owns its own insert so any
	     surface can open it — the sidebar footer, the Overview empty state —
	     and tell its own list to refresh through `created`. -->
	<Dialog
		v-model:open="isOpen"
		:title="__('Create Wiki Space')"
		size="lg"
		:actions="[
			{
				label: __('Create'),
				variant: 'solid',
				loading: creating,
				onClick: handleCreateSpace,
			},
		]"
	>
		<template #default>
			<div class="flex flex-col gap-4">
				<FormControl
					type="text"
					:label="__('Space Name')"
					v-model="newSpace.space_name"
					:placeholder="__('My Wiki Space')"
				/>
				<FormControl
					type="text"
					:label="__('Route')"
					required
					:modelValue="newSpace.route"
					@update:modelValue="handleRouteInput"
					:placeholder="__('my-wiki-space')"
					:description="__('The URL path for this wiki space (e.g., /my-wiki-space)')"
				/>

				<FormControl
					type="checkbox"
					:label="__('Synced from GitHub?')"
					v-model="newSpace.git_synced"
				/>

				<template v-if="newSpace.git_synced">
					<!-- Checking the connection + loading the account list right after the
					     box is ticked: keep the user informed instead of flashing UI. -->
					<div
						v-if="githubConnected.loading || installationsResource.loading"
						class="flex items-center gap-2 rounded-4 border border-outline-gray-2 p-3"
					>
						<span class="lucide-loader-2 h-4 w-4 animate-spin text-ink-gray-5" aria-hidden="true" />
						<span class="text-p-sm text-ink-gray-6">{{ __('Connecting to GitHub…') }}</span>
					</div>

					<template v-else>
						<!-- Not connected yet: kick off the GitHub App connect-account flow. -->
						<div
							v-if="!githubConnected.data"
							class="flex flex-col items-start gap-2 rounded-4 border border-outline-gray-2 p-3"
						>
							<p class="text-p-sm text-ink-gray-6">
								{{ __('Connect your GitHub account to pick a repository (private repos supported).') }}
							</p>
							<Button variant="subtle" :loading="githubConnected.loading" @click="connectGithub">
								<template #prefix>
									<span class="lucide-github h-4 w-4" aria-hidden="true" />
								</template>
								{{ __('Connect GitHub') }}
							</Button>
							<ErrorMessage :message="githubConnected.error" />
						</div>

						<!-- Connected but the App isn't installed anywhere yet: offer install. -->
						<div
							v-else-if="installationOptions.length === 0"
							class="flex flex-col items-start gap-2 rounded-4 border border-outline-gray-2 p-3"
						>
							<p class="text-p-sm text-ink-gray-6">
								{{ __('The GitHub App is not installed on any account yet. Install it on the account and repositories you want to sync.') }}
							</p>
							<Button variant="subtle" :loading="installationsResource.loading" @click="installApp">
								<template #prefix>
									<span class="lucide-github h-4 w-4" aria-hidden="true" />
								</template>
								{{ __('Install GitHub App') }}
							</Button>
							<ErrorMessage :message="appInstallUrl.error" />
						</div>

						<template v-else>
							<!-- Reveal one step at a time: account → repo → branch → folder.
							     The account picker always shows, even with a single (auto-
							     selected) installation: an org the App isn't installed on
							     yet is invisible otherwise, and "Add" is the way to get it. -->
							<div class="flex items-end gap-2">
								<Autocomplete
									class="flex-1"
									:label="__('GitHub Account or Organization')"
									:options="installationOptions"
									v-model="newSpace.github_installation_id"
									:placeholder="__('Select an account or organization')"
								/>
								<Button
									variant="subtle"
									:loading="installationsResource.loading"
									:tooltip="__('Install the GitHub App on another account or organization')"
									@click="installApp"
								>
									<template #prefix>
										<span class="lucide-plus h-4 w-4" aria-hidden="true" />
									</template>
									{{ __('Add') }}
								</Button>
							</div>

							<!-- First repo page after an account is chosen: spinner so the repo
							     field never appears empty with no hint that it's loading. -->
							<div
								v-if="reposInitialLoading"
								class="flex items-center gap-2 rounded-4 border border-outline-gray-2 p-3"
							>
								<span class="lucide-loader-2 h-4 w-4 animate-spin text-ink-gray-5" aria-hidden="true" />
								<span class="text-p-sm text-ink-gray-6">{{ __('Loading repositories…') }}</span>
							</div>

							<template v-else-if="newSpace.github_installation_id">
								<Autocomplete
									:label="__('Repository')"
									remote
									:options="repoOptions"
									v-model="newSpace.repo_full_name"
									:loading="repos.loading"
									:has-more="repos.hasMore"
									:placeholder="__('Search repositories…')"
									@search="(q) => loadRepos({ search: q, reset: true })"
									@load-more="loadRepos()"
								/>

								<Autocomplete
									v-if="newSpace.repo_full_name"
									allow-custom
									:label="__('Branch')"
									:options="branchOptions"
									v-model="newSpace.branch"
									:loading="branches.loading"
									:placeholder="__('main')"
								/>

								<FormControl
									v-if="newSpace.branch"
									type="text"
									:label="__('Docs folder')"
									v-model="newSpace.docs_subdir"
									:placeholder="__('docs')"
									:description="__('Folder in the repo to sync. Supports nested paths like docs/guide.')"
								/>
							</template>
							<ErrorMessage :message="installationsResource.error || repos.error || branches.error" />
						</template>
					</template>
				</template>

				<ErrorMessage :message="formError || spaces.insert.error" />
			</div>
		</template>
	</Dialog>
</template>

<script setup>
import Autocomplete from '@/components/Autocomplete.vue';
import {
	Button,
	Dialog,
	ErrorMessage,
	FormControl,
	createListResource,
	createResource,
	toast,
} from 'frappe-ui';
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

const emit = defineEmits(['created']);
const isOpen = defineModel({ type: Boolean });

const router = useRouter();

const creating = ref(false);
const routeManuallyEdited = ref(false);
const formError = ref('');

const newSpace = reactive({
	space_name: '',
	route: '',
	git_synced: false,
	github_installation_id: '',
	repo_full_name: '',
	branch: '',
	docs_subdir: 'docs',
});

// GitHub App connect + repo picker. The connect-account OAuth round-trip runs
// in a popup against `/github/authorize`; we poll `is_connected` until the
// user's token is cached server-side, then list their installations and repos.
const githubConnected = createResource({ url: 'wiki.api.github.is_connected' });
const installationsResource = createResource({
	url: 'wiki.api.github.my_installations',
	// A single account is the common case — pick it automatically so the form
	// collapses to repo-first (the account step hides when there's nothing to choose).
	onSuccess: (data) => {
		if ((data || []).length === 1) {
			// Bridge the gap to the first repo page so the spinner stays up instead of
			// flashing an empty repo field before loadRepos() (via the watch) kicks in.
			repos.loadedOnce = false;
			repos.loading = true;
			newSpace.github_installation_id = String(data[0].id);
		}
	},
});
const repositoriesResource = createResource({
	url: 'wiki.api.github.my_repositories',
});
const branchesResource = createResource({
	url: 'wiki.api.github.my_repo_branches',
});
const branchExistsResource = createResource({
	url: 'wiki.api.github.my_branch_exists',
});
const appInstallUrl = createResource({
	url: 'wiki.api.github.app_install_url',
});

const installationOptions = computed(() =>
	(installationsResource.data || []).map((i) => ({
		label: i.account_type ? `${i.account} (${i.account_type})` : i.account,
		value: String(i.id),
	})),
);

// Repos are paged from the server (a search/load-more list, not loaded all at
// once) so big orgs don't stall the dialog. `loadRepos` accumulates pages and
// resets when the search term changes.
const repos = reactive({
	list: [],
	page: 1,
	search: '',
	hasMore: false,
	loading: false,
	loadedOnce: false,
	error: null,
});

// Show the big "Loading repositories…" spinner only on the first load for an
// account — later searches keep the field visible and use its in-dropdown hint.
const reposInitialLoading = computed(
	() => !!newSpace.github_installation_id && repos.loading && !repos.loadedOnce,
);

async function loadRepos({ search, reset = false } = {}) {
	if (!newSpace.github_installation_id) return;
	if (search !== undefined) repos.search = search;
	if (reset) {
		repos.page = 1;
		repos.list = [];
	}
	repos.loading = true;
	repos.error = null;
	try {
		const res = await repositoriesResource.submit({
			installation_id: newSpace.github_installation_id,
			search: repos.search,
			page: repos.page,
		});
		const batch = res?.repositories || [];
		repos.list = repos.page === 1 ? batch : [...repos.list, ...batch];
		repos.hasMore = !!res?.has_more;
		if (repos.hasMore) repos.page += 1;
	} catch (error) {
		repos.error = error;
	} finally {
		repos.loading = false;
		repos.loadedOnce = true;
	}
}

const repoOptions = computed(() =>
	repos.list.map((r) => ({
		label: r.private ? `${r.full_name} 🔒` : r.full_name,
		value: r.full_name,
		default_branch: r.default_branch,
	})),
);

const branches = reactive({ list: [], loading: false, error: null });

async function loadBranches(fullName) {
	branches.list = [];
	if (!fullName) return;
	branches.loading = true;
	branches.error = null;
	try {
		branches.list =
			(await branchesResource.submit({ repo_full_name: fullName })) || [];
	} catch (error) {
		branches.error = error;
	} finally {
		branches.loading = false;
	}
}

const branchOptions = computed(() =>
	branches.list.map((b) => ({ label: b, value: b })),
);

// When the dialog reveals the Git-sync section, learn whether we're already
// connected (and if so, load the account list straight away).
watch(
	() => newSpace.git_synced,
	(synced) => {
		if (synced) {
			appInstallUrl.fetch();
			githubConnected.fetch().then(() => {
				if (githubConnected.data) installationsResource.fetch();
			});
		}
	},
);

// The App install also happens in a popup; poll installations until the new one
// appears, then select it — installing on an org is how that org shows up in
// the picker at all, so landing on it is the point of the trip.
function installApp() {
	const url = appInstallUrl.data;
	if (!url) {
		appInstallUrl.fetch();
		return;
	}
	const known = new Set(
		(installationsResource.data || []).map((i) => String(i.id)),
	);
	const popup = window.open(
		url,
		'github-install',
		'popup,width=720,height=760',
	);
	stopConnectPoll();
	connectPoll = setInterval(async () => {
		const closed = popup?.closed;
		await installationsResource.reload();
		const added = (installationsResource.data || []).find(
			(i) => !known.has(String(i.id)),
		);
		if (added) {
			stopConnectPoll();
			newSpace.github_installation_id = String(added.id);
			popup?.close();
			return;
		}
		if (closed) stopConnectPoll();
	}, 1500);
}

let connectPoll = null;
function stopConnectPoll() {
	if (connectPoll) {
		clearInterval(connectPoll);
		connectPoll = null;
	}
}

// The dialog now unmounts with whatever opened it, so the poll has to be torn
// down here rather than relying on a page that outlived it.
onBeforeUnmount(stopConnectPoll);

function connectGithub() {
	const popup = window.open(
		'/github/authorize',
		'github-connect',
		'popup,width=720,height=760',
	);
	githubConnected.loading = true;
	stopConnectPoll();
	connectPoll = setInterval(async () => {
		if (popup?.closed && !githubConnected.data) {
			stopConnectPoll();
			githubConnected.loading = false;
			return;
		}
		await githubConnected.reload();
		if (githubConnected.data) {
			stopConnectPoll();
			popup?.close();
			installationsResource.fetch();
		}
	}, 1500);
}

// Picking an account resets the downstream choices and loads its first repo page.
watch(
	() => newSpace.github_installation_id,
	(installationId) => {
		newSpace.repo_full_name = '';
		newSpace.branch = '';
		repos.loadedOnce = false;
		if (installationId) loadRepos({ search: '', reset: true });
	},
);

// Picking a repo defaults the branch to that repo's default branch and loads
// the rest of its branches for the selector.
watch(
	() => newSpace.repo_full_name,
	(fullName) => {
		const repo = repoOptions.value.find((r) => r.value === fullName);
		newSpace.branch = repo?.default_branch || '';
		loadBranches(fullName);
		if (fullName) formError.value = '';
	},
);

function slugify(text) {
	return text
		.toLowerCase()
		.trim()
		.replace(/[^\w\s-]/g, '')
		.replace(/[\s_-]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

watch(
	() => newSpace.space_name,
	(newName) => {
		if (!routeManuallyEdited.value) {
			newSpace.route = slugify(newName);
		}
	},
);

function handleRouteInput(value) {
	if (value !== slugify(newSpace.space_name)) {
		routeManuallyEdited.value = true;
	}
	newSpace.route = value;
	if (value) formError.value = '';
}

// Insert-only: the dialog never lists spaces, it just needs the doctype's
// insert. Whoever opened it refreshes their own list off `created`.
const spaces = createListResource({
	doctype: 'Wiki Space',
	auto: false,
	insert: {
		onSuccess: (doc) => {
			isOpen.value = false;
			resetForm();
			toast.success(
				__('Wiki Space "{0}" created successfully.', [doc.space_name]),
			);
			emit('created', doc);
			// Synced spaces kick off their first sync automatically on the space
			// detail page (see SpaceDetails), so just navigate there.
			router.push({ name: 'SpaceDetails', params: { spaceId: doc.name } });
		},
	},
});

function resetForm() {
	newSpace.space_name = '';
	newSpace.route = '';
	newSpace.git_synced = false;
	newSpace.github_installation_id = '';
	newSpace.repo_full_name = '';
	newSpace.branch = '';
	newSpace.docs_subdir = 'docs';
	repos.list = [];
	repos.loadedOnce = false;
	branches.list = [];
	formError.value = '';
	routeManuallyEdited.value = false;
}

// The branch field takes free text, so the name is only known to be real once
// GitHub says so — check it here rather than letting the first sync fail.
async function branchIsValid(repoFullName, branch) {
	try {
		return await branchExistsResource.submit({
			repo_full_name: repoFullName,
			branch,
		});
	} catch (error) {
		formError.value =
			error?.messages?.[0] ||
			error?.message ||
			__('Could not verify the branch on GitHub.');
		return false;
	}
}

const handleCreateSpace = async () => {
	// Surface validation through the dialog's ErrorMessage rather than a rejected
	// promise (which only ends up in the console). The dialog stays open either
	// way — it closes only on insert success.
	formError.value = '';
	if (!newSpace.route) {
		formError.value = __('Route is required.');
		return;
	}
	if (newSpace.git_synced && !newSpace.repo_full_name.trim()) {
		formError.value = __('Please pick a GitHub repository');
		return;
	}
	if (newSpace.git_synced && !newSpace.branch.trim()) {
		formError.value = __('Please pick or enter a branch');
		return;
	}

	const payload = {
		space_name: newSpace.space_name,
		route: newSpace.route,
		// New spaces are published by default, so start them as public read.
		// Guest covers everyone (anonymous + logged-in); admins can refine this
		// in Space Settings → Permissions.
		roles: [{ role: 'Guest', permission_level: 'Read' }],
	};

	if (newSpace.git_synced) {
		payload.git_synced = 1;
		payload.repo_full_name = newSpace.repo_full_name.trim();
		payload.branch = newSpace.branch.trim();
		if (newSpace.docs_subdir.trim()) {
			payload.docs_subdir = newSpace.docs_subdir.trim();
		}
		if (newSpace.github_installation_id) {
			payload.github_installation_id = newSpace.github_installation_id;
		}
	}

	creating.value = true;
	try {
		if (payload.git_synced) {
			const valid = await branchIsValid(payload.repo_full_name, payload.branch);
			if (!valid) {
				if (!formError.value) {
					formError.value = __('Branch "{0}" does not exist in {1}.', [
						payload.branch,
						payload.repo_full_name,
					]);
				}
				return;
			}
		}
		return await spaces.insert.submit(payload);
	} finally {
		creating.value = false;
	}
};
</script>
