// Browser transport used only by the standalone Obsidian probe.
export function browserConnection(win, source, resources) {
	const url = win.URL.createObjectURL(new win.Blob([source], { type: "text/javascript" }));
	resources.urls++;
	let worker;
	try { worker = new win.Worker(url); resources.workers++; }
	catch (error) { win.URL.revokeObjectURL(url); resources.urls--; throw error; }
	let stopped = false;
	return {
		postMessage(value) { worker.postMessage(value); },
		onMessage(callback) {
			const listener = (event) => callback(event.data); let removed = false;
			worker.addEventListener("message", listener); resources.listeners++;
			return () => { if (!removed) { removed = true; worker.removeEventListener("message", listener); resources.listeners--; } };
		},
		onError(callback) {
			const listener = (event) => { event.preventDefault?.(); callback(new Error(event.message ?? "Worker message error")); };
			let removed = false;
			worker.addEventListener("error", listener); worker.addEventListener("messageerror", listener); resources.listeners += 2;
			return () => {
				if (removed) return; removed = true;
				worker.removeEventListener("error", listener); worker.removeEventListener("messageerror", listener); resources.listeners -= 2;
			};
		},
		terminate() {
			if (stopped) return; stopped = true;
			try { worker.terminate(); } finally { resources.workers--; win.URL.revokeObjectURL(url); resources.urls--; }
		},
	};
}
