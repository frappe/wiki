import { openWikiSettings } from '../lib.mjs';

export const shots = [
	{
		name: 'wiki-settings-general',
		user: 'grace',
		url: '/wiki-app/spaces',
		crop: (page) => openWikiSettings(page, 'General'),
	},
	{
		name: 'wiki-settings-header',
		user: 'grace',
		url: '/wiki-app/spaces',
		async crop(page) {
			const settings = await openWikiSettings(page, 'Header & Robots');
			await settings
				.getByLabel('<head> HTML')
				.fill('<meta name="google-site-verification" content="example">');
			await settings.getByText('Unsaved changes').waitFor();
			return settings;
		},
	},
];
