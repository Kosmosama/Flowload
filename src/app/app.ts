import { Component, OnDestroy, OnInit, signal } from '@angular/core';

declare const chrome: any;

type PendingDownload = {
	downloadId: number;
	filename: string;
	extension: string;
	targetPath: string;
	url: string;
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

		try {
			await new Promise<void>((resolve, reject) => {
				if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
					reject(new Error('Chrome extension APIs unavailable'));
					return;
				}

				chrome.runtime.sendMessage(
					{ type: 'flowload.proceedDownload', downloadId: item.downloadId },
					(response: any) => {
						const lastError = chrome.runtime?.lastError;
						if (lastError) {
							reject(new Error(lastError.message));
							return;
						}
						if (response?.ok) resolve();
						else reject(new Error('Unexpected response from background'));
					}
				);
			});

			this.status.set('Download resumed. You can close this window.');
			setTimeout(() => window.close(), 800);
		} catch (err: any) {
			this.status.set(err?.message || 'Failed to resume download');
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
		this.status.set(pending ? 'Ready to proceed' : 'No pending download');
	}
}
