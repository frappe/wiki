<template>
    <Breadcrumbs :items="breadcrumbItems" />
</template>

<script setup>
import { Breadcrumbs, createResource } from 'frappe-ui';
import { computed, onMounted, ref } from 'vue';

const props = defineProps({
	pageId: {
		type: String,
		required: true,
	},
});

const breadcrumbData = ref(null);

const breadcrumbResource = createResource({
	url: 'wiki.frappe_wiki.doctype.wiki_document.wiki_document.get_breadcrumbs',
	makeParams() {
		return {
			name: props.pageId,
		};
	},
	onSuccess(data) {
		breadcrumbData.value = data;
	},
});

onMounted(() => {
	breadcrumbResource.fetch();
});

const breadcrumbItems = computed(() => {
	const items = [
		{
			label: __('Spaces'),
			route: { name: 'SpaceList' },
		},
	];

	// Add space if available
	if (breadcrumbData.value?.space) {
		items.push({
			label:
				breadcrumbData.value.space.space_name ||
				breadcrumbData.value.space.name,
			route: {
				name: 'SpaceDetails',
				params: { spaceId: breadcrumbData.value.space.name },
			},
		});
	}

	// Add ancestor groups (skip the root group since that's the space)
	if (breadcrumbData.value?.ancestors) {
		for (const ancestor of breadcrumbData.value.ancestors) {
			// Skip root groups (they're represented by the space)
			if (
				ancestor.is_group &&
				breadcrumbData.value.ancestors.indexOf(ancestor) === 0
			) {
				continue;
			}
			items.push({
				label: ancestor.title,
				route: ancestor.is_group
					? {
							name: 'SpaceDetails',
							params: { spaceId: breadcrumbData.value.space?.name },
						}
					: { name: 'WikiDocument', params: { pageId: ancestor.name } },
			});
		}
	}

	// Add current document title if available
	if (breadcrumbData.value?.current) {
		items.push({
			label: breadcrumbData.value.current.title,
			route: { name: 'WikiDocument', params: { pageId: props.pageId } },
		});
	}

	return items;
});
</script>
