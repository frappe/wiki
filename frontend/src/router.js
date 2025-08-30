import { userResource } from '@/data/user';
import { createRouter, createWebHistory } from 'vue-router';
import { session } from './data/session';

const routes = [
	{
		path: '/',
		name: 'Home',
		redirect: '/spaces',
	},
	{
		path: '/spaces',
		name: 'SpaceList',
		component: () => import('@/pages/Spaces.vue'),
	},
	{
		path: '/spaces/:spaceId',
		name: 'SpaceDetails',
		component: () => import('@/pages/SpaceDetails.vue'),
		props: true,
	},
	{
		path: '/pages/:pageId',
		name: 'WikiDocument',
		component: () => import('@/pages/WikiDocument.vue'),
		props: true,
	},
];

const router = createRouter({
	history: createWebHistory('/frontend'),
	routes,
});

router.beforeEach(async (to, from, next) => {
	let isLoggedIn = session.isLoggedIn;
	try {
		await userResource.fetch();
	} catch (error) {
		isLoggedIn = false;
	}

	if (!isLoggedIn) {
		window.location.href = `/login?redirect-to=${encodeURIComponent(
			to.fullPath,
		)}`;
	} else {
		next();
	}
});

export default router;
