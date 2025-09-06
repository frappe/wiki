import { io } from 'socket.io-client';
import { socketio_port } from '../../../../sites/common_site_config.json';

let socket = null;
export function initSocket() {
	const host = window.location.hostname;
	const siteName = window.site_name;
	const port = window.location.port ? `:${socketio_port}` : '';
	const protocol = port ? 'http' : 'https';
	const url = `${protocol}://${host}${port}/${siteName}`;

	socket = io(url, {
		withCredentials: true,
		reconnectionAttempts: 5,
	});
	return socket;
}

export function useSocket() {
	return socket;
}
