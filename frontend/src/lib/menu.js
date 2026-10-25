import { h } from 'vue';

// frappe-ui's theme: 'red' also turns the hover background red; this colours only the icon and label.
export function destructiveMenuOption({ icon, ...option }) {
	return {
		...option,
		slots: {
			prefix: () =>
				h('span', {
					class: [icon, 'size-4 shrink-0 text-ink-red-7'],
					'aria-hidden': 'true',
				}),
			label: ({ item }) =>
				h('div', { class: 'min-w-0' }, [
					h(
						'div',
						{ class: 'truncate leading-tighter text-ink-red-7' },
						item.label,
					),
					item.description &&
						h(
							'div',
							{ class: 'truncate text-p-sm text-ink-gray-5' },
							item.description,
						),
				]),
		},
	};
}
