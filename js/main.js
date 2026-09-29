import { detectEnvironment, queryBluetoothPermission, EnvState, PermState } from './permissions.js';
import { BluetoothManager } from './bluetooth-manager.js';
import { SignalChart } from './signal-chart.js';
import { createSimulatedDevice } from './simulator.js';
import * as storage from './storage.js';

const $ = (id) => document.getElementById(id);

const ui = {
  envBadge: $('envBadge'),
  permBadge: $('permBadge'),
  connBadge: $('connBadge'),
  bannerArea: $('bannerArea'),
  banner: $('banner'),
  bannerText: $('bannerText'),
  bannerAction: $('bannerAction'),
  scanBtn: $('scanBtn'),
  disconnectBtn: $('disconnectBtn'),
  reconnectBtn: $('reconnectBtn'),
  nameFilter: $('nameFilter'),
  devName: $('devName'),
  devId: $('devId'),
  devGatt: $('devGatt'),
  devRssi: $('devRssi'),
  devDisconnectReason: $('devDisconnectReason'),
  rssiCanvas: $('rssiCanvas'),
  serviceTree: $('serviceTree'),
  svcUuid: $('svcUuid'),
  chrUuid: $('chrUuid'),
  writeValue: $('writeValue'),
  readBtn: $('readBtn'),
  writeBtn: $('writeBtn'),
  subscribeBtn: $('subscribeBtn'),
  opResult: $('opResult'),
  manualPanel: $('manualPanel'),
  manualName: $('manualName'),
  manualRssi: $('manualRssi'),
  manualAddBtn: $('manualAddBtn'),
  simulateBtn: $('simulateBtn'),
  logList: $('logList'),
  clearLogBtn: $('clearLogBtn'),
  exportLogBtn: $('exportLogBtn'),
};

const manager = new BluetoothManager();
const chart = new SignalChart(ui.rssiCanvas);
let unsubscribe = null;
let subscribed = false;

// ---------- 日志 ----------
function log(message, level = 'info') {
  const li = document.createElement('li');
  const time = new Date().toLocaleTimeString();
  li.innerHTML = `<span class="t">${time}</span><span class="${level}"></span>`;
  li.lastElementChild.textContent = message;
  ui.logList.prepend(li);
  storage.saveLog({ ts: Date.now(), level, message }).catch(() => {});
}

// ---------- 徽章与横幅 ----------
function setBadge(el, text, cls) {
  el.textContent = text;
  el.className = `badge ${cls}`;
}

function showBanner(message, isError = false, actionLabel = null, actionFn = null) {
  ui.bannerArea.hidden = false;
  ui.banner.classList.toggle('error', isError);
  ui.bannerText.textContent = message;
  if (actionLabel && actionFn) {
    ui.bannerAction.hidden = false;
    ui.bannerAction.textContent = actionLabel;
    ui.bannerAction.onclick = actionFn;
  } else {
    ui.bannerAction.hidden = true;
    ui.bannerAction.onclick = null;
  }
}

function hideBanner() {
  ui.bannerArea.hidden = true;
}

function enableManualMode(reason) {
  ui.manualPanel.hidden = false;
  showBanner(`${reason} 已切换到手动输入模式。`, true);
  log(`降级到手动输入模式：${reason}`, 'warn');
}

// ---------- 环境检测 ----------
function initEnvironment() {
  const env = detectEnvironment();
  if (env.state === EnvState.INSECURE_CONTEXT) {
    setBadge(ui.envBadge, '非安全上下文', 'badge-err');
    ui.scanBtn.disabled = true;
    enableManualMode(env.message);
  } else if (env.state === EnvState.UNSUPPORTED) {
    setBadge(ui.envBadge, '浏览器不支持', 'badge-err');
    ui.scanBtn.disabled = true;
    enableManualMode(env.message);
  } else {
    setBadge(ui.envBadge, '环境正常', 'badge-ok');
  }
}

async function initPermission() {
  const state = await queryBluetoothPermission((next) => {
    renderPermState(next);
    if (next === PermState.DENIED) {
      enableManualMode('蓝牙权限被拒绝。');
    }
  });
  renderPermState(state);
}

function renderPermState(state) {
  const map = {
    [PermState.GRANTED]: ['权限：已允许', 'badge-ok'],
    [PermState.DENIED]: ['权限：已拒绝', 'badge-err'],
    [PermState.PROMPT]: ['权限：待询问', 'badge-warn'],
    [PermState.UNKNOWN]: ['权限：未知', 'badge-unknown'],
  };
  const [text, cls] = map[state] || map[PermState.UNKNOWN];
  setBadge(ui.permBadge, text, cls);
}

// ---------- 连接状态 ----------
function renderConnState(state, detail = '') {
  const map = {
    disconnected: ['未连接', 'badge-unknown'],
    connecting: [`连接中${detail}`, 'badge-warn'],
    connected: ['已连接', 'badge-ok'],
    error: ['连接失败', 'badge-err'],
  };
  const [text, cls] = map[state];
  setBadge(ui.connBadge, text, cls);
  ui.disconnectBtn.disabled = state !== 'connected';
  ui.reconnectBtn.disabled = !(state === 'disconnected' && manager.device);
  const opsEnabled = state === 'connected';
  ui.readBtn.disabled = !opsEnabled;
  ui.writeBtn.disabled = !opsEnabled;
  ui.subscribeBtn.disabled = !opsEnabled;
  ui.devGatt.textContent = state === 'connected' ? '已连接' : '未连接';
}

// ---------- 服务树 ----------
function renderServiceTree(tree) {
  ui.serviceTree.innerHTML = '';
  if (!tree.length) {
    ui.serviceTree.innerHTML = '<p class="hint">未发现可访问的服务（可能未在 optionalServices 中声明）。</p>';
    return;
  }
  for (const svc of tree) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `服务 ${svc.uuid}（${svc.characteristics.length} 个特征）`;
    details.appendChild(summary);
    const ul = document.createElement('ul');
    for (const c of svc.characteristics) {
      const li = document.createElement('li');
      li.innerHTML = `<code>${c.uuid}</code> <span class="props">[${c.properties.join(', ') || '无属性'}]</span> `;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '选用';
      btn.addEventListener('click', () => {
        ui.svcUuid.value = svc.uuid;
        ui.chrUuid.value = c.uuid;
      });
      li.appendChild(btn);
      ul.appendChild(li);
    }
    details.appendChild(ul);
    ui.serviceTree.appendChild(details);
  }
}

// ---------- 工具 ----------
function parseHex(text) {
  const clean = text.replace(/0x/gi, '').replace(/[\s,]+/g, '');
  if (!clean || clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) {
    throw new Error('写入值格式错误：请输入偶数位的十六进制，如 "01 0A FF"');
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

const toHex = (bytes) => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join(' ');

function normalizeUuid(input) {
  const v = input.trim();
  if (!v) throw new Error('UUID 不能为空');
  return v;
}

// ---------- 管理器事件 ----------
manager.addEventListener('device', (e) => {
  ui.devName.textContent = e.detail.name || '（未命名设备）';
  ui.devId.textContent = e.detail.id;
  ui.devDisconnectReason.textContent = '—';
  storage.saveDevice({ id: e.detail.id, name: e.detail.name, lastSeen: Date.now() }).catch(() => {});
});

manager.addEventListener('connecting', (e) => {
  renderConnState('connecting', `（第 ${e.detail.attempt} 次）`);
});

manager.addEventListener('connected', async () => {
  renderConnState('connected');
  hideBanner();
  log(`已连接：${ui.devName.textContent}`, 'ok');
  const tree = await manager.discoverServices();
  renderServiceTree(tree);
  log(`服务发现完成：${tree.length} 个服务`, 'ok');
});

manager.addEventListener('disconnected', (e) => {
  renderConnState('disconnected');
  ui.devDisconnectReason.textContent = e.detail.reason;
  chart.clear();
  log(`连接断开：${e.detail.reason}`, 'warn');
  if (unsubscribe) { unsubscribe(); unsubscribe = null; subscribed = false; ui.subscribeBtn.textContent = '订阅通知'; }
  showBanner(`连接已断开（${e.detail.reason}）`, false, '重新连接', () => manager.reconnect());
});

manager.addEventListener('rssi', (e) => {
  ui.devRssi.textContent = `${e.detail.rssi} dBm`;
  chart.push(e.detail.rssi);
});

manager.addEventListener('error', (e) => {
  const { kind, message } = e.detail;
  log(message, 'err');
  if (kind === 'permission-denied') {
    renderPermState(PermState.DENIED);
    enableManualMode(message);
  } else if (kind === 'device-not-found') {
    showBanner(message, false, '重试扫描', () => doScan());
  } else if (kind === 'connect-failed') {
    renderConnState('error');
    showBanner(message, true, '重试连接', () => manager.connectWithRetry());
  } else if (kind === 'security' || kind === 'unsupported') {
    enableManualMode(message);
  } else {
    showBanner(message, true);
  }
});

manager.addEventListener('log', (e) => log(e.detail.message, e.detail.level));

// ---------- 交互 ----------
// 注意：requestDevice 必须由用户手势触发，这里直接绑定在 click 上
async function doScan() {
  hideBanner();
  await manager.scanAndConnect(ui.nameFilter.value);
}

ui.scanBtn.addEventListener('click', () => {
  doScan().catch((err) => log(`扫描异常：${err.message || err}`, 'err'));
});

ui.disconnectBtn.addEventListener('click', () => manager.disconnect());
ui.reconnectBtn.addEventListener('click', () => manager.reconnect());

ui.readBtn.addEventListener('click', async () => {
  try {
    const bytes = await manager.readValue(normalizeUuid(ui.svcUuid.value), normalizeUuid(ui.chrUuid.value));
    ui.opResult.textContent = `读取成功：${toHex(bytes)}`;
    log(`读取 ${ui.chrUuid.value}：${toHex(bytes)}`, 'ok');
  } catch (err) {
    ui.opResult.textContent = `读取失败：${err.message}`;
    log(`读取失败：${err.message}`, 'err');
  }
});

ui.writeBtn.addEventListener('click', async () => {
  try {
    const bytes = parseHex(ui.writeValue.value);
    await manager.writeValue(normalizeUuid(ui.svcUuid.value), normalizeUuid(ui.chrUuid.value), bytes);
    ui.opResult.textContent = `写入成功：${toHex(bytes)}`;
    log(`写入 ${ui.chrUuid.value}：${toHex(bytes)}`, 'ok');
  } catch (err) {
    ui.opResult.textContent = `写入失败：${err.message}`;
    log(`写入失败：${err.message}`, 'err');
  }
});

ui.subscribeBtn.addEventListener('click', async () => {
  try {
    if (subscribed && unsubscribe) {
      unsubscribe();
      unsubscribe = null;
      subscribed = false;
      ui.subscribeBtn.textContent = '订阅通知';
      log('已取消订阅');
      return;
    }
    unsubscribe = await manager.subscribe(
      normalizeUuid(ui.svcUuid.value),
      normalizeUuid(ui.chrUuid.value),
      (bytes) => {
        ui.opResult.textContent = `通知：${toHex(bytes)}`;
        log(`通知 ${ui.chrUuid.value}：${toHex(bytes)}`);
      },
    );
    subscribed = true;
    ui.subscribeBtn.textContent = '取消订阅';
    log(`已订阅 ${ui.chrUuid.value} 的通知`, 'ok');
  } catch (err) {
    ui.opResult.textContent = `订阅失败：${err.message}`;
    log(`订阅失败：${err.message}`, 'err');
  }
});

// ---------- 降级：手动输入 ----------
ui.manualAddBtn.addEventListener('click', async () => {
  const name = ui.manualName.value.trim();
  const rssi = Number(ui.manualRssi.value);
  if (!name) {
    log('请输入设备名称', 'warn');
    return;
  }
  try {
    await storage.saveDevice({ id: `manual-${Date.now()}`, name, rssi, lastSeen: Date.now(), manual: true });
    ui.devName.textContent = name;
    ui.devRssi.textContent = `${rssi} dBm`;
    chart.push(rssi);
    log(`已手动记录设备「${name}」（RSSI ${rssi} dBm）到本地`, 'ok');
  } catch (err) {
    log(`保存失败：${err.message}`, 'err');
  }
});

ui.simulateBtn.addEventListener('click', async () => {
  log('启动模拟设备…');
  manager.attachDevice(createSimulatedDevice());
  const ok = await manager.connectWithRetry();
  if (ok) hideBanner();
});

// ---------- 日志管理 ----------
ui.clearLogBtn.addEventListener('click', async () => {
  ui.logList.innerHTML = '';
  await storage.clearLogs().catch(() => {});
});

ui.exportLogBtn.addEventListener('click', async () => {
  const logs = await storage.getAllLogs().catch(() => []);
  const text = logs.map((l) => `[${new Date(l.ts).toISOString()}] [${l.level}] ${l.message}`).join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bt-logs-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------- 启动 ----------
initEnvironment();
initPermission();
renderConnState('disconnected');
log('控制台已就绪。');
