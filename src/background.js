const PENDING_KEY = 'pendingDownload';
const SKIP_IDS = new Set(); // IDs we spawned ourselves to avoid re-intercepting
const SKIP_TARGETS = new Map(); // Preferred filenames/paths for re-launched downloads

function extractExtension(filename) {
  if (!filename) return '';
  const lastDot = filename.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === filename.length - 1) return '';
  return filename.slice(lastDot + 1);
}

async function setPendingDownload(info) {
  await chrome.storage.local.set({ [PENDING_KEY]: info });
}

async function clearPendingDownload() {
  await chrome.storage.local.remove([PENDING_KEY]);
}

async function openConfirmationWindow() {
  try {
    await chrome.action.openPopup();
  } catch (err) {
    // openPopup can fail if the popup is disabled or the action is hidden; no alternative in that case
  }
}

chrome.downloads.onDeterminingFilename.addListener(async (item, suggest) => {
  // If this is a download we re-launched after approval, let it continue with the chosen path.
  if (SKIP_IDS.has(item.id)) {
    SKIP_IDS.delete(item.id);
    const preferred = SKIP_TARGETS.get(item.id) || item.filename;
    SKIP_TARGETS.delete(item.id);
    suggest({ filename: preferred, conflictAction: 'uniquify' });
    return;
  }

  const pendingInfo = {
    url: item.finalUrl || item.url,
    filename: item.filename || '',
    extension: extractExtension(item.filename || ''),
    targetPath: item.filename || '',
    downloadId: item.id,
    createdAt: Date.now()
  };

  await setPendingDownload(pendingInfo);
  await openConfirmationWindow();

  // Pause the original download so it doesn't proceed before user chooses.
  try {
    await chrome.downloads.pause(item.id);
  } catch (err) {
    // If pausing fails, fall back to cancel to avoid proceeding.
    try {
      await chrome.downloads.cancel(item.id);
    } catch (innerErr) {
      // best effort
    }
  }

  // We already suggested the original name; if paused, it will not write anything further.
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'flowload.proceedDownload' && message.url) {
    (async () => {
      try {
        // Clean up the original paused download before starting a new one.
        const data = await chrome.storage.local.get(PENDING_KEY);
        const pending = data[PENDING_KEY];
        if (pending?.downloadId) {
          try {
            await chrome.downloads.cancel(pending.downloadId);
          } catch (err) {
            // ignore
          }
          try {
            await chrome.downloads.erase({ id: pending.downloadId });
          } catch (err) {
            // ignore
          }
        }

        const options = {
          url: message.url,
          filename: message.targetPath || undefined,
          saveAs: Boolean(message.saveAs)
        };

        const newId = await chrome.downloads.download(options);
        if (typeof newId === 'number') {
          SKIP_IDS.add(newId);
          if (options.filename) {
            SKIP_TARGETS.set(newId, options.filename);
          }
        }
        await clearPendingDownload();
        sendResponse({ ok: true });
      } catch (err) {
        const msg = err && err.message ? err.message : 'Failed to start download';
        sendResponse({ ok: false, error: msg });
      }
    })();
    return true;
  }

  if (message.type === 'flowload.cancelDownload') {
    (async () => {
      try {
        const data = await chrome.storage.local.get(PENDING_KEY);
        const pending = data[PENDING_KEY];
        if (pending?.downloadId) {
          try {
            await chrome.downloads.cancel(pending.downloadId);
          } catch (err) {
            // If the download is already gone, ignore.
          }
          try {
            await chrome.downloads.erase({ id: pending.downloadId });
          } catch (err) {
            // Best-effort cleanup of the history entry.
          }
        }
        await clearPendingDownload();
        sendResponse({ ok: true });
      } catch (err) {
        const msg = err && err.message ? err.message : 'Failed to cancel download';
        sendResponse({ ok: false, error: msg });
      }
    })();
    return true;
  }

  if (message.type === 'flowload.getPending') {
    (async () => {
      const data = await chrome.storage.local.get(PENDING_KEY);
      sendResponse({ pending: data[PENDING_KEY] || null });
    })();
    return true;
  }
});

chrome.downloads.onErased.addListener(async () => {
  await clearPendingDownload();
});
