import { detectEnvironment, queryBluetoothPermission, permissionLabel } from './env.js';
import { BLEManager } from './bluetooth.js';
import { SignalChart } from './signal.js';
import { saveManualConfig, listManualConfigs, deleteManualConfig, addHistory } from './storage.js';

const $ = (id) => document.getElementById(id);
const ble = new BLEManager();
const chart = new SignalChart($('rssi-canvas'));

// ---------- 日志 ----------
function log(msg, level = 'info') {
  const time = new Date().toLocaleTimeString();
  $('log').textContent += `[${time}] ${msg}\n`;
  $('log').scrollTop = $('log').scrollHeight;
  console[level === 'error' ? 'error' : 'log'](msg);
}

// ---------- 状态展示 ----------
function setStatus(id, text, cls = '') {
  const el = $(id);
  el.textContent = text;
  el.className = cls;
}

function setConnectionState(text, cls = '') {
  setStatus('st-connection', text, cls);
  $('btn-disconnect').disabled = !ble.connected;
  $('btn-scan').disabled = ble.connected;
}

function showBanner(message, isError = false) {
  const banner = $('env-banner');
  banner.textContent = message;
  banner.classList.toggle('error', isError);
  banner.classList.remove('hidden');
}

function hideBanner() {
  $('env-banner').classList.add('hidden');
}

// ---------- 环境检测与降级 ----------
async function initEnvironment() {
  const { secure, supported } = detectEnvironment();

  setStatus('st-secure', secure ? '是' : '否（需 HTTPS 或 localhost）', secure ? 'ok' : 'err');
  setStatus('st-support', supported ? '支持' : '不支持', supported ? 'ok' : 'err');

  const perm = await queryBluetoothPermission((state) => {
    const label = permissionLabel(state);
    setStatus('st-permission', label.text, label.cls);
    log(`权限状态变更：${label.text}`);
  });
  const label = permissionLabel(perm.state, perm.note);
  setStatus('st-permission', label.text, label.cls);

  // 三种降级场景分别处理
  if (!secure) {
    showBanner('当前页面不在安全上下文（需要 HTTPS 或 localhost），Web Bluetooth 已被浏览器禁用。已切换到手动模式。', true);
    enterManualMode();
    return;
  }
  if (!supported) {
    showBanner('当前浏览器不支持 Web Bluetooth（请使用 Chrome / Edge 桌面版或 Android 版）。已切换到手动模式。', true);
    enterManualMode();
    return;
  }
  if (perm.state === 'denied') {
    showBanner('蓝牙权限已被拒绝。请在浏览器站点设置中重新允许蓝牙权限，或使用手动模式。', true);
    enterManualMode();
    return;
  }

  // getDevices 可用时允许一键重连已授权设备
  if (navigator.bluetooth.getDevices) {
    $('btn-reconnect-saved').disabled = false;
  }
}

function enterManualMode() {
  $('scan-card').querySelectorAll('button').forEach((b) => (b.disabled = true));
  $('manual-card').classList.remove('hidden');
  renderManualList();
}

// ---------- 手动模式 ----------
async function renderManualList() {
  const list = $('manual-list');
  list.innerHTML = '';
  let items = [];
  try {
    items = await listManualConfigs();
  } catch (err) {
    log(`读取本地配置失败：${err.message}`, 'error');
    return;
  }
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = `${item.name || '(未命名)'} — 服务 ${item.service || '—'} / 特征 ${item.char || '—'} `;
    const del = document.createElement('button');
    del.textContent = '删除';
    del.onclick = async () => {
      await deleteManualConfig(item.id);
      renderManualList();
    };
    li.appendChild(del);
    list.appendChild(li);
  }
}

$('btn-manual-save').addEventListener('click', async () => {
  const config = {
    name: $('manual-name').value.trim(),
    mac: $('manual-mac').value.trim(),
    service: $('manual-service').value.trim(),
    char: $('manual-char').value.trim(),
  };
  if (!config.name) {
    log('手动模式：请填写设备名称', 'error');
    return;
  }
  try {
    await saveManualConfig(config);
    log(`已保存手动配置：${config.name}`);
    renderManualList();
  } catch (err) {
    log(`保存失败：${err.message}`, 'error');
  }
});

// ---------- 扫描与连接 ----------
$('btn-scan').addEventListener('click', async () => {
  hideBanner();
  setConnectionState('扫描中…', 'warn');
  try {
    const device = await ble.scanAndConnect({
      namePrefix: $('filter-name').value.trim(),
      serviceUuid: $('filter-service').value.trim(),
      acceptAll: $('accept-all').checked,
    });
    onConnected(device);
  } catch (err) {
    setConnectionState('未连接', '');
    log(err.message, 'error');
    if (err.message.includes('权限') || err.message.includes('授权')) {
      showBanner(err.message, true);
    }
  }
});

$('btn-reconnect-saved').addEventListener('click', async () => {
  setConnectionState('重连中…', 'warn');
  try {
    const device = await ble.reconnectSavedDevice();
    onConnected(device);
  } catch (err) {
    setConnectionState('未连接', '');
    log(err.message, 'error');
  }
});

$('btn-disconnect').addEventListener('click', () => ble.disconnect());

async function onConnected(device) {
  setConnectionState('已连接', 'ok');
  setStatus('st-disconnect-reason', '—');
  $('dev-name').textContent = device.name || '(未命名设备)';
  $('dev-id').textContent = device.id;
  $('device-card').classList.remove('hidden');
  $('char-card').classList.remove('hidden');
  chart.clear();
  log(`已连接：${device.name || device.id}`);
  addHistory({ event: 'connect', deviceId: device.id, name: device.name || '' }).catch(() => {});
  await renderServices();
}

// ---------- 服务发现 ----------
async function renderServices() {
  const container = $('services-list');
  container.innerHTML = '发现服务中…';
  $('services-card').classList.remove('hidden');
  try {
    const services = await ble.discoverServices();
    container.innerHTML = '';
    if (services.length === 0) {
      container.textContent = '未发现任何主服务。';
      return;
    }
    for (const svc of services) {
      const block = document.createElement('div');
      block.className = 'service-block';
      const title = document.createElement('h3');
      title.textContent = `服务：${svc.uuid}`;
      block.appendChild(title);
      for (const c of svc.characteristics) {
        const row = document.createElement('div');
        row.className = 'char-item';
        const info = document.createElement('span');
        info.innerHTML = `<code>${c.uuid}</code> <span class="props">${c.properties.join(', ') || '无属性'}</span>`;
        const use = document.createElement('button');
        use.textContent = '使用';
        use.onclick = () => {
          $('op-service').value = svc.uuid;
          $('op-char').value = c.uuid;
          log(`已选择特征 ${c.uuid}`);
        };
        row.append(info, use);
        block.appendChild(row);
      }
      container.appendChild(block);
    }
    log(`发现 ${services.length} 个服务`);
  } catch (err) {
    container.innerHTML = '';
    container.textContent = `服务发现失败：${err.message}，可点击重试。`;
    const retry = document.createElement('button');
    retry.textContent = '重试';
    retry.onclick = renderServices;
    container.appendChild(retry);
    log(`服务发现失败：${err.message}`, 'error');
  }
}

// ---------- 特征读写 / 订阅 ----------
$('btn-read').addEventListener('click', async () => {
  try {
    const hex = await ble.readValue($('op-service').value, $('op-char').value);
    $('char-value').textContent = hex;
    log(`读取成功：${hex}`);
  } catch (err) {
    log(err.message, 'error');
  }
});

$('btn-write').addEventListener('click', async () => {
  try {
    await ble.writeValue($('op-service').value, $('op-char').value, $('write-value').value);
    log(`写入成功：${$('write-value').value}`);
  } catch (err) {
    log(err.message, 'error');
  }
});

$('btn-notify').addEventListener('click', async () => {
  try {
    const on = await ble.toggleNotify($('op-service').value, $('op-char').value, (hex) => {
      $('char-value').textContent = hex;
      log(`通知：${hex}`);
    });
    $('btn-notify').textContent = on ? '取消订阅' : '订阅通知';
    log(on ? '已订阅通知' : '已取消订阅');
  } catch (err) {
    log(err.message, 'error');
  }
});

// ---------- BLE 事件 ----------
ble.addEventListener('disconnected', (e) => {
  setConnectionState('未连接', '');
  setStatus('st-disconnect-reason', e.detail.reason, 'warn');
  $('btn-notify').textContent = '订阅通知';
  log(`连接断开：${e.detail.reason}`, 'error');
  addHistory({ event: 'disconnect', reason: e.detail.reason }).catch(() => {});
});

ble.addEventListener('reconnecting', (e) => {
  setConnectionState(`断线重连中（第 ${e.detail.attempt} 次）…`, 'warn');
  log(`尝试自动重连（第 ${e.detail.attempt} 次，${e.detail.delay}ms 后）`);
});

ble.addEventListener('reconnected', (e) => {
  setConnectionState('已连接（自动重连）', 'ok');
  log('自动重连成功');
  renderServices();
});

ble.addEventListener('rssi', (e) => {
  $('dev-rssi').textContent = `${e.detail.rssi} dBm`;
  chart.push(e.detail.rssi);
});

ble.addEventListener('rssi-unavailable', (e) => {
  $('rssi-hint').textContent = e.detail.note;
});

$('btn-clear-log').addEventListener('click', () => {
  $('log').textContent = '';
});

initEnvironment();
