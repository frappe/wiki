<template>
  <div class="flex flex-col gap-4 p-4 h-full">
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-semibold text-ink-gray-9">{{ __('Wiki Spaces') }}</h2>
      <div class="flex items-center gap-2">
        <FormControl
          type="text"
          v-model="searchQuery"
          :placeholder="__('Search spaces...')"
        >
          <template #prefix>
            <LucideSearch class="h-4 w-4 text-ink-gray-4" />
          </template>
        </FormControl>
        <Button v-if="isManager" variant="solid" @click="showCreateDialog = true">
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

      <ListView
        v-else
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
            :label="__('Git synced (read-only, content lives in a GitHub repo)')"
            v-model="newSpace.git_synced"
          />

          <template v-if="newSpace.git_synced">
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

            <!-- Connected: installation → repository → branch picker. -->
            <template v-else>
              <!-- Connected but the App isn't installed anywhere yet: offer install. -->
              <div
                v-if="!installationsResource.loading && installationOptions.length === 0"
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
                <!-- Native <select>: frappe-ui Autocomplete/Select portal their
                     dropdown, which the modal Dialog blocks (pointer-events:none). -->
                <div class="flex flex-col gap-1">
                  <span class="text-xs text-ink-gray-5">{{ __('GitHub Account') }}</span>
                  <select
                    v-model="newSpace.github_installation_id"
                    class="form-input w-full rounded bg-surface-gray-2 text-base text-ink-gray-8"
                  >
                    <option value="" disabled>
                      {{
                        installationsResource.loading
                          ? __('Loading accounts...')
                          : __('Select an account or organization')
                      }}
                    </option>
                    <option v-for="opt in installationOptions" :key="opt.value" :value="opt.value">
                      {{ opt.label }}
                    </option>
                  </select>
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-xs text-ink-gray-5">{{ __('Repository') }}</span>
                  <select
                    v-model="newSpace.repo_full_name"
                    :disabled="!newSpace.github_installation_id || repositoriesResource.loading"
                    class="form-input w-full rounded bg-surface-gray-2 text-base text-ink-gray-8"
                  >
                    <option value="" disabled>
                      {{
                        repositoriesResource.loading
                          ? __('Loading repositories...')
                          : __('Select a repository')
                      }}
                    </option>
                    <option v-for="opt in repoOptions" :key="opt.value" :value="opt.value">
                      {{ opt.label }}
                    </option>
                  </select>
                </div>
                <FormControl
                  type="text"
                  :label="__('Branch')"
                  v-model="newSpace.branch"
                  :placeholder="__('main')"
                />
                <FormControl
                  type="text"
                  :label="__('Docs folder (optional)')"
                  v-model="newSpace.docs_subdir"
                  :placeholder="__('e.g. docs — leave blank to scan the whole repo')"
                  :description="__('Limit the sync to a folder. Dot-directories like .github are always ignored.')"
                />
                <ErrorMessage :message="installationsResource.error || repositoriesResource.error" />
              </template>
            </template>
          </template>

          <ErrorMessage :message="spaces.insert.error" />
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
import { useUserStore } from "@/stores/user";

const router = useRouter();
const userStore = useUserStore();
const isManager = computed(() => userStore.isWikiManager);

const showCreateDialog = ref(false);
const routeManuallyEdited = ref(false);
const searchQuery = ref("");

const newSpace = reactive({
  space_name: "",
  route: "",
  git_synced: false,
  github_installation_id: "",
  repo_full_name: "",
  branch: "",
  docs_subdir: "",
});

// GitHub App connect + repo picker (TB4b). The connect-account OAuth round-trip
// runs in a popup against `/github/authorize`; we poll `is_connected` until the
// user's token is cached server-side, then list their installations and repos.
const githubConnected = createResource({ url: "wiki.api.github.is_connected" });
const installationsResource = createResource({ url: "wiki.api.github.my_installations" });
const repositoriesResource = createResource({ url: "wiki.api.github.my_repositories" });
const appInstallUrl = createResource({ url: "wiki.api.github.app_install_url" });

const installationOptions = computed(() =>
  (installationsResource.data || []).map((i) => ({
    label: i.account_type ? `${i.account} (${i.account_type})` : i.account,
    value: String(i.id),
  })),
);

const repoOptions = computed(() =>
  (repositoriesResource.data || []).map((r) => ({
    label: r.private ? `${r.full_name} 🔒` : r.full_name,
    value: r.full_name,
    default_branch: r.default_branch,
  })),
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

// Picking an account resets the repo and lists that installation's repos.
watch(
  () => newSpace.github_installation_id,
  (installationId) => {
    newSpace.repo_full_name = "";
    if (installationId) {
      repositoriesResource.fetch({ installation_id: installationId });
    }
  },
);

// Picking a repo defaults the branch to that repo's default branch.
watch(
  () => newSpace.repo_full_name,
  (fullName) => {
    const repo = repoOptions.value.find((r) => r.value === fullName);
    if (repo?.default_branch) newSpace.branch = repo.default_branch;
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
      newSpace.docs_subdir = "";
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
  if (!newSpace.route) {
    return Promise.reject(new Error("Route is required"));
  }
  if (newSpace.git_synced && !newSpace.repo_full_name.trim()) {
    return Promise.reject(new Error("Pick a repository for a git-synced space"));
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
