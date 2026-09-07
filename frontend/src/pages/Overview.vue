<template>
	<!-- Placeholder landing page. The route name is `Overview` from day one so
	     the sidebar's Overview item never has to be repointed, but the wiki-wide
	     analytics that belong here come later.
	     It still carries two jobs the retired list page owned: the empty-wiki
	     state, and the only space list on mobile — where the sidebar this page
	     sits beside does not exist. -->
	<div class="flex h-full flex-col">
		<PageHeaderMobile v-if="isMobile" :title="__('Spaces')">
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
			<h2 class="text-lg-semibold text-ink-gray-9">{{ __('Overview') }}</h2>
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
					<TextInput
						v-if="showSearch"
						class="mb-3"
						type="text"
						v-model="searchQuery"
						:placeholder="__('Search spaces...')"
					>
						<template #prefix>
							<span class="lucide-search size-4 text-ink-gray-4" aria-hidden="true" />
						</template>
					</TextInput>

					<p
						v-if="!spaces.loading && !orderedSpaces.length"
						class="py-16 text-center text-p-sm text-ink-gray-5"
					>
						{{ __('No spaces found') }}
					</p>

					<div class="flex flex-col gap-1">
						<router-link
							v-for="space in orderedSpaces"
							:key="space.name"
							class="flex items-center gap-3 rounded-4 px-3 py-2 hover:bg-surface-gray-2"
							:to="{ name: 'SpaceDetails', params: { spaceId: space.name } }"
						>
							<SpaceAvatar
								:space="space"
								:label="space.space_name || space.name"
								size="lg"
							/>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-base text-ink-gray-8">
									{{ space.space_name || space.name }}
								</span>
								<span class="block truncate text-p-sm text-ink-gray-5">
									{{ space.route }}
								</span>
							</span>
							<span class="flex shrink-0 items-center gap-1.5">
								<Tooltip v-if="isPinned(space.name)" :text="__('Pinned to top')">
									<span class="lucide-pin size-4 text-ink-gray-5" aria-hidden="true" />
								</Tooltip>
								<Tooltip v-if="space.git_synced" :text="__('Synced from GitHub')">
									<span class="lucide-folder-git-2 size-4 text-ink-gray-4" aria-hidden="true" />
								</Tooltip>
								<Tooltip v-if="restrictedSpaces.has(space.name)" :text="__('Restricted access')">
									<span class="lucide-lock size-4 text-ink-gray-4" aria-hidden="true" />
								</Tooltip>
								<Tooltip v-if="!space.is_published" :text="__('Unpublished')">
									<span class="lucide-eye-off size-4 text-ink-gray-4" aria-hidden="true" />
								</Tooltip>
							</span>
						</router-link>
					</div>

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
	TextInput,
	Tooltip,
	usePageMeta,
} from 'frappe-ui';
import { computed, ref } from 'vue';

const userStore = useUserStore();
const { isMobile } = useMobile();
const isManager = computed(() => userStore.isWikiManager);

const showCreateDialog = ref(false);

const {
	spaces,
	searchQuery,
	showSearch,
	orderedSpaces,
	isEmptyWiki,
	restrictedSpaces,
	isPinned,
} = useSpaceLibrary();

// On desktop the New Space button lives in the sidebar, so the empty state
// points at it rather than repeating it.
const emptyWikiHint = computed(() => {
	if (!isManager.value) return __('No wiki spaces available');
	return isMobile.value
		? __('Create your first wiki space to get started')
		: __('Create your first wiki space from the sidebar to get started');
});

usePageMeta(() => ({ title: `${__('Overview')} | Frappe Wiki` }));
</script>
