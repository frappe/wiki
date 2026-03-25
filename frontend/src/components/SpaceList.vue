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
        <template #cell="{ item, column }">
          <Badge
            v-if="column.key === 'is_published'"
            variant="subtle"
            :theme="item ? 'green' : 'orange'"
            size="sm"
            :label="item ? __('Published') : __('Unpublished')"
          />
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
  Button,
  Dialog,
  FormControl,
  ErrorMessage,
  Badge,
  toast
} from "frappe-ui";
import LucidePlus from "~icons/lucide/plus";
import LucideSearch from "~icons/lucide/search";
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
});

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
];

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
      routeManuallyEdited.value = false;
      toast.success(__('Wiki Space "{0}" created successfully.', [doc.space_name]));
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

  return spaces.insert.submit({
    space_name: newSpace.space_name,
    route: newSpace.route,
  });
};
</script>
