const PENDING_KEY = 'pendingDownload';
const WINDOW_STATE_KEY = 'pendingDownloadWindow';

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
  await chrome.storage.local.remove([PENDING_KEY, WINDOW_STATE_KEY]);
}

async function openConfirmationWindow() {
  const existing = await chrome.storage.local.get(WINDOW_STATE_KEY);
  if (existing?.[WINDOW_STATE_KEY]?.windowId) {
    try {
      const win = await chrome.windows.get(existing[WINDOW_STATE_KEY].windowId);
      if (win) {
        if (win.state === 'minimized') {
          await chrome.windows.update(win.id, { focused: true, state: 'normal' });
        } else {
          await chrome.windows.update(win.id, { focused: true });
        }
        return;
      }
    } catch (err) {
      // window not found; fall through to create a new one
    }
  }

  const created = await chrome.windows.create({
    url: chrome.runtime.getURL('index.html'),
    type: 'popup',
    width: 420,
    height: 420
  });

  if (created?.id) {
    await chrome.storage.local.set({ [WINDOW_STATE_KEY]: { windowId: created.id } });
  }
}

chrome.downloads.onCreated.addListener(async (item) => {
  try {
    await chrome.downloads.pause(item.id);
  } catch (err) {
    // If we fail to pause (e.g., not in progress yet), proceed anyway.
  }

  const pendingInfo = {
    downloadId: item.id,
    url: item.url,
    filename: item.filename || '',
    extension: extractExtension(item.filename || ''),
    targetPath: item.filename || '',
    state: 'waiting',
    createdAt: Date.now()
  };

  await setPendingDownload(pendingInfo);
  await openConfirmationWindow();
});

chrome.downloads.onDeterminingFilename.addListener(async (item, suggest) => {
  const updated = {
    downloadId: item.id,
    url: item.finalUrl || item.url,
    filename: item.filename,
    extension: extractExtension(item.filename),
    targetPath: item.filename,
    state: 'waiting',
    createdAt: Date.now()
  };

  await setPendingDownload(updated);

  // Keep the default suggestion; we only gate via pause/resume.
  suggest({ filename: item.filename, conflictAction: 'uniquify' });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'flowload.proceedDownload' && typeof message.downloadId === 'number') {
    (async () => {
      try {
        await chrome.downloads.resume(message.downloadId);
      } catch (err) {
        // Resume may fail if already in progress; ignore.
      }
      await clearPendingDownload();
      sendResponse({ ok: true });
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

chrome.downloads.onErased.addListener(async (downloadId) => {
  const data = await chrome.storage.local.get(PENDING_KEY);
  if (data[PENDING_KEY]?.downloadId === downloadId) {
    await clearPendingDownload();
  }
});
