<template>
	<div class="flex flex-col gap-4">
		<!-- Repository + Sync now -->
		<div
			class="flex items-center justify-between rounded-lg border border-outline-gray-2 bg-surface-gray-1 p-3"
		>
			<div class="mr-4 flex-1 min-w-0">
				<p class="text-sm font-medium text-ink-gray-9">
					{{ __('Repository') }}
				</p>
				<a
					v-if="repoFullName"
					:href="`https://github.com/${repoFullName}`"
					target="_blank"
					rel="noopener noreferrer"
					class="mt-0.5 block truncate text-xs text-ink-gray-5 hover:text-ink-gray-7"
				>
					{{ repoFullName }}<span v-if="branch">@{{ branch }}</span>
				</a>
				<p v-else class="mt-0.5 text-xs text-ink-gray-5">
					{{ __('No repository configured') }}
				</p>
			</div>
			<div class="flex items-center gap-2">
				<Badge :theme="statusTheme(lastSyncStatus)" size="sm" variant="subtle">
					{{ statusLabel(lastSyncStatus) }}
				</Badge>
				<Button variant="solid" size="sm" :loading="syncing" @click="syncNow">
					{{ __('Sync now') }}
				</Button>
			</div>
		</div>

		<!-- Last sync time -->
		<div
			class="flex items-center justify-between rounded-lg border border-outline-gray-2 bg-surface-gray-1 p-3"
		>
			<div class="mr-4 flex-1">
				<p class="text-sm font-medium text-ink-gray-9">
					{{ __('Last Synced') }}
				</p>
				<p class="mt-0.5 text-xs text-ink-gray-5">
					{{ lastSyncTime ? formatDateTime(lastSyncTime) : __('Never') }}
				</p>
			</div>
		</div>

		<!-- Webhook: real-time push sync -->
		<div
			class="rounded-lg border border-outline-gray-2 bg-surface-gray-1 p-3"
		>
			<p class="text-sm font-medium text-ink-gray-9">
				{{ __('Real-time Sync') }}
			</p>
			<p class="mt-0.5 text-xs text-ink-gray-5">
				{{ __('Pushes to the repository sync automatically via this webhook URL:') }}
			</p>
			<div class="mt-2 flex items-center gap-2">
				<code
					class="flex-1 min-w-0 truncate rounded bg-surface-gray-2 px-2 py-1 text-xs text-ink-gray-7"
				>
					{{ webhookUrl }}
				</code>
				<Button
					size="sm"
					variant="subtle"
					icon="copy"
					:title="__('Copy webhook URL')"
					@click="copyWebhookUrl"
				/>
			</div>
		</div>

		<!-- Run history -->
		<div class="rounded-lg border border-outline-gray-2 bg-surface-gray-1">
			<div class="flex items-center justify-between border-b border-outline-gray-2 p-3">
				<p class="text-sm font-medium text-ink-gray-9">
					{{ __('Sync History') }}
				</p>
				<Button
					variant="ghost"
					size="sm"
					icon="refresh-cw"
					:loading="logs.loading"
					@click="logs.reload()"
				/>
			</div>

			<div v-if="logRows.length" class="divide-y divide-outline-gray-2">
				<div
					v-for="row in logRows"
					:key="row.name"
					class="flex items-center justify-between gap-3 px-3 py-2.5"
				>
					<div class="min-w-0">
						<div class="flex items-center gap-2">
							<Badge :theme="statusTheme(row.status)" size="sm" variant="subtle">
								{{ statusLabel(row.status) }}
							</Badge>
							<Badge
								v-if="row.trigger === 'Webhook'"
								theme="blue"
								size="sm"
								variant="subtle"
							>
								{{ __('Webhook') }}
							</Badge>
							<span class="truncate text-xs text-ink-gray-5">
								{{ formatDateTime(row.started_at || row.creation) }}
							</span>
						</div>
						<p
							v-if="row.status === 'Success'"
							class="mt-1 text-xs text-ink-gray-5"
						>
							{{ summarizeCounts(row) }}
						</p>
						<p
							v-else-if="row.status === 'Error' && row.error"
							class="mt-1 truncate text-xs text-ink-red-4"
							:title="row.error"
						>
							{{ firstLine(row.error) }}
						</p>
					</div>
					<a
						v-if="row.commit_sha && repoFullName"
						:href="`https://github.com/${repoFullName}/commit/${row.commit_sha}`"
						target="_blank"
						rel="noopener noreferrer"
						class="shrink-0 text-xs text-ink-gray-5 underline hover:text-ink-gray-7"
						:title="__('View commit on GitHub')"
					>
						<code>{{ row.commit_sha.slice(0, 7) }}</code>
					</a>
					<code
						v-else-if="row.commit_sha"
						class="shrink-0 text-xs text-ink-gray-5"
					>
						{{ row.commit_sha.slice(0, 7) }}
					</code>
				</div>
			</div>
			<p v-else class="px-3 py-6 text-center text-xs text-ink-gray-5">
				{{ __('No sync runs yet') }}
			</p>
		</div>

		<!-- Loaded .wiki.json preview (collapsed by default) -->
		<CollapsibleSection :title="__('Configuration (.wiki.json)')">
			<pre
				v-if="wikiConfig"
				class="max-h-80 overflow-auto whitespace-pre rounded bg-surface-gray-2 p-3 font-mono text-xs leading-relaxed text-ink-gray-8"
			>{{ wikiConfig }}</pre>
			<p v-else class="text-xs text-ink-gray-5">
				{{ __('No .wiki.json in the repo — the page tree is inferred from the docs folder.') }}
			</p>
		</CollapsibleSection>
	</div>
</template>

<script setup>
import { Badge, Button, createListResource, toast } from 'frappe-ui';
import { computed, ref } from 'vue';
import CollapsibleSection from '../CollapsibleSection.vue';

const props = defineProps({
	space: {
		type: Object,
		required: true,
	},
	spaceId: {
		type: String,
		required: true,
	},
});

const repoFullName = computed(() => props.space.doc?.repo_full_name || '');
const branch = computed(() => props.space.doc?.branch || '');
const lastSyncStatus = computed(() => props.space.doc?.last_sync_status || '');
const lastSyncTime = computed(() => props.space.doc?.last_sync_time || '');
const wikiConfig = computed(() => props.space.doc?.wiki_config || '');

const webhookUrl = computed(
	() => `${window.location.origin}/api/method/wiki.api.github.webhook`,
);

async function copyWebhookUrl() {
	try {
		await navigator.clipboard.writeText(webhookUrl.value);
		toast.success(__('Webhook URL copied'));
	} catch {
		toast.error(__('Could not copy URL'));
	}
}

const logs = createListResource({
	doctype: 'Wiki Git Sync Log',
	fields: [
		'name',
		'status',
		'trigger',
		'commit_sha',
		'started_at',
		'finished_at',
		'created_count',
		'updated_count',
		'deleted_count',
		'moved_count',
		'error',
		'creation',
	],
	filters: { wiki_space: props.spaceId },
	orderBy: 'creation desc',
	pageLength: 20,
	auto: true,
});

const logRows = computed(() => logs.data || []);

const syncing = ref(false);
async function syncNow() {
	syncing.value = true;
	try {
		await props.space.syncNow.submit();
		toast.success(__('Sync started — pulling the latest from GitHub'));
		// The sync runs on the long queue; give it a moment, then refresh.
		setTimeout(async () => {
			try {
				await Promise.all([props.space.reload(), logs.reload()]);
			} finally {
				syncing.value = false;
			}
		}, 4000);
	} catch (error) {
		syncing.value = false;
		toast.error(error.messages?.[0] || __('Could not start sync'));
	}
}

function statusTheme(status) {
	return (
		{
			Success: 'green',
			Error: 'red',
			Running: 'blue',
			Pending: 'blue',
			'No Change': 'gray',
		}[status] || 'gray'
	);
}

// "Pending"/"Running" are transient internal states; surface a single,
// human-readable label. Other statuses (Success/Error/No Change) read fine.
function statusLabel(status) {
	return (
		{ Pending: __('Sync in progress'), Running: __('Sync in progress') }[
			status
		] ||
		status ||
		__('Sync in progress')
	);
}

function summarizeCounts(row) {
	const parts = [];
	if (row.created_count) parts.push(`+${row.created_count}`);
	if (row.updated_count) parts.push(`~${row.updated_count}`);
	if (row.deleted_count) parts.push(`-${row.deleted_count}`);
	if (row.moved_count) parts.push(`↦${row.moved_count}`);
	return parts.length ? parts.join('  ') : __('No changes');
}

function firstLine(text) {
	return (text || '').trim().split('\n').pop();
}

function formatDateTime(dateStr) {
	if (!dateStr) return '';
	return new Date(dateStr).toLocaleString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}
</script>
