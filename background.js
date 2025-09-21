// 点击扩展图标时，打开播放器页面
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("player.html") });
});
