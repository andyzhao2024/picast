// =================== 配置与状态 ===================
const imageExts = new Set([".jpg",".jpeg",".png",".webp",".gif",".bmp",".avif",".tiff",".svg"]);
let handles = [];      // [{name,url,fileHandle,lastModified}]
let idx = 0;
let timer = null;
let isPlaying = true;
let direction = 1;
let intervalMs = 3000;
let spaceLastTime = 0;

// DOM元素
const stage = document.getElementById("stage");
const frame = document.getElementById("frame");
const hud = document.getElementById("hud");
const panel = document.getElementById("panel");

const pickDirBtn = document.getElementById("pickDirBtn");
const recursiveChk = document.getElementById("recursiveChk");
const intervalInput = document.getElementById("intervalInput");
const startBtn = document.getElementById("startBtn");
const statusEl = document.getElementById("status");

const autoFitChk = document.getElementById("autoFitChk");
const maxScaleRange = document.getElementById("maxScaleRange");
const maxScaleLabel = document.getElementById("maxScaleLabel");
const pixelateChk = document.getElementById("pixelateChk");

const gifScaleRow = document.getElementById("gifScaleRow");
const gifScaleRange = document.getElementById("gifScaleRange");
const gifScaleLabel = document.getElementById("gifScaleLabel");

// 默认/用户设置
let userMaxScale = parseFloat(maxScaleRange.value) || 1.5;
let userAdjustedMaxScale = false; // 用户是否手动调整过 maxScale slider
let userGifScale = parseFloat(gifScaleRange.value) || 1.0;
let gifScaleLockedByUser = false;  // GIF slider 是否由用户锁定

// =================== 小工具 ===================
function extOf(name){ const i = name.lastIndexOf("."); return i<0?"":name.slice(i).toLowerCase(); }
function isImageName(name){ return imageExts.has(extOf(name)); }
function naturalSortByName(a,b){ return a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:"base"});}
// 替换为这个版本（在全屏时会抑制所有 HUD 显示，保持纯净影院）
function showHUD(text, ms = 1200) {
  // 如果当前处于全屏播放（影院模式），不显示任何 HUD（保持纯净画面）
  if (document.fullscreenElement) return;

  // 否则在非全屏（配置面板可见）时，正常显示短暂 HUD 提示
  hud.textContent = text;
  hud.classList.remove("hidden");
  clearTimeout(showHUD._t);
  showHUD._t = setTimeout(() => hud.classList.add("hidden"), ms);
}
function showStatus(text){ statusEl.textContent=text; }

// =================== 全屏操作 ===================
async function enterFullscreen(){ if(!document.fullscreenElement) await stage.requestFullscreen({navigationUI:"hide"}).catch(()=>{}); }
async function exitFullscreen(){ if(document.fullscreenElement) await document.exitFullscreen().catch(()=>{}); }

// =================== 目录选择与扫描 ===================
async function pickDirectory(){
    try{
        handles.length=0;
        showStatus("等待目录选择…");
        const dirHandle = await window.showDirectoryPicker({mode:"read"});
        showStatus("扫描图片…");
        await enumerateDir(dirHandle, recursiveChk.checked);
        handles.sort(naturalSortByName);
        if(handles.length===0){ startBtn.disabled=true; showStatus("未发现图片。"); }
        else{ startBtn.disabled=false; showStatus(`已发现 ${handles.length} 张图片`); }
    }catch(e){
        if(e && e.name==="AbortError") return;
        startBtn.disabled=true;
        showStatus("未选取目录或没有访问权限。");
    }
}

async function enumerateDir(dirHandle, recursive){
    for await(const [name,entry] of dirHandle.entries()){
        if(entry.kind==="file" && isImageName(name)){
            const file = await entry.getFile();
            const url = URL.createObjectURL(file);
            handles.push({name,url,fileHandle:entry,lastModified:file.lastModified});
        } else if(entry.kind==="directory" && recursive){
            await enumerateDir(entry,true);
        }
    }
}

// =================== 建议 maxScale（方案 C） ===================
function suggestMaxScaleBySize(naturalW, naturalH) {
    const maxSide = Math.max(naturalW || 0, naturalH || 0);
    if (maxSide <= 200) return 3.0;
    if (maxSide <= 400) return 2.5;
    if (maxSide <= 800) return 2.0;
    if (maxSide <= 1600) return 1.5;
    return 1.2;
}

function savePrefs(){
    chrome.storage?.local?.set?.({
        picastAutoFit: autoFitChk.checked,
        picastPixelate: pixelateChk.checked,
        picastMaxScale: userMaxScale,
        picastIntervalMs: intervalMs
    });
}

// =================== 放大/尺寸计算助手 ===================
function fitImageDefault(){
    frame.style.width = "";
    frame.style.height = "";
    frame.style.maxWidth = "100vw";
    frame.style.maxHeight = "100vh";
    frame.style.objectFit = "contain";
}

function viewportSize(){
    return {
        vw: Math.max(window.innerWidth || document.documentElement.clientWidth, 1),
        vh: Math.max(window.innerHeight || document.documentElement.clientHeight, 1)
    };
}

function applyOptimalSizing(naturalW, naturalH, isGif){
    if(!autoFitChk.checked || !naturalW || !naturalH){
        if(pixelateChk.checked && isGif) frame.classList.add("pixelated"); else frame.classList.remove("pixelated");
        fitImageDefault();
        return;
    }

    const { vw, vh } = viewportSize();
    const baseScale = Math.min(vw / naturalW, vh / naturalH);

    if (baseScale < 1) {
        frame.classList.remove("pixelated");
        fitImageDefault();
        return;
    }

    const targetScale = Math.min(baseScale, userMaxScale);
    const shouldPixelate = (isGif && (pixelateChk.checked || targetScale > 1.2));
    if (shouldPixelate) frame.classList.add("pixelated"); else frame.classList.remove("pixelated");

    const targetW = Math.round(naturalW * targetScale);
    const targetH = Math.round(naturalH * targetScale);

    frame.style.width = Math.min(targetW, vw) + "px";
    frame.style.height = Math.min(targetH, vh) + "px";
    frame.style.maxWidth = "";
    frame.style.maxHeight = "";
    frame.style.objectFit = "contain";
}

// GIF 专用：根据用户设置的 userGifScale 应用（保持长宽比并不超出视窗）
function applyGifScale(naturalW, naturalH, scale) {
    const { vw, vh } = viewportSize();
    let targetW = Math.round(naturalW * scale);
    let targetH = Math.round(naturalH * scale);

    if (targetW > vw || targetH > vh) {
        const r = Math.min(vw / targetW, vh / targetH);
        targetW = Math.round(targetW * r);
        targetH = Math.round(targetH * r);
    }

    frame.style.width = targetW + "px";
    frame.style.height = targetH + "px";
    frame.style.objectFit = "contain";

    if (pixelateChk.checked) frame.classList.add("pixelated");
    else frame.classList.remove("pixelated");
}

// =================== 展示图片与稳定播放逻辑 ===================
function showAt(i){
    if(!handles[i]) return;
    idx = (i + handles.length) % handles.length;
    const item = handles[idx];

    if(frame.dataset.url) try{ URL.revokeObjectURL(frame.dataset.url); }catch(e){}
    frame.src = item.url;
    frame.dataset.url = item.url;

    fitImageDefault();

    frame.onload = () => {
        const nw = frame.naturalWidth || frame.width;
        const nh = frame.naturalHeight || frame.height;
        const isGif = extOf(item.name) === ".gif";

        // 推荐 value 并在用户未手动修改时自动应用
        const suggested = suggestMaxScaleBySize(nw, nh);
        if(!userAdjustedMaxScale) {
            userMaxScale = suggested;
            maxScaleRange.value = String(userMaxScale);
            maxScaleLabel.textContent = userMaxScale.toFixed(1) + "×";
            savePrefs();
            showHUD(`建议 maxScale: ${userMaxScale.toFixed(1)}×（已自动应用）`, 1400);
        } else {
            showHUD(`建议 maxScale: ${suggested.toFixed(1)}×（当前 ${userMaxScale.toFixed(1)}×）`, 1400);
        }

        // GIF 专用滑块显示/初始化
        if (isGif) {
            gifScaleRow.style.display = "flex";
            if (!gifScaleLockedByUser) {
                // 默认建议给 gif 的 slider：baseScale 或 userMaxScale 二者之间
                const { vw, vh } = viewportSize();
                const baseScale = Math.min(vw / nw, vh / nh);
                const init = baseScale < 1 ? 1.0 : Math.min(baseScale, userMaxScale || 1.5);
                userGifScale = Math.max(parseFloat(gifScaleRange.min), Math.min(init, parseFloat(gifScaleRange.max)));
                gifScaleRange.value = String(userGifScale);
                gifScaleLabel.textContent = userGifScale.toFixed(1) + "×";
            } else {
                gifScaleRange.value = String(userGifScale);
                gifScaleLabel.textContent = userGifScale.toFixed(1) + "×";
            }
            // 应用 GIF 专用放大
            applyGifScale(nw, nh, userGifScale);
        } else {
            gifScaleRow.style.display = "none";
            frame.classList.remove("pixelated");
            applyOptimalSizing(nw, nh, false);
        }

        showHUD(`${idx+1}/${handles.length} · ${item.name}`, 900);
    };

    frame.onerror = () => {
        showHUD(`无法加载：${item.name}`, 1200);
    };
}

function scheduleNext(){
    clearTimeout(timer);
    if(!isPlaying || handles.length===0) return;
    idx = (idx + direction + handles.length) % handles.length;
    showAt(idx);
    timer = setTimeout(scheduleNext, intervalMs);
}

function play(dir=1){
    direction = dir>=0 ? 1 : -1;
    isPlaying = true;
    if(!frame.src) showAt(idx);
    timer = setTimeout(scheduleNext, intervalMs);
}

function pauseAuto(){ clearTimeout(timer); }

// =================== 事件绑定 ===================
pickDirBtn.addEventListener("click", pickDirectory);

intervalInput.addEventListener("change", ()=>{
    const v = Math.max(0.5, parseFloat(intervalInput.value || "3"));
    intervalInput.value = String(v);
    intervalMs = Math.round(v*1000);
    savePrefs();
    showHUD(`切换间隔：${v}s`);
});

// maxScale slider
maxScaleRange.addEventListener("input", ()=> {
    userMaxScale = parseFloat(maxScaleRange.value);
    maxScaleLabel.textContent = userMaxScale.toFixed(1) + "×";
    userAdjustedMaxScale = true;
    savePrefs();
    // 立即应用 sizing（若在播放中）
    if(panel.style.display === "none" && handles.length > 0) {
        const cur = handles[idx];
        if (cur) {
            const nw = frame.naturalWidth || frame.width;
            const nh = frame.naturalHeight || frame.height;
            const isGif = extOf(cur.name) === ".gif";
            if (isGif) applyGifScale(nw, nh, userGifScale);
            else applyOptimalSizing(nw, nh, isGif);
        }
    }
});

autoFitChk.addEventListener("change", savePrefs);
pixelateChk.addEventListener("change", savePrefs);

// GIF slider interaction
gifScaleRange.addEventListener("input", () => {
    const v = Math.max(parseFloat(gifScaleRange.min), Math.min(parseFloat(gifScaleRange.value), parseFloat(gifScaleRange.max)));
    userGifScale = v;
    gifScaleLabel.textContent = v.toFixed(1) + "×";
    gifScaleLockedByUser = true;
    // 立即应用到当前 GIF（若是）
    const cur = handles[idx];
    if (cur && extOf(cur.name) === ".gif") {
        const nw = frame.naturalWidth || frame.width;
        const nh = frame.naturalHeight || frame.height;
        applyGifScale(nw, nh, userGifScale);
    }
    // （可选）保存 last GIF scale: chrome.storage.local.set({ lastUserGifScale: userGifScale });
});

startBtn.addEventListener("click", async ()=>{
    if(handles.length === 0){ showStatus("请先选择目录"); return; }
    intervalMs = Math.max(500, parseFloat(intervalInput.value || 3) * 1000);

    // 恢复偏好（若有）
    const obj = await chrome.storage?.local?.get?.(["picastAutoFit","picastPixelate","picastMaxScale","picastIntervalMs"]);
    if(obj) {
        if(typeof obj.picastAutoFit === "boolean") autoFitChk.checked = obj.picastAutoFit;
        if(typeof obj.picastPixelate === "boolean") pixelateChk.checked = obj.picastPixelate;
        if(typeof obj.picastMaxScale === "number" && !userAdjustedMaxScale) {
            userMaxScale = obj.picastMaxScale;
            maxScaleRange.value = String(userMaxScale);
            maxScaleLabel.textContent = userMaxScale.toFixed(1) + "×";
        }
        if(typeof obj.picastIntervalMs === "number") { intervalMs = obj.picastIntervalMs; intervalInput.value = String(Math.max(0.5, intervalMs/1000)); }
    } else {
        maxScaleLabel.textContent = userMaxScale.toFixed(1) + "×";
    }

    await enterFullscreen();
    panel.style.display = "none";
    stage.style.backgroundColor = "black";
    showAt(idx);
    isPlaying = true;
    timer = setTimeout(scheduleNext, intervalMs);
    stage.focus();
});

// 键盘控制（空格单击暂停/继续；双空格退出）
window.addEventListener("keydown", e=>{
    if(panel.style.display !== "none") return;
    if(!handles.length) return;

    if(e.code === "Space"){
        const now = Date.now();
        if(now - spaceLastTime < 350){ exitFullscreen(); spaceLastTime = 0; e.preventDefault(); return; }
        spaceLastTime = now;
        isPlaying = !isPlaying;
        if(isPlaying) scheduleNext(); else pauseAuto();
        e.preventDefault();
        return;
    }

    if(e.code === "ArrowRight"){ idx = (idx+1)%handles.length; showAt(idx); if(isPlaying) scheduleNext(); e.preventDefault(); }
    if(e.code === "ArrowLeft") { idx = (idx-1+handles.length)%handles.length; showAt(idx); if(isPlaying) scheduleNext(); e.preventDefault(); }
});

// 鼠标隐藏（影院体验）
let mouseTimer = null;
stage.addEventListener("mousemove", () => {
    stage.style.cursor = "default";
    clearTimeout(mouseTimer);
    mouseTimer = setTimeout(() => stage.style.cursor = "none", 1200);
});

// 全屏变化
document.addEventListener("fullscreenchange", () => {
    if(!document.fullscreenElement) { pauseAuto(); panel.style.display = "block"; }
});

// 页面隐藏/显示
document.addEventListener("visibilitychange", () => {
    if(panel.style.display !== "none") return;
    if(document.hidden) pauseAuto(); else if(isPlaying) scheduleNext();
});

// 窗口缩放：重新计算 sizing，并在未手动调整时更新建议
window.addEventListener("resize", () => {
    if(panel.style.display === "none" && handles.length > 0) {
        const cur = handles[idx];
        if(cur) {
            const nw = frame.naturalWidth || frame.width;
            const nh = frame.naturalHeight || frame.height;
            const isGif = extOf(cur.name) === ".gif";

            const suggested = suggestMaxScaleBySize(nw, nh);
            if(!userAdjustedMaxScale) {
                userMaxScale = suggested;
                maxScaleRange.value = String(userMaxScale);
                maxScaleLabel.textContent = userMaxScale.toFixed(1)+"×";
                savePrefs();
            }

            if(isGif) applyGifScale(nw, nh, userGifScale);
            else applyOptimalSizing(nw, nh, isGif);
        }
    }
});

// 初始化 UI（读取 prefs）
(async () => {
    const obj = await chrome.storage?.local?.get?.(["picastAutoFit","picastPixelate","picastMaxScale","picastIntervalMs"]);
    if(obj) {
        if(typeof obj.picastAutoFit === "boolean") autoFitChk.checked = obj.picastAutoFit;
        if(typeof obj.picastPixelate === "boolean") pixelateChk.checked = obj.picastPixelate;
        if(typeof obj.picastMaxScale === "number") { userMaxScale = obj.picastMaxScale; maxScaleRange.value = String(userMaxScale); }
        if(typeof obj.picastIntervalMs === "number") { intervalMs = obj.picastIntervalMs; intervalInput.value = String(Math.max(0.5, intervalMs/1000)); }
    }
    maxScaleLabel.textContent = userMaxScale.toFixed(1) + "×";
    fitImageDefault();
})();
