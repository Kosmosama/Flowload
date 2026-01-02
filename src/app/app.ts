import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';

declare const chrome: any;

type PendingDownload = {
	filename: string;
	extension: string;
	targetPath: string;
	url: string;
	downloadId?: number;
};

@Component({
	selector: 'app-root',
	imports: [],
	templateUrl: './app.html',
	styleUrl: './app.scss'
})
export class App implements OnInit, OnDestroy {
	protected pending = signal<PendingDownload | null>(null);
	protected status = signal('Waiting for a download…');
	protected busy = signal(false);
	protected folder = signal('');
	protected filename = signal('');
	protected targetPath = computed(() => {
		const cleanFolder = this.folder().trim().replace(/^\/+|\/+$/g, '');
		const cleanFile = this.filename().trim();
		if (cleanFolder && cleanFile) return `${cleanFolder}/${cleanFile}`;
		return cleanFile || cleanFolder || '';
	});

	private storageListener = (changes: Record<string, any>, areaName: string) => {
		if (areaName !== 'local' || !changes['pendingDownload']) return;
		const next = changes['pendingDownload'].newValue || null;
		this.pending.set(next);
		this.status.set(next ? 'Ready to proceed' : 'No pending download');
	};

	ngOnInit(): void {
		this.loadPending();
		if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
			chrome.storage.onChanged.addListener(this.storageListener);
		}
	}

	ngOnDestroy(): void {
		if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
			chrome.storage.onChanged.removeListener(this.storageListener);
		}
	}

	protected async proceed(): Promise<void> {
		const item = this.pending();
		if (!item || this.busy()) return;
		this.busy.set(true);
		this.status.set('Resuming download…');

		const targetPath = this.targetPath() || item.targetPath;

		try {
			await new Promise<void>((resolve, reject) => {
				if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
					reject(new Error('Chrome extension APIs unavailable'));
					return;
				}

				chrome.runtime.sendMessage(
					{ type: 'flowload.proceedDownload', url: item.url, targetPath },
					(response: any) => {
						const lastError = chrome.runtime?.lastError;
						if (lastError) {
							reject(new Error(lastError.message));
							return;
						}
						if (response?.ok) resolve();
						else reject(new Error(response?.error || 'Unexpected response from background'));
					}
				);
			});

			this.status.set('Download started. You can close this window.');
			setTimeout(() => window.close(), 800);
		} catch (err: any) {
			this.status.set(err?.message || 'Failed to resume download');
		} finally {
			this.busy.set(false);
		}
	}

	protected async cancel(): Promise<void> {
		if (!this.pending() || this.busy()) return;
		this.busy.set(true);
		this.status.set('Canceling download…');

		try {
			await new Promise<void>((resolve, reject) => {
				if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
					reject(new Error('Chrome extension APIs unavailable'));
					return;
				}

				chrome.runtime.sendMessage({ type: 'flowload.cancelDownload' }, (response: any) => {
					const lastError = chrome.runtime?.lastError;
					if (lastError) {
						reject(new Error(lastError.message));
						return;
					}
					if (response?.ok) resolve();
					else reject(new Error(response?.error || 'Unexpected response from background'));
				});
			});

			this.pending.set(null);
			this.status.set('Download canceled.');
		} catch (err: any) {
			this.status.set(err?.message || 'Failed to cancel download');
		} finally {
			this.busy.set(false);
		}
	}

	protected async reload(): Promise<void> {
		await this.loadPending();
	}

	private async loadPending(): Promise<void> {
		this.status.set('Checking for pending downloads…');

		if (typeof chrome === 'undefined' || !chrome.storage?.local) {
			this.status.set('Chrome extension APIs unavailable');
			return;
		}

		const data = await chrome.storage.local.get('pendingDownload');
		const pending = (data && data['pendingDownload']) || null;
		this.pending.set(pending);

		if (pending?.targetPath) {
			const segments = pending.targetPath.split('/');
			const name = segments.pop() || '';
			const folder = segments.join('/');
			this.filename.set(name);
			this.folder.set(folder);
		} else {
			this.filename.set('');
			this.folder.set('');
		}

		this.status.set(pending ? 'Ready to proceed' : 'No pending download');
	}
}
