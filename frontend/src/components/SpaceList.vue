<template>
  <div class="flex flex-col gap-4 p-3 sm:p-4 h-full">
    <!-- Header renders into the shell's PageHeaderTarget (pinned above the
         page): centered-title mobile variant with the app menu, or the
         desktop strip with search + New Space. -->
    <PageHeaderMobile v-if="isMobile" :title="__('Wiki Spaces')">
      <template #right>
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
      <div class="flex items-center gap-2">
        <FormControl
          class="w-64"
          type="text"
          v-model="searchQuery"
          :placeholder="__('Search spaces...')"
        >
          <template #prefix>
            <span class="lucide-search h-4 w-4 text-ink-gray-4" aria-hidden="true" />
          </template>
        </FormControl>
        <Button
          v-if="isManager"
          variant="solid"
          @click="showCreateDialog = true"
        >
          <template #prefix>
            <span class="lucide-plus h-4 w-4" aria-hidden="true" />
          </template>
          {{ __('New Space') }}
        </Button>
      </div>
    </PageHeader>
    <!-- Mobile keeps an inline search row (the centered header has no room). -->
    <FormControl
      v-if="isMobile"
      type="text"
      v-model="searchQuery"
      :placeholder="__('Search spaces...')"
    >
      <template #prefix>
        <span class="lucide-search h-4 w-4 text-ink-gray-4" aria-hidden="true" />
      </template>
    </FormControl>

    <div class="flex-1 overflow-auto">
      <!-- Skeleton on cold load so the empty state never flashes before the
           first page of spaces arrives. -->
      <div v-if="spaces.list.loading && !spaces.data?.length" class="flex flex-col">
        <div
          v-for="n in 8"
          :key="n"
          class="grid grid-cols-[2fr_1fr_2fr_3fr] items-center gap-4 px-2 h-12 border-b border-outline-gray-1"
        >
          <Skeleton class="h-3.5 w-2/3 rounded" />
          <Skeleton class="h-5 w-20 rounded-full" />
          <Skeleton class="h-3.5 w-1/2 rounded" />
          <Skeleton class="h-7 w-16 rounded" />
        </div>
      </div>

      <!-- The List family owns geometry only; empty states are app-authored. -->
      <div
        v-else-if="!(spaces.data || []).length"
        class="flex flex-col items-center justify-center py-16 text-center"
      >
        <p class="text-lg-medium text-ink-gray-7">
          {{ searchQuery ? __('No spaces found') : __('No Wiki Spaces') }}
        </p>
        <p class="mt-1 max-w-sm text-p-sm text-ink-gray-5">
          {{
            searchQuery
              ? __('No wiki spaces matched your search')
              : isManager
                ? __('Create your first wiki space to get started')
                : __('No wiki spaces available')
          }}
        </p>
        <Button
          v-if="isManager && !searchQuery"
          class="mt-4"
          variant="solid"
          :label="__('New Space')"
          @click="showCreateDialog = true"
        />
      </div>

      <!-- Tables stay tables on mobile and scroll horizontally: the min-width
           keeps columns readable instead of compressing to mush. -->
      <div v-else class="min-w-[600px] sm:min-w-0">
        <List :columns="tracks" :row-height="40">
          <ListHeader>
            <ListHeaderCell v-for="col in columns" :key="col.key">
              {{ col.label }}
            </ListHeaderCell>
          </ListHeader>
          <ListRows :items="spaces.data || []" row-key="name" v-slot="{ item: row }">
            <ListRow :to="{ name: 'SpaceDetails', params: { spaceId: row.name } }">
              <ListCell v-for="col in columns" :key="col.key">
                <Badge
                  v-if="col.key === 'is_published'"
                  variant="subtle"
                  :theme="row.is_published ? 'green' : 'orange'"
                  size="sm"
                  :label="row.is_published ? __('Published') : __('Unpublished')"
                />
                <div v-else-if="col.key === 'view'" class="flex items-center">
                  <!-- Rows are router-links (an <a>); .stop alone won't stop the browser
                       from following the row href, so .prevent is required too. -->
                  <Button
                    v-if="row.is_published"
                    variant="ghost"
                    size="sm"
                    icon-left="external-link"
                    @click.stop.prevent="viewSpace(row)"
                  >
                    {{ __('View') }}
                  </Button>
                </div>
                <!-- Cells don't inherit an ink color from the List family, so an
                     explicit token is required or the text goes black in dark mode. -->
                <span
                  v-else
                  class="truncate"
                  :class="col.key === 'space_name' ? 'text-ink-gray-9' : 'text-ink-gray-7'"
                  :title="row[col.key]"
                  >{{ row[col.key] }}</span
                >
              </ListCell>
            </ListRow>
          </ListRows>
        </List>
      </div>

      <div v-if="spaces.hasNextPage" class="flex px-2 py-2">
        <Button
          @click="() => spaces.next()"
          :loading="spaces.list.loading"
          :label="__('Load more')"
          icon-left="refresh-cw"
        />
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
              class="flex items-center gap-2 rounded border border-outline-gray-2 p-3"
            >
              <span class="lucide-loader-2 h-4 w-4 animate-spin text-ink-gray-5" aria-hidden="true" />
              <span class="text-p-sm text-ink-gray-6">{{ __('Connecting to GitHub…') }}</span>
            </div>

            <template v-else>
              <!-- Not connected yet: kick off the GitHub App connect-account flow. -->
              <div
                v-if="!githubConnected.data"
                class="flex flex-col items-start gap-2 rounded border border-outline-gray-2 p-3"
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
                class="flex flex-col items-start gap-2 rounded border border-outline-gray-2 p-3"
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
                     A single account is auto-selected, so the picker collapses to
                     repo-first in the common case. -->
                <Autocomplete
                  v-if="installationOptions.length > 1"
                  :label="__('GitHub Account')"
                  :options="installationOptions"
                  v-model="newSpace.github_installation_id"
                  :placeholder="__('Select an account or organization')"
                />

                <!-- First repo page after an account is chosen: spinner so the repo
                     field never appears empty with no hint that it's loading. -->
                <div
                  v-if="reposInitialLoading"
                  class="flex items-center gap-2 rounded border border-outline-gray-2 p-3"
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
	Badge,
	Button,
	Dialog,
	ErrorMessage,
	FormControl,
	PageHeader,
	PageHeaderMobile,
	Skeleton,
	createListResource,
	createResource,
	toast,
} from 'frappe-ui';
import {
	List,
	ListCell,
	ListHeader,
	ListHeaderCell,
	ListRow,
	ListRows,
} from 'frappe-ui/list';
import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const userStore = useUserStore();
const { isMobile } = useMobile();
const isManager = computed(() => userStore.isWikiManager);

const showCreateDialog = ref(false);
const routeManuallyEdited = ref(false);
const searchQuery = ref('');
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

// The App install also happens in a popup; poll installations until it appears.
function installApp() {
	const url = appInstallUrl.data;
	if (!url) {
		appInstallUrl.fetch();
		return;
	}
	const popup = window.open(
		url,
		'github-install',
		'popup,width=720,height=760',
	);
	stopConnectPoll();
	connectPoll = setInterval(async () => {
		if (popup && popup.closed) {
			stopConnectPoll();
			installationsResource.reload();
			return;
		}
		await installationsResource.reload();
		if ((installationsResource.data || []).length > 0) {
			stopConnectPoll();
			popup?.close();
		}
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

const columns = [
	{
		label: __('Name'),
		key: 'space_name',
		width: 2,
	},
	{
		label: __('Status'),
		key: 'is_published',
		width: 1,
	},
	{
		label: __('Route'),
		key: 'route',
		width: 2,
	},
	{
		// Wide last column, left-aligned: keeps the View buttons in one straight
		// column that starts right after the route rather than hugging the far edge.
		label: '',
		key: 'view',
		width: 3,
		align: 'left',
	},
];

// Numeric width = fr weight, translated into the List grid template.
const tracks = columns.map((col) =>
	typeof col.width === 'number' ? `minmax(0,${col.width}fr)` : col.width,
);

// Open the space's public-facing reader. The reader lives at the site root
// (`/<route>`), outside the `/wiki-app` editor SPA, so it can't go through the
// router — a new tab keeps the editor session intact.
function viewSpace(row) {
	window.open(`/${row.route}`, '_blank', 'noopener');
}

const spaces = createListResource({
	doctype: 'Wiki Space',
	fields: ['name', 'space_name', 'route', 'root_group', 'is_published'],
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

let searchDebounceTimer = null;
watch(searchQuery, (value) => {
	clearTimeout(searchDebounceTimer);
	searchDebounceTimer = setTimeout(() => {
		spaces.update({
			filters: {},
			orFilters: value
				? [
						['space_name', 'like', `%${value}%`],
						['route', 'like', `%${value}%`],
					]
				: [],
			start: 0,
		});
		spaces.reload();
	}, 300);
});

const handleCreateSpace = () => {
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

	const payload = {
		space_name: newSpace.space_name,
		route: newSpace.route,
		// No role rows = open to all logged-in users (there's no public/anonymous
		// option anymore -- Guest is never granted access). Admins can restrict
		// this further in Space Settings → Permissions.
		roles: [],
	};

	if (newSpace.git_synced) {
		payload.git_synced = 1;
		payload.repo_full_name = newSpace.repo_full_name.trim();
		payload.branch = newSpace.branch.trim() || 'main';
		if (newSpace.docs_subdir.trim()) {
			payload.docs_subdir = newSpace.docs_subdir.trim();
		}
		if (newSpace.github_installation_id) {
			payload.github_installation_id = newSpace.github_installation_id;
		}
	}

	return spaces.insert.submit(payload);
};
</script>
