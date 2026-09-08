<template>
	<!-- Placeholder landing page. The route name is `Overview` from day one so
	     the sidebar's Overview item never has to be repointed, but the wiki-wide
	     analytics that belong here come later.
	     It still carries two jobs the retired list page owned: the empty-wiki
	     state, and the only space list on mobile — where the sidebar this page
	     sits beside does not exist. -->
	<div class="flex h-full flex-col">
		<PageHeaderMobile v-if="isMobile" :title="__('All Spaces')">
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
		<!-- No New Space action on the desktop header: the sidebar footer button
		     sits an inch away and owns it. Mobile has no sidebar, so there the
		     header keeps it. -->
		<PageHeader v-else>
			<h2 class="text-lg-semibold text-ink-gray-9">{{ __('All Spaces') }}</h2>
		</PageHeader>

		<ScrollArea class="min-h-0 flex-1">
			<div class="mx-auto w-full max-w-3xl px-4 py-6">
				<!-- A wiki with no spaces at all is the one state that needs saying
				     out loud; every other empty result is a search that missed. -->
				<div
					v-if="isEmptyWiki"
					class="flex flex-col items-center justify-center py-16 text-center"
				>
					<p class="text-lg-medium text-ink-gray-7">
						{{ __('No Wiki Spaces') }}
					</p>
					<p class="mt-1 max-w-sm text-p-sm text-ink-gray-5">
						{{ emptyWikiHint }}
					</p>
					<Button
						v-if="isManager && isMobile"
						class="mt-4"
						variant="solid"
						:label="__('New Space')"
						@click="showCreateDialog = true"
					/>
				</div>

				<template v-else>
					<!-- Filter and search sit on one row: both narrow the same
					     list, and both are server-side, so a result count below
					     them would only ever describe the page that is loaded. -->
					<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
						<TabButtons v-model="publishState" :options="publishOptions" />
						<TextInput
							class="w-full sm:w-64"
							type="text"
							v-model="searchQuery"
							:placeholder="__('Search spaces...')"
						>
							<template #prefix>
								<span
									class="lucide-search size-4 text-ink-gray-4"
									aria-hidden="true"
								/>
							</template>
						</TextInput>
					</div>

					<p
						v-if="!spaces.loading && !orderedSpaces.length"
						class="py-16 text-center text-p-sm text-ink-gray-5"
					>
						{{ __('No spaces found') }}
					</p>

					<!-- Mobile keeps the identity column and the date; pages and
					     change requests are the two that can go, and the max-sm
					     track list here has to stay in step with that choice. -->
					<List
						v-else
						:columns="['minmax(0,1fr)', '10rem', '8rem']"
						:row-height="60"
						class="w-full list-row-px-3 max-sm:list-cols-[minmax(0,1fr)_auto]"
					>
						<!-- `!hidden`: the family sets `display: grid` at attribute
						     specificity, which a plain `hidden` utility ties with and
						     loses to on order. -->
						<ListHeader class="max-sm:!hidden">
							<ListHeaderCell>{{ __('Space') }}</ListHeaderCell>
							<!-- No header. The counts label themselves -- a unit word on
							     the pages figure, the Change Requests glyph on the other
							     -- so a title above them would only repeat that. -->
							<ListHeaderCell class="max-sm:hidden" />
							<ListHeaderCell class="justify-end">
								{{ __('Last Updated') }}
							</ListHeaderCell>
						</ListHeader>

						<ListRow
							v-for="space in orderedSpaces"
							:key="space.name"
							:to="{ name: 'SpaceDetails', params: { spaceId: space.name } }"
						>
							<ListCell>
								<SpaceAvatar
									class="shrink-0"
									:space="space"
									:label="space.space_name || space.name"
									size="lg"
								/>
								<div class="ml-3 min-w-0 flex-1">
									<div class="flex min-w-0 items-center gap-1.5">
										<span class="truncate text-base text-ink-gray-8">
											{{ space.space_name || space.name }}
										</span>
										<Tooltip v-if="isPinned(space.name)" :text="__('Pinned to top')">
											<span class="lucide-pin size-3.5 shrink-0 text-ink-gray-5" aria-hidden="true" />
										</Tooltip>
										<Tooltip v-if="space.git_synced" :text="__('Synced from GitHub')">
											<span class="lucide-folder-git-2 size-3.5 shrink-0 text-ink-gray-4" aria-hidden="true" />
										</Tooltip>
										<Tooltip v-if="restrictedSpaces.has(space.name)" :text="__('Restricted access')">
											<span class="lucide-lock size-3.5 shrink-0 text-ink-gray-4" aria-hidden="true" />
										</Tooltip>
										<Tooltip v-if="!space.is_published" :text="__('Unpublished')">
											<span class="lucide-eye-off size-3.5 shrink-0 text-ink-gray-4" aria-hidden="true" />
										</Tooltip>
									</div>
									<div class="mt-1.5 truncate text-sm text-ink-gray-5">
										/{{ space.route }}
									</div>
								</div>
							</ListCell>

							<!-- Both figures in one column, because they answer the same
							     question: how much is here, and how much is moving. An
							     open-request count of zero is dropped rather than drawn --
							     "nothing outstanding" reads faster as an absence than as a
							     number to compare against its neighbours. -->
							<ListCell class="max-sm:hidden">
								<div class="flex items-center gap-3 text-sm text-ink-gray-5">
									<span class="flex items-center gap-1.5 whitespace-nowrap">
										<span
											class="lucide-file-text size-3.5 shrink-0 text-ink-gray-4"
											aria-hidden="true"
										/>
										{{ pageCountLabel(statsFor(space.name).pages) }}
									</span>
									<Tooltip
										v-if="statsFor(space.name).open_change_requests"
										:text="
											__('{0} open change requests', [
												statsFor(space.name).open_change_requests,
											])
										"
									>
										<span class="flex items-center gap-1.5 whitespace-nowrap">
											<span
												class="lucide-git-branch size-3.5 shrink-0 text-ink-gray-4"
												aria-hidden="true"
											/>
											{{ statsFor(space.name).open_change_requests }}
										</span>
									</Tooltip>
								</div>
							</ListCell>

							<ListCell class="justify-end">
								<span
									class="truncate text-sm text-ink-gray-5"
									:title="formatDateTime(statsFor(space.name).last_updated)"
								>
									{{ fromNow(statsFor(space.name).last_updated) }}
								</span>
							</ListCell>
						</ListRow>
					</List>

					<!-- The directory pages in fifties, so this button lands under a
					     long list and needs to read as a control rather than as one
					     more line of it. -->
					<div v-if="spaces.hasNextPage" class="mt-6 flex justify-center">
						<Button
							variant="subtle"
							:label="__('Load more')"
							:loading="spaces.loading"
							@click="spaces.next()"
						/>
					</div>
				</template>
			</div>
		</ScrollArea>

		<NewSpaceDialog v-model="showCreateDialog" @created="spaces.reload()" />
	</div>
</template>

<script setup>
import MobileAppMenu from '@/components/MobileAppMenu.vue';
import NewSpaceDialog from '@/components/NewSpaceDialog.vue';
import SpaceAvatar from '@/components/SpaceAvatar.vue';
import { useMobile } from '@/composables/useMobile';
import { useSpaceLibrary } from '@/composables/useSpaceLibrary';
import { useUserStore } from '@/stores/user';
import {
	Button,
	PageHeader,
	PageHeaderMobile,
	ScrollArea,
	TabButtons,
	TextInput,
	Tooltip,
	dayjsLocal,
	usePageMeta,
} from 'frappe-ui';
import {
	List,
	ListCell,
	ListHeader,
	ListHeaderCell,
	ListRow,
} from 'frappe-ui/list';
import { computed, ref } from 'vue';

const userStore = useUserStore();
const { isMobile } = useMobile();
const isManager = computed(() => userStore.isWikiManager);

const showCreateDialog = ref(false);

// The directory is the one surface that shows the figures, so it is the one
// that asks for them.
const {
	spaces,
	searchQuery,
	publishState,
	spaceStats,
	orderedSpaces,
	isEmptyWiki,
	restrictedSpaces,
	isPinned,
} = useSpaceLibrary({ withStats: true });

const publishOptions = [
	{ label: __('All'), value: 'all' },
	{ label: __('Published'), value: 'published' },
	{ label: __('Unpublished'), value: 'unpublished' },
];

// The figures land a beat after the rows do, so every row needs a shape to
// draw before its stats arrive rather than a `v-if` around three cells.
const EMPTY_STATS = { pages: 0, open_change_requests: 0, last_updated: null };
function statsFor(space) {
	return spaceStats.value[space] || EMPTY_STATS;
}

// The unit is spelled out because the column has no header to carry it.
function pageCountLabel(count) {
	return count === 1 ? __('1 page') : __('{0} pages', [count]);
}

function fromNow(value) {
	return value ? dayjsLocal(value).fromNow() : '';
}

function formatDateTime(value) {
	if (!value) return '';
	return new Date(value).toLocaleString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

// On desktop the New Space button lives in the sidebar, so the empty state
// points at it rather than repeating it.
const emptyWikiHint = computed(() => {
	if (!isManager.value) return __('No wiki spaces available');
	return isMobile.value
		? __('Create your first wiki space to get started')
		: __('Create your first wiki space from the sidebar to get started');
});

usePageMeta(() => ({ title: `${__('All Spaces')} | Frappe Wiki` }));
</script>
