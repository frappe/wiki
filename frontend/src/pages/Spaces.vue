<template>
<SpaceList />
</template>

<script setup>
import SpaceList from '@/components/SpaceList.vue';
import { usePageMeta } from 'frappe-ui';

usePageMeta(() => ({ title: `${__('Spaces')} | Frappe Wiki` }));
</script>