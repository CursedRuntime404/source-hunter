// Opens the side panel and hands it the highlighted claim. The panel itself talks to the server
// (a service worker can be killed mid-trace, a panel page cannot).
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'trace', title: 'Trace this claim with Source Hunter', contexts: ['selection'] }, () => {
      void chrome.runtime.lastError;
    });
  });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

let lastStashKey = '';
let lastStashAt = 0;

async function stash(payload, tabId) {
  const k = `${tabId || ''}|${payload?.claim || ''}`;
  const now = Date.now();
  if (k === lastStashKey && now - lastStashAt < 500) return;
  lastStashKey = k;
  lastStashAt = now;
  await chrome.storage.session.set({ pending: { ...payload, tabId: tabId || payload?.tabId || null, nonce: now } });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  chrome.sidePanel.open({ tabId: tab.id }); // must run synchronously inside the user gesture
  chrome.tabs.sendMessage(tab.id, { type: 'COLLECT' }, (payload) => {
    void chrome.runtime.lastError;
    if (payload) stash(payload, tab.id);
    else stash({ claim: info.selectionText || '', url: tab.url || '', title: tab.title || '', links: [], paragraph: '' }, tab.id);
  });
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'TRACE' && sender.tab) {
    chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
    stash(msg.payload, sender.tab.id);
  }
});

chrome.commands?.onCommand.addListener(async (command, tabArg) => {
  if (command !== 'trace-selection') return;
  if (tabArg?.id) {
    chrome.sidePanel.open({ tabId: tabArg.id }).catch(() => {});
    chrome.tabs.sendMessage(tabArg.id, { type: 'COLLECT' }, (payload) => {
      void chrome.runtime.lastError;
      if (payload) stash(payload, tabArg.id);
    });
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) return;
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  chrome.tabs.sendMessage(tab.id, { type: 'COLLECT' }, (payload) => {
    void chrome.runtime.lastError;
    if (payload) stash(payload, tab.id);
  });
});
