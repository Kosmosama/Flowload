const PENDING_KEY = 'pendingDownload';
const SKIP_IDS = new Set(); // IDs we spawned ourselves to avoid re-intercepting

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
  // If this is a download we re-launched after approval, let it continue.
  if (SKIP_IDS.has(item.id)) {
    SKIP_IDS.delete(item.id);
    suggest({ filename: item.filename, conflictAction: 'uniquify' });
    return;
  }

  const pendingInfo = {
    url: item.finalUrl || item.url,
    filename: item.filename || '',
    extension: extractExtension(item.filename || ''),
    targetPath: item.filename || '',
    createdAt: Date.now()
  };

  await setPendingDownload(pendingInfo);
  await openConfirmationWindow();

  // Cancel the original download so nothing proceeds until user approves.
  try {
    await chrome.downloads.cancel(item.id);
  } catch (err) {
    // If cancel fails (rare), we still tried; nothing else to do.
  }

  // Cancelled downloads do not need a suggestion.
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'flowload.proceedDownload' && message.url) {
    (async () => {
      try {
        const options = {
          url: message.url,
          filename: message.targetPath || undefined,
          saveAs: false
        };

        const newId = await chrome.downloads.download(options);
        if (typeof newId === 'number') {
          SKIP_IDS.add(newId);
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
