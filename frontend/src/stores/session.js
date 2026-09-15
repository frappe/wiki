import { getCookieUser } from '@/lib/cookieUser';
import { useUserStore } from '@/stores/user';
import { createResource } from 'frappe-ui';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export const useSessionStore = defineStore('session', () => {
	const user = ref(getCookieUser());

	const isLoggedIn = computed(() => !!user.value);

	const login = createResource({
		url: 'login',
		makeParams({ email, password }) {
			return {
				usr: email,
				pwd: password,
			};
		},
		onSuccess(data) {
			useUserStore().reload();
			user.value = getCookieUser();
			login.reset();
			window.location.href = data.default_route || '/';
		},
	});

	const logout = createResource({
		url: 'logout',
		onSuccess() {
			useUserStore().reset();
			user.value = getCookieUser();
			window.location.href = '/login';
		},
	});

	return {
		user,
		isLoggedIn,
		login,
		logout,
	};
});
