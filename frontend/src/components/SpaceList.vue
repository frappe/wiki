<template>
  <div class="flex flex-col gap-4 p-3 sm:p-4 h-full">
    <!-- On mobile the title lives in the top nav (next to the hamburger); on
         desktop it stays inline. -->
    <Teleport v-if="isMobile" to="#app-header">
      <h2 class="truncate text-base font-semibold text-ink-gray-9">{{ __('Wiki Spaces') }}</h2>
    </Teleport>
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h2 class="hidden sm:block text-xl font-semibold text-ink-gray-9">{{ __('Wiki Spaces') }}</h2>
      <div class="flex items-center gap-2">
        <FormControl
          class="flex-1 sm:flex-none sm:w-64"
          type="text"
          v-model="searchQuery"
          :placeholder="__('Search spaces...')"
        >
          <template #prefix>
            <LucideSearch class="h-4 w-4 text-ink-gray-4" />
          </template>
        </FormControl>
        <!-- Square icon button on mobile (a labelled button looks cramped next
             to the full-width search); labelled on desktop. -->
        <Button
          v-if="isManager && isMobile"
          variant="solid"
          icon="plus"
          :title="__('New Space')"
          @click="showCreateDialog = true"
        />
        <Button
          v-else-if="isManager"
          variant="solid"
          @click="showCreateDialog = true"
        >
          <template #prefix>
            <LucidePlus class="h-4 w-4" />
          </template>
          {{ __('New Space') }}
        </Button>
      </div>
    </div>

    <div class="flex-1 overflow-auto">
      <!-- Skeleton on cold load so the empty state never flashes before the
           first page of spaces arrives. -->
      <div v-if="spaces.list.loading && !spaces.data?.length" class="flex flex-col">
        <div
          v-for="n in 8"
          :key="n"
          class="grid grid-cols-[2fr_1fr_2fr_3fr] items-center gap-4 px-2 h-12 border-b border-outline-gray-1"
        >
          <div class="h-3.5 w-2/3 rounded bg-surface-gray-3 animate-pulse" />
          <div class="h-5 w-20 rounded-full bg-surface-gray-3 animate-pulse" />
          <div class="h-3.5 w-1/2 rounded bg-surface-gray-3 animate-pulse" />
          <div class="h-7 w-16 rounded bg-surface-gray-3 animate-pulse" />
        </div>
      </div>

      <!-- Tables stay tables on mobile and scroll horizontally (CRM pattern):
           the min-width keeps columns readable instead of compressing to mush. -->
      <div v-else class="min-w-[600px] sm:min-w-0">
      <ListView
        :columns="columns"
        :rows="spaces.data || []"
        :options="{
          selectable: false,
          showTooltip: true,
          resizeColumn: false,
          getRowRoute: (row) => ({ name: 'SpaceDetails', params: { spaceId: row.name } }),
          emptyState: searchQuery
            ? {
                title: __('No spaces found'),
                description: __('No wiki spaces matched your search'),
              }
            : {
                title: __('No Wiki Spaces'),
                description: isManager ? __('Create your first wiki space to get started') : __('No wiki spaces available'),
                button: isManager ? {
                  label: __('New Space'),
                  variant: 'solid',
                  onClick: () => (showCreateDialog = true),
                } : undefined,
              },
        }"
        row-key="name"
      >
        <template #cell="{ item, column, row }">
          <Badge
            v-if="column.key === 'is_published'"
            variant="subtle"
            :theme="item ? 'green' : 'orange'"
            size="sm"
            :label="item ? __('Published') : __('Unpublished')"
          />
          <div v-else-if="column.key === 'view'" class="flex items-center">
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
          <span v-else>{{ item }}</span>
        </template>
      </ListView>
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
      v-model="showCreateDialog"
      :options="{
        title: __('Create Wiki Space'),
        size: 'lg',
        actions: [
          {
            label: __('Create'),
            variant: 'solid',
            onClick: handleCreateSpace,
          },
        ],
      }"
    >
      <template #body-content>
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
              <LucideLoader2 class="h-4 w-4 animate-spin text-ink-gray-5" />
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
                    <LucideGithub class="h-4 w-4" />
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
                    <LucideGithub class="h-4 w-4" />
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
                  <LucideLoader2 class="h-4 w-4 animate-spin text-ink-gray-5" />
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
import { ref, reactive, watch, computed } from "vue";
import { useRouter } from "vue-router";
import {
  ListView,
  createListResource,
  createResource,
  Button,
  Dialog,
  FormControl,
  ErrorMessage,
  Badge,
  toast
} from "frappe-ui";
import LucidePlus from "~icons/lucide/plus";
import LucideSearch from "~icons/lucide/search";
import LucideGithub from "~icons/lucide/github";
import LucideLoader2 from "~icons/lucide/loader-2";
import { useUserStore } from "@/stores/user";
import { useMobile } from "@/composables/useMobile";
import Autocomplete from "@/components/Autocomplete.vue";

const router = useRouter();
const userStore = useUserStore();
const { isMobile } = useMobile();
const isManager = computed(() => userStore.isWikiManager);

const showCreateDialog = ref(false);
const routeManuallyEdited = ref(false);
const searchQuery = ref("");
const formError = ref("");

const newSpace = reactive({
  space_name: "",
  route: "",
  git_synced: false,
  github_installation_id: "",
  repo_full_name: "",
  branch: "",
  docs_subdir: "docs",
});

// GitHub App connect + repo picker (TB4b). The connect-account OAuth round-trip
// runs in a popup against `/github/authorize`; we poll `is_connected` until the
// user's token is cached server-side, then list their installations and repos.
const githubConnected = createResource({ url: "wiki.api.github.is_connected" });
const installationsResource = createResource({
  url: "wiki.api.github.my_installations",
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
const repositoriesResource = createResource({ url: "wiki.api.github.my_repositories" });
const branchesResource = createResource({ url: "wiki.api.github.my_repo_branches" });
const appInstallUrl = createResource({ url: "wiki.api.github.app_install_url" });

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
  search: "",
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
    branches.list = (await branchesResource.submit({ repo_full_name: fullName })) || [];
  } catch (error) {
    branches.error = error;
  } finally {
    branches.loading = false;
  }
}

const branchOptions = computed(() => branches.list.map((b) => ({ label: b, value: b })));

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
  const popup = window.open(url, "github-install", "popup,width=720,height=760");
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
    "/github/authorize",
    "github-connect",
    "popup,width=720,height=760",
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
    newSpace.repo_full_name = "";
    newSpace.branch = "";
    repos.loadedOnce = false;
    if (installationId) loadRepos({ search: "", reset: true });
  },
);

// Picking a repo defaults the branch to that repo's default branch and loads
// the rest of its branches for the selector.
watch(
  () => newSpace.repo_full_name,
  (fullName) => {
    const repo = repoOptions.value.find((r) => r.value === fullName);
    newSpace.branch = repo?.default_branch || "";
    loadBranches(fullName);
    if (fullName) formError.value = "";
  },
);

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

watch(
  () => newSpace.space_name,
  (newName) => {
    if (!routeManuallyEdited.value) {
      newSpace.route = slugify(newName);
    }
  }
);

function handleRouteInput(value) {
  if (value !== slugify(newSpace.space_name)) {
    routeManuallyEdited.value = true;
  }
  newSpace.route = value;
  if (value) formError.value = "";
}

const columns = [
  {
    label: __("Name"),
    key: "space_name",
    width: 2,
  },
  {
    label: __("Status"),
    key: "is_published",
    width: 1,
  },
  {
    label: __("Route"),
    key: "route",
    width: 2,
  },
  {
    // Wide last column, left-aligned: keeps the View buttons in one straight
    // column that starts right after the route rather than hugging the far edge.
    label: "",
    key: "view",
    width: 3,
    align: "left",
  },
];

// Open the space's public-facing reader. The reader lives at the site root
// (`/<route>`), outside the `/wiki` editor SPA, so it can't go through the
// router — a new tab keeps the editor session intact.
function viewSpace(row) {
  window.open(`/${row.route}`, "_blank", "noopener");
}

const spaces = createListResource({
  doctype: "Wiki Space",
  fields: ["name", "space_name", "route", "root_group", "is_published"],
  orderBy: "creation desc",
  pageLength: 25,
  auto: true,
  insert: {
    onSuccess: (doc) => {
      showCreateDialog.value = false;
      newSpace.space_name = "";
      newSpace.route = "";
      newSpace.git_synced = false;
      newSpace.github_installation_id = "";
      newSpace.repo_full_name = "";
      newSpace.branch = "";
      newSpace.docs_subdir = "docs";
      repos.list = [];
      repos.loadedOnce = false;
      branches.list = [];
      formError.value = "";
      routeManuallyEdited.value = false;
      toast.success(__('Wiki Space "{0}" created successfully.', [doc.space_name]));
      // Synced spaces kick off their first sync automatically on the space
      // detail page (see SpaceDetails), so just navigate there.
      router.push({ name: "SpaceDetails", params: { spaceId: doc.name } });
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
            ["space_name", "like", `%${value}%`],
            ["route", "like", `%${value}%`],
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
  formError.value = "";
  if (!newSpace.route) {
    formError.value = __("Route is required.");
    return;
  }
  if (newSpace.git_synced && !newSpace.repo_full_name.trim()) {
    formError.value = __("Please pick a GitHub repository");
    return;
  }

  const payload = {
    space_name: newSpace.space_name,
    route: newSpace.route,
    // New spaces are published by default, so start them as public read.
    // Guest covers everyone (anonymous + logged-in); admins can refine this
    // in Space Settings → Permissions.
    roles: [{ role: "Guest", permission_level: "Read" }],
  };

  if (newSpace.git_synced) {
    payload.git_synced = 1;
    payload.repo_full_name = newSpace.repo_full_name.trim();
    payload.branch = newSpace.branch.trim() || "main";
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
