import { moment } from "obsidian";

interface HostDate {
	format(pattern: string): string;
	fromNow(): string;
}

// The SDK exposes a namespace type, while the runtime exports a callable moment.
// Keep this host typing gap here instead of suppressing checks in Vue components.
const hostMoment = moment as unknown as (timestamp: number) => HostDate;

export function formatDate(timestamp: number, pattern: string): string {
	if (typeof hostMoment !== "function") throw new Error("Host date formatter unavailable");
	return hostMoment(timestamp).format(pattern);
}

export function formatRelativeDate(timestamp: number): string {
	if (typeof hostMoment !== "function") throw new Error("Host date formatter unavailable");
	return hostMoment(timestamp).fromNow();
}
