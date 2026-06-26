<!--
  Dialog-safe autocomplete.

  frappe-ui's Autocomplete portals its dropdown through a Popover, which the
  modal Dialog blocks (the teleported panel lands outside the dialog's
  pointer-events scope). This renders the dropdown inline instead, so it works
  inside a Dialog. Progressive disclosure in the create form keeps the fields
  below a picker hidden while it's open, so the inline panel always has room.

  Two modes:
  - local  (default): filters `options` client-side as the user types.
  - remote (`remote`): leaves filtering to the parent — emits `search` (debounced)
    and `load-more` (on scroll) so the parent can page a server-side list.
-->
<template>
  <div class="flex flex-col gap-1" ref="root">
    <span v-if="label" class="text-xs text-ink-gray-5">{{ label }}</span>
    <div class="relative">
      <input
        ref="input"
        type="text"
        :value="isOpen ? query : selectedLabel"
        :placeholder="placeholder"
        :disabled="disabled"
        autocomplete="off"
        class="form-input w-full rounded bg-surface-gray-2 pr-8 text-base text-ink-gray-8 disabled:cursor-not-allowed disabled:opacity-60"
        @focus="open"
        @input="onInput"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.enter.prevent="selectHighlighted"
        @keydown.esc.prevent="close"
      />
      <LucideChevronDown
        class="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-gray-4"
      />

      <!-- Teleported to <body> so the list isn't clipped by the dialog's
           `overflow-hidden` / transformed panel. The dialog sets
           `body { pointer-events: none }` for modals, so the menu re-enables
           itself with `pointer-events: auto`. `.stop` on pointer/mouse-down keeps
           reka-ui's outside-click detector from closing the dialog on a pick. -->
      <Teleport to="body">
        <div
          v-if="isOpen"
          ref="list"
          class="fixed z-[9999] max-h-56 overflow-auto rounded border border-outline-gray-2 bg-surface-white py-1 shadow-lg"
          :style="menuStyle"
          @scroll="onScroll"
          @pointerdown.stop
          @mousedown.stop
        >
          <button
            v-for="(opt, i) in displayedOptions"
            :key="opt.value"
            type="button"
            class="flex w-full items-center px-3 py-1.5 text-left text-base text-ink-gray-8 hover:bg-surface-gray-2"
            :class="{ 'bg-surface-gray-2': i === highlighted }"
            @mousedown.prevent="select(opt)"
            @mousemove="highlighted = i"
          >
            {{ opt.label }}
          </button>

          <div v-if="loading" class="px-3 py-1.5 text-p-sm text-ink-gray-5">
            {{ __('Loading…') }}
          </div>
          <div
            v-else-if="!displayedOptions.length"
            class="px-3 py-1.5 text-p-sm text-ink-gray-5"
          >
            {{ __('No matches') }}
          </div>
          <button
            v-else-if="hasMore"
            type="button"
            class="w-full px-3 py-1.5 text-left text-p-sm text-ink-gray-6 hover:bg-surface-gray-2"
            @mousedown.prevent="$emit('load-more')"
          >
            {{ __('Load more…') }}
          </button>
        </div>
      </Teleport>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from "vue";
import LucideChevronDown from "~icons/lucide/chevron-down";

const props = defineProps({
  modelValue: { type: [String, Number], default: "" },
  options: { type: Array, default: () => [] },
  label: { type: String, default: "" },
  placeholder: { type: String, default: "" },
  disabled: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  hasMore: { type: Boolean, default: false },
  // remote: parent owns filtering (server-side search + paging).
  remote: { type: Boolean, default: false },
});

const emit = defineEmits(["update:modelValue", "search", "load-more"]);

const root = ref(null);
const input = ref(null);
const list = ref(null);
const isOpen = ref(false);
const query = ref("");
const highlighted = ref(0);
const menuStyle = ref({});

const selectedLabel = computed(() => {
  const match = props.options.find((o) => o.value === props.modelValue);
  return match ? match.label : props.modelValue ? String(props.modelValue) : "";
});

const displayedOptions = computed(() => {
  if (props.remote || !query.value) return props.options;
  const q = query.value.toLowerCase();
  return props.options.filter((o) => String(o.label).toLowerCase().includes(q));
});

// Always start the list at the top — otherwise it can open scrolled a partial
// row down, clipping the first option.
function resetScroll() {
  nextTick(() => {
    if (list.value) list.value.scrollTop = 0;
  });
}

// Anchor the fixed dropdown to the input on every open / scroll / resize.
function positionMenu() {
  const el = input.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  menuStyle.value = {
    top: `${rect.bottom + 4}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    // body is pointer-events:none under a modal; re-enable just the menu.
    pointerEvents: "auto",
  };
}

function reposition() {
  if (isOpen.value) positionMenu();
}

function open() {
  if (props.disabled) return;
  isOpen.value = true;
  highlighted.value = 0;
  nextTick(positionMenu);
  resetScroll();
}

function close() {
  isOpen.value = false;
  query.value = "";
}

let searchTimer = null;
function onInput(event) {
  query.value = event.target.value;
  isOpen.value = true;
  highlighted.value = 0;
  resetScroll();
  if (props.remote) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => emit("search", query.value), 300);
  }
}

function select(opt) {
  emit("update:modelValue", opt.value);
  close();
  input.value?.blur();
}

function move(delta) {
  if (!isOpen.value) {
    open();
    return;
  }
  const count = displayedOptions.value.length;
  if (!count) return;
  highlighted.value = (highlighted.value + delta + count) % count;
}

function selectHighlighted() {
  const opt = displayedOptions.value[highlighted.value];
  if (opt) select(opt);
}

function onScroll() {
  const el = list.value;
  if (!el || !props.hasMore || props.loading) return;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) {
    emit("load-more");
  }
}

function onClickOutside(event) {
  if (root.value && !root.value.contains(event.target)) close();
}
document.addEventListener("mousedown", onClickOutside);
// Capture phase so scrolling *inside* the dialog body (not just the window)
// keeps the fixed dropdown glued to the input.
window.addEventListener("scroll", reposition, true);
window.addEventListener("resize", reposition);
onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onClickOutside);
  window.removeEventListener("scroll", reposition, true);
  window.removeEventListener("resize", reposition);
  clearTimeout(searchTimer);
});

// If the selection is cleared elsewhere (e.g. account change resets the repo),
// drop any stale typed query so the placeholder shows again.
watch(
  () => props.modelValue,
  (value) => {
    if (!value) query.value = "";
  },
);
</script>
