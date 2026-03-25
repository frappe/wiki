import { createResource } from 'frappe-ui';
import { defineStore } from 'pinia';
import { computed } from 'vue';

export const useUserStore = defineStore('user', () => {
	const userResource = createResource({
		url: 'wiki.api.get_user_info',
		cache: 'User',
		onError(error) {
			if (error && error.exc_type === 'AuthenticationError') {
				window.location.href = '/login';
			}
		},
	});

	const data = computed(() => userResource.data);
	const roles = computed(() => userResource.data?.roles || []);
	const isLoading = computed(() => !userResource.data);

	const isWikiManager = computed(() => {
		const user = userResource.data;
		if (!user || !user.roles) return false;
		return user.roles.some(
			(role) => role.role === 'Wiki Manager' || role.role === 'System Manager',
		);
	});

	const canAccessWiki = computed(() => {
		const user = userResource.data;
		if (!user || !user.roles) return false;
		return user.roles.some(
			(role) =>
				role.role === 'Wiki User' ||
				role.role === 'Wiki Manager' ||
				role.role === 'System Manager',
		);
	});

	const shouldUseChangeRequestMode = computed(() => {
		return Boolean(userResource.data?.is_logged_in);
	});

	function fetch() {
		return userResource.fetch();
	}

	function reload() {
		return userResource.reload();
	}

	function reset() {
		return userResource.reset();
	}

	return {
		userResource,
		data,
		roles,
		isLoading,
		isWikiManager,
		canAccessWiki,
		shouldUseChangeRequestMode,
		fetch,
		reload,
		reset,
	};
});
