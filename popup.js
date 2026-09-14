const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const [{ result }] = await chrome.scripting.executeScript({
  target: { tabId: tab.id },
  world: 'MAIN',
  func: () => typeof mParticle === 'undefined' ? 'mParticle not found' : `mParticle ${mParticle.getVersion?.() ?? ''} detected`,
});
document.getElementById('out').textContent = result;
