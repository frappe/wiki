<template>
	<div class="flex flex-col gap-8">
		<!-- Intro + one-click create — only while the App isn't configured yet. -->
		<SettingsRow
			v-if="!isConfigured"
			:title="__('GitHub Sync')"
			:description="
				__('Configure a GitHub App so Wiki Spaces can sync from GitHub repositories, including private ones. Access tokens are minted on demand from the App private key — no per-space secrets are stored.')
			"
		>
			<Button variant="solid" icon-left="github" @click="createApp">
				{{ __('Create GitHub App') }}
			</Button>
		</SettingsRow>

		<!-- Manual configuration (non-secret Data fields) -->
		<section>
			<div class="flex flex-col gap-4">
				<FormControl v-model="appId" type="text" :label="__('App ID')" />
				<FormControl
					v-model="clientId"
					type="text"
					:label="__('Client ID')"
				/>
				<FormControl
					v-model="publicLink"
					type="text"
					:label="__('App Public Link')"
					:description="
						__('Public installation link, e.g. https://github.com/apps/your-app/installations/new')
					"
				/>
				<div class="flex items-center justify-end gap-2">
					<Badge v-if="configDirty" theme="orange" size="sm">
						{{ __('Unsaved changes') }}
					</Badge>
					<Button
						variant="solid"
						:loading="savingConfig"
						:disabled="!configDirty"
						@click="saveConfig"
					>
						{{ __('Save') }}
					</Button>
				</div>
			</div>
		</section>

		<!-- Secrets (write-only) -->
		<section>
			<h3 class="text-base font-semibold text-ink-gray-8">
				{{ __('Secrets') }}
			</h3>
			<p class="mt-1 text-base leading-5 text-ink-gray-6">
				{{ __('Stored secrets are never shown. Leave a field blank to keep its current value.') }}
			</p>

			<div class="mt-4 flex flex-col gap-4">
				<FormControl
					v-model="clientSecret"
					type="password"
					:placeholder="hasClientSecret ? '••••••••' : __('Enter client secret')"
				>
					<template #label>
						<div class="flex items-center gap-2">
							<span>{{ __('Client Secret') }}</span>
							<Badge :theme="hasClientSecret ? 'green' : 'gray'" size="sm">
								{{ hasClientSecret ? __('Configured') : __('Not set') }}
							</Badge>
						</div>
					</template>
				</FormControl>

				<FormControl
					v-model="webhookSecret"
					type="password"
					:placeholder="hasWebhookSecret ? '••••••••' : __('Enter webhook secret')"
				>
					<template #label>
						<div class="flex items-center gap-2">
							<span>{{ __('Webhook Secret') }}</span>
							<Badge :theme="hasWebhookSecret ? 'green' : 'gray'" size="sm">
								{{ hasWebhookSecret ? __('Configured') : __('Not set') }}
							</Badge>
						</div>
					</template>
				</FormControl>

				<Textarea
					v-model="privateKey"
					:rows="5"
					spellcheck="false"
					:description="__('PEM-encoded private key generated for the GitHub App')"
					:placeholder="
						hasPrivateKey ? __('Configured — paste a new key to replace') : __('Paste PEM private key')
					"
					class="[&_textarea]:font-mono"
				>
					<template #label>
						<div class="flex items-center gap-2">
							<span>{{ __('Private Key') }}</span>
							<Badge :theme="hasPrivateKey ? 'green' : 'gray'" size="sm">
								{{ hasPrivateKey ? __('Configured') : __('Not set') }}
							</Badge>
						</div>
					</template>
				</Textarea>

				<div class="flex items-center justify-end">
					<Button
						variant="solid"
						:loading="savingSecrets"
						:disabled="!secretsDirty"
						@click="saveSecrets"
					>
						{{ __('Save Secrets') }}
					</Button>
				</div>
			</div>
		</section>
	</div>
</template>

<script setup>
import {
	Badge,
	Button,
	FormControl,
	SettingsRow,
	Textarea,
	createResource,
	toast,
} from 'frappe-ui';
import { computed, ref, watch } from 'vue';

const props = defineProps({
	settings: {
		type: Object,
		required: true,
	},
});

// Password fields don't round-trip through the doc API, so presence comes from
// a dedicated endpoint that returns booleans only (never the secret values).
const appConfig = createResource({
	url: 'wiki.api.github.get_app_config',
	auto: true,
});
const saveCredentials = createResource({
	url: 'wiki.api.github.save_app_credentials',
});

const appId = ref('');
const clientId = ref('');
const publicLink = ref('');
const savingConfig = ref(false);

const clientSecret = ref('');
const webhookSecret = ref('');
const privateKey = ref('');
const savingSecrets = ref(false);

// "Create GitHub App" creates a brand-new App, so only offer it before one is
// set up — once an App ID + Client ID are stored, creating another would orphan
// the existing one.
const isConfigured = computed(() =>
	Boolean(
		props.settings.doc?.github_app_id &&
			props.settings.doc?.github_app_client_id,
	),
);

const hasClientSecret = computed(() =>
	Boolean(appConfig.data?.has_client_secret),
);
const hasWebhookSecret = computed(() =>
	Boolean(appConfig.data?.has_webhook_secret),
);
const hasPrivateKey = computed(() => Boolean(appConfig.data?.has_private_key));

watch(
	() => props.settings.doc,
	(doc) => {
		if (doc) {
			appId.value = doc.github_app_id || '';
			clientId.value = doc.github_app_client_id || '';
			publicLink.value = doc.github_app_public_link || '';
		}
	},
	{ immediate: true },
);

const configDirty = computed(
	() =>
		appId.value !== (props.settings.doc?.github_app_id || '') ||
		clientId.value !== (props.settings.doc?.github_app_client_id || '') ||
		publicLink.value !== (props.settings.doc?.github_app_public_link || ''),
);

const secretsDirty = computed(
	() =>
		Boolean(clientSecret.value) ||
		Boolean(webhookSecret.value) ||
		Boolean(privateKey.value),
);

function createApp() {
	// Same-window so the manifest flow's redirect back to /wiki-app?github_app_created=1
	// re-opens this dialog on the GitHub tab (handled in MainLayout).
	window.location.href = '/github/new_app';
}

async function saveConfig() {
	savingConfig.value = true;
	try {
		await props.settings.setValue.submit({
			github_app_id: appId.value,
			github_app_client_id: clientId.value,
			github_app_public_link: publicLink.value,
		});
		toast.success(__('Configuration saved'));
	} catch (error) {
		console.error('Failed to save GitHub App configuration:', error);
		toast.error(__('Failed to save configuration'));
	} finally {
		savingConfig.value = false;
	}
}

async function saveSecrets() {
	const payload = {};
	if (clientSecret.value) payload.client_secret = clientSecret.value;
	if (webhookSecret.value) payload.webhook_secret = webhookSecret.value;
	if (privateKey.value) payload.private_key = privateKey.value;
	if (!Object.keys(payload).length) return;

	savingSecrets.value = true;
	try {
		await saveCredentials.submit(payload);
		clientSecret.value = '';
		webhookSecret.value = '';
		privateKey.value = '';
		await appConfig.reload();
		toast.success(__('Secrets updated'));
	} catch (error) {
		console.error('Failed to save GitHub App secrets:', error);
		toast.error(__('Failed to save secrets'));
	} finally {
		savingSecrets.value = false;
	}
}
</script>
