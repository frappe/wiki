<template>
  <div class="flex flex-col gap-4 p-3 sm:p-4 h-full">
    <!-- Header renders into the shell's PageHeaderTarget (pinned above the
         page): centered-title mobile variant with the app menu, or the
         desktop strip with search + New Space. -->
    <PageHeaderMobile v-if="isMobile" :title="__('Wiki Spaces')">
      <template #suffix>
        <div class="flex items-center gap-1">
          <Button
            v-if="isManager"
            variant="ghost"
            icon="lucide-plus"
            :label="__('New Space')"
            @click="showCreateDialog = true"
          />
          <MobileAppMenu />
        </div>
      </template>
    </PageHeaderMobile>
    <PageHeader v-else>
      <h2 class="text-lg-semibold text-ink-gray-9">{{ __('Wiki Spaces') }}</h2>
      <Button v-if="isManager" variant="solid" @click="showCreateDialog = true">
        <template #prefix>
          <span class="lucide-plus h-4 w-4" aria-hidden="true" />
        </template>
        {{ __('New Space') }}
      </Button>
    </PageHeader>

    <!-- Feed rows are short, so the list reads as a centered column rather than
         a full-bleed table: at pane width the trailing cells drift a screen
         away from the titles they belong to. -->
    <div
      class="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 overflow-hidden"
    >
      <!-- Search first, then the filter, with the tally on the far side. The
           row wraps on mobile: search takes the first line on its own. -->
      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <FormControl
          class="w-full sm:w-56"
          type="text"
          v-model="searchQuery"
          :placeholder="__('Search spaces...')"
        >
          <template #prefix>
            <span class="lucide-search h-4 w-4 text-ink-gray-4" aria-hidden="true" />
          </template>
        </FormControl>
        <TabButtons v-model="publishedFilter" :options="filterOptions" />
        <span class="ml-auto shrink-0 text-sm text-ink-gray-5">
          {{ spaceCountLabel }}
        </span>
      </div>

      <div class="flex-1 overflow-auto">
        <!-- The List family owns geometry only; empty states are app-authored. -->
        <div
          v-if="!isFirstLoad && !(spaces.data || []).length"
          class="flex flex-col items-center justify-center py-16 text-center"
        >
          <p class="text-lg-medium text-ink-gray-7">
            {{ isFiltered ? __('No spaces found') : __('No Wiki Spaces') }}
          </p>
          <p class="mt-1 max-w-sm text-p-sm text-ink-gray-5">
            {{
              isFiltered
                ? __('No wiki spaces match the current filters')
                : isManager
                  ? __('Create your first wiki space to get started')
                  : __('No wiki spaces available')
            }}
          </p>
          <Button
            v-if="isManager && !isFiltered"
            class="mt-4"
            variant="solid"
            :label="__('New Space')"
            @click="showCreateDialog = true"
          />
        </div>

        <!-- Feed content in a column grid: the avatar and the two-line title
             stay a feed, but the page count and the status each get their own
             track so they line up down the list instead of stacking in one
             trailing cell. `divider="inset"` keeps the feed's rule (columns
             would otherwise default it to full width); `list-row-px-3` sets
             the content inset on the List, which flows to the rows.
             Cold-load skeletons render inside the same List, so the geometry
             is declared once and rows can't shift when the data lands. -->
        <List
          v-else
          :columns="['auto', 'minmax(0,1fr)', '5.5rem', '7rem']"
          :row-height="64"
          divider="inset"
          class="list-row-px-3 max-sm:list-cols-[auto_minmax(0,1fr)_auto]"
        >
          <template v-if="isFirstLoad">
            <ListRow v-for="n in SKELETON_ROWS" :key="n">
              <ListCell>
                <Skeleton
                  class="size-10 rounded-8"
                  :style="{ animationDelay: `${n * 60}ms` }"
                />
              </ListCell>
              <ListCell>
                <div class="min-w-0 flex-1">
                  <Skeleton
                    class="h-4 w-1/3 rounded-4"
                    :style="{ animationDelay: `${n * 60}ms` }"
                  />
                  <Skeleton
                    class="mt-1.5 h-3 w-1/4 rounded-4"
                    :style="{ animationDelay: `${n * 60}ms` }"
                  />
                </div>
              </ListCell>
              <ListCell class="max-sm:hidden justify-end">
                <Skeleton
                  class="h-3.5 w-14 rounded-4"
                  :style="{ animationDelay: `${n * 60}ms` }"
                />
              </ListCell>
              <ListCell class="justify-end">
                <Skeleton
                  class="h-5 w-20 rounded-full"
                  :style="{ animationDelay: `${n * 60}ms` }"
                />
              </ListCell>
            </ListRow>
          </template>

          <ListRows v-else :items="spaces.data || []" v-slot="{ item: row }">
            <ListRow :to="{ name: 'SpaceDetails', params: { spaceId: row.name } }">
              <ListCell>
                <Avatar
                  shape="square"
                  size="2xl"
                  :image="row.app_switcher_logo"
                  :label="row.space_name"
                />
              </ListCell>
              <!-- Cells don't inherit an ink color from the List family, so an
                   explicit token is required or the text goes black in dark mode. -->
              <ListCell>
                <div class="min-w-0">
                  <div class="truncate text-base text-ink-gray-8">
                    {{ row.space_name }}
                  </div>
                  <div class="mt-0.5 truncate text-sm text-ink-gray-5">
                    /{{ row.route }}
                  </div>
                </div>
              </ListCell>
              <!-- The narrowest column: dropped on mobile, where the status
                   badge is the one thing worth the width. -->
              <ListCell class="max-sm:hidden justify-end">
                <span class="text-sm text-ink-gray-5">
                  {{ pageCountLabel(row.name) }}
                </span>
              </ListCell>
              <ListCell class="justify-end">
                <Badge
                  variant="subtle"
                  :theme="row.is_published ? 'green' : 'amber'"
                  size="sm"
                  :label="row.is_published ? __('Published') : __('Unpublished')"
                />
              </ListCell>
            </ListRow>
          </ListRows>
        </List>

        <div v-if="spaces.hasNextPage" class="flex px-2 py-2">
          <Button
            @click="() => spaces.next()"
            :loading="spaces.list.loading"
            :label="__('Load more')"
            icon-left="lucide-refresh-cw"
          />
        </div>
      </div>
    </div>

    <Dialog
      v-model:open="showCreateDialog"
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
  </div>
</template>

<script setup>
import Autocomplete from '@/components/Autocomplete.vue';
import MobileAppMenu from '@/components/MobileAppMenu.vue';
import { useMobile } from '@/composables/useMobile';
import { useUserStore } from '@/stores/user';
import {
	Avatar,
	Badge,
	Button,
	Dialog,
	ErrorMessage,
	FormControl,
	PageHeader,
	PageHeaderMobile,
	Skeleton,
	TabButtons,
	createListResource,
	createResource,
	toast,
} from 'frappe-ui';
import { List, ListCell, ListRow, ListRows } from 'frappe-ui/list';
import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const userStore = useUserStore();
const { isMobile } = useMobile();
const isManager = computed(() => userStore.isWikiManager);

const showCreateDialog = ref(false);
const creating = ref(false);
const routeManuallyEdited = ref(false);
const searchQuery = ref('');
const publishedFilter = ref('all');
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

// GitHub App connect + repo picker (TB4b). The connect-account OAuth round-trip
// runs in a popup against `/github/authorize`; we poll `is_connected` until the
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
		const closed = popup && popup.closed;
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

function connectGithub() {
	const popup = window.open(
		'/github/authorize',
		'github-connect',
		'popup,width=720,height=760',
	);
	githubConnected.loading = true;
	stopConnectPoll();
	connectPoll = setInterval(async () => {
		if (popup && popup.closed && !githubConnected.data) {
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

const SKELETON_ROWS = 8;

const spaces = createListResource({
	doctype: 'Wiki Space',
	fields: [
		'name',
		'space_name',
		'route',
		'root_group',
		'is_published',
		'app_switcher_logo',
	],
	orderBy: 'creation desc',
	pageLength: 25,
	auto: true,
	insert: {
		onSuccess: (doc) => {
			showCreateDialog.value = false;
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
			toast.success(
				__('Wiki Space "{0}" created successfully.', [doc.space_name]),
			);
			// Synced spaces kick off their first sync automatically on the space
			// detail page (see SpaceDetails), so just navigate there.
			router.push({ name: 'SpaceDetails', params: { spaceId: doc.name } });
		},
	},
});

// Page counts come from one grouped query instead of a field on the list: Wiki
// Space stores no count, and a call per row would scale with the page size.
// They accumulate across pages because `Load more` appends to the same list.
const pageCounts = ref({});
const requestedCounts = new Set();

const pageCountsResource = createResource({
	url: 'wiki.api.wiki_space.get_space_page_counts',
});

async function fetchPageCounts(names) {
	const counts = await pageCountsResource.submit({ spaces: names });
	// Spaces with no pages are absent from the grouped response, so fill the
	// names asked for in at zero. A key that is still missing means "not fetched
	// yet" and renders blank, rather than flashing a wrong 0.
	pageCounts.value = {
		...pageCounts.value,
		...Object.fromEntries(names.map((name) => [name, counts[name] || 0])),
	};
}

watch(
	() => (spaces.data || []).map((row) => row.name),
	(names) => {
		const missing = names.filter((name) => !requestedCounts.has(name));
		if (!missing.length) return;
		for (const name of missing) requestedCounts.add(name);
		fetchPageCounts(missing);
	},
	{ immediate: true },
);

function pageCountLabel(name) {
	const count = pageCounts.value[name];
	if (count === undefined) return '';
	return count === 1 ? __('1 page') : __('{0} pages', [count]);
}

// Cold load only: once a page has landed, refetches keep the rows on screen
// instead of flashing back to skeletons.
const isFirstLoad = computed(() => spaces.list.loading && !spaces.data?.length);

// Drives the empty state's wording: nothing to show because of a search or a
// filter reads differently from a wiki with no spaces in it yet.
const isFiltered = computed(
	() => !!searchQuery.value || publishedFilter.value !== 'all',
);

const filterOptions = computed(() => [
	{ label: __('All'), value: 'all' },
	{ label: __('Published'), value: 'published' },
	{ label: __('Unpublished'), value: 'unpublished' },
]);

// The tally counts what the list is showing, so it takes the same three inputs
// and has to be refetched alongside every reload.
const spaceCount = createResource({ url: 'wiki.api.wiki_space.get_space_count' });

const spaceCountLabel = computed(() => {
	const count = spaceCount.data;
	if (count === undefined || count === null) return '';
	return count === 1 ? __('1 space') : __('{0} spaces', [count]);
});

function applyFilters() {
	const search = searchQuery.value;
	spaces.update({
		filters:
			publishedFilter.value === 'all'
				? {}
				: { is_published: publishedFilter.value === 'published' ? 1 : 0 },
		orFilters: search
			? [
					['space_name', 'like', `%${search}%`],
					['route', 'like', `%${search}%`],
				]
			: [],
		start: 0,
	});
	spaces.reload();
	spaceCount.submit({ search, published: publishedFilter.value });
}

// Typing debounces; clicking a filter does not — a segmented control gives one
// event per choice, and waiting on it would just feel unresponsive.
let searchDebounceTimer = null;
watch(searchQuery, () => {
	clearTimeout(searchDebounceTimer);
	searchDebounceTimer = setTimeout(applyFilters, 300);
});

watch(publishedFilter, () => {
	clearTimeout(searchDebounceTimer);
	applyFilters();
});

spaceCount.submit({ search: '', published: 'all' });

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
