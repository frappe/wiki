import { toast } from 'frappe-ui';

/**
 * Write what `SpaceIdentityPicker` emits to a Wiki Space document.
 *
 * The picker never saves — it says what was chosen and the caller decides. Both
 * places that save immediately (the settings panel and the space header) need
 * the same two things, so they share this rather than each keeping a copy.
 *
 * Writes are chained rather than fired in parallel: each patch names all five
 * identity fields, so two in flight at once can commit out of order and the
 * slower one undoes the newer choice. A rejected save must not break the chain
 * for the next one.
 *
 * `getResource` is a function, not the resource, because a store's document
 * resource is replaced when the route moves to another space.
 */
export function useSpaceIdentitySaver(getResource) {
	let saving = Promise.resolve();

	return function saveIdentity(patch) {
		saving = saving
			.then(() => getResource()?.setValue.submit(patch))
			.catch((error) => {
				toast.error(
					error.messages?.[0] || __('Failed to update the space logo'),
				);
			});
	};
}
