import { useUserStore } from '@/stores/user';
import { createResource } from 'frappe-ui';
import { computed, h } from 'vue';

const installedApps = createResource({
	url: 'frappe.apps.get_apps',
	cache: 'apps',
});

export function useApps() {
	const userStore = useUserStore();
	if (!installedApps.fetched && !installedApps.loading) installedApps.fetch();

	const apps = computed(() => {
		const otherApps = (installedApps.data || []).filter(
			(app) => app.name !== 'wiki',
		);
		if (userStore.data?.user_type !== 'System User') return otherApps;
		const desk = {
			name: 'frappe',
			title: __('Desk'),
			logo: '/assets/frappe/images/framework.png',
			route: '/app',
		};
		return [desk, ...otherApps];
	});

	const appsMenuItems = computed(() => {
		if (!apps.value.length) return [];
		return [
			{
				label: __('Apps'),
				icon: 'lucide-grip',
				submenu: apps.value.map((app) => ({
					label: app.title,
					slots: {
						prefix: () =>
							h('img', { src: app.logo, alt: '', class: 'size-4 shrink-0' }),
					},
					onClick: () => {
						window.location.href = app.route;
					},
				})),
			},
		];
	});

	return { appsMenuItems };
}
