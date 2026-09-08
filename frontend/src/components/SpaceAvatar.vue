<template>
	<!-- One Avatar, three identities. frappe-ui draws `image` when it has one
	     and the default slot when it does not, so the icon is both the
	     no-image case and the fallback if a stored data URI ever fails to
	     decode — a space is never left as an empty tile.
	     The branch is real, not a `v-if` inside one Avatar: Vue hands a child
	     a default slot function whether or not it renders anything, and
	     Avatar's `$slots.default` check would then swallow the initial. -->
	<Avatar v-if="identity.icon" v-bind="avatarProps">
		<span :class="[identity.icon, 'size-full']" aria-hidden="true" />
	</Avatar>
	<Avatar v-else v-bind="avatarProps" />
</template>

<script setup>
import { Avatar } from 'frappe-ui';
import { computed } from 'vue';

import { resolveSpaceIdentity } from '../lib/spaceIdentity.js';

const props = defineProps({
	// The space row or document: `name`, `space_icon`, `space_color`, `avatar`
	// and `app_switcher_logo`. Flat rather than a document resource so the
	// sidebar and overview lists, which carry these as plain fields, can pass
	// what they already fetched.
	space: { type: Object, default: () => ({}) },
	label: { type: String, default: '' },
	// Avatar sizes the slot wrapper per size, so the glyph just fills it.
	size: { type: String, default: 'sm' },
});

const identity = computed(() => resolveSpaceIdentity(props.space));

const avatarProps = computed(() => ({
	size: props.size,
	shape: 'square',
	theme: identity.value.color,
	image: identity.value.image || undefined,
	label: props.label,
}));
</script>
