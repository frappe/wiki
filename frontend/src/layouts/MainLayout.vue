<template>
	<div
		class="flex h-screen w-full"
		:class="isMobile ? 'flex-col' : 'flex-row shadow'"
	>
		<template v-if="isLoading"></template>
		<template v-else-if="hasAccess">
			<MobileTopNav v-if="isMobile" />
			<Sidebar v-else />
			<div
				class="min-w-0"
				:class="isMobile ? 'flex-1 min-h-0' : 'flex-1 h-full'"
			>
				<slot></slot>
			</div>
		</template>
		<div v-else class="flex-1 flex items-center justify-center bg-gray-50">
			<div class="text-center">
				<div class="text-gray-400 mb-4">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-16 w-16 mx-auto"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
						/>
					</svg>
				</div>
				<h2 class="text-xl font-semibold text-gray-700 mb-2">
					{{ __('Access Denied') }}
				</h2>
				<p class="text-gray-500">
					{{ __("You don't have permission to access the Wiki.") }}
				</p>
				<p class="text-gray-400 text-sm mt-1">
					{{ __('Please contact your administrator to request access.') }}
				</p>
			</div>
		</div>
	</div>
</template>

<script setup>
import { computed } from 'vue';
import Sidebar from '../components/Sidebar.vue';
import MobileTopNav from '../components/MobileTopNav.vue';
import { useMobile } from '../composables/useMobile';
import { useUserStore } from '@/stores/user';

const { isMobile } = useMobile();
const userStore = useUserStore();

const isLoading = computed(() => userStore.isLoading);
const hasAccess = computed(() => userStore.canAccessWiki);
</script>
