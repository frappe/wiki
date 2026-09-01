<template>
	<!-- Placeholder landing page. The route name is `Overview` from day one so
	     the sidebar's Overview item never has to be repointed, but the wiki-wide
	     analytics that belong here come later. Until the sidebar grows its own
	     search and New space button, the old space list stands in — it is still
	     the only way to create a space, and the only space list on mobile. -->
	<SpaceList />
</template>

<script setup>
import SpaceList from '@/components/SpaceList.vue';
import { usePageMeta } from 'frappe-ui';

usePageMeta(() => ({ title: `${__('Overview')} | Frappe Wiki` }));
</script>
