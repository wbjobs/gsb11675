// 蓝牙核心逻辑：扫描、连接（带重试）、服务发现、读写、订阅、断线重连、RSSI 监听
import { classifyRequestError } from './permissions.js';

// 常用标准服务，requestDevice 时必须声明才能访问
const OPTIONAL_SERVICES = [
  'generic_access', 'generic_attribute', 'device_information',
  'battery_service', 'heart_rate', 'health_thermometer',
  'blood_pressure', 'current_time_service', 'immediate_alert',
  'link_loss', 'tx_power', 'user_data', 'cycling_power',
  'cycling_speed_and_cadence', 'running_speed_and_cadence',
  'environmental_sensing', 'body_composition', 'weight_scale',
  'pulse_oximeter', 'continuous_glucose_monitoring',
  'fitness_machine', 'alert_notification', 'phone_alert_status',
  'human_interface_device', 'scan_parameters', 'automation_io',
  0x1800, 0x1801, 0x180A, 0x180F, 0x1812,
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class BluetoothManager extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.server = null;
    this.disconnectReason = null;
    this._manualDisconnect = false;
    this._rssiAbort = null;
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  // 必须由用户手势触发；任何失败都转为事件，不向外抛异常
  async scanAndConnect(namePrefix = '') {
    if (!('bluetooth' in navigator)) {
      this._emit('error', { kind: 'unsupported', message: '浏览器不支持 Web Bluetooth。' });
      return false;
    }
    const options = {
      optionalServices: OPTIONAL_SERVICES,
    };
    if (namePrefix && namePrefix.trim()) {
      options.filters = [{ namePrefix: namePrefix.trim() }];
    } else {
      options.acceptAllDevices = true;
    }

    let device;
    try {
      device = await navigator.bluetooth.requestDevice(options);
    } catch (err) {
      const info = classifyRequestError(err);
      this._emit('error', info);
      return false;
    }

    this._attachDevice(device);
    return this.connectWithRetry();
  }

  _attachDevice(device) {
    this._detachDevice();
    this.device = device;
    this.disconnectReason = null;
    this._manualDisconnect = false;
    this._onDisconnected = () => this._handleDisconnected();
    device.addEventListener('gattserverdisconnected', this._onDisconnected);
    device.addEventListener('advertisementreceived', (e) => {
      if (typeof e.rssi === 'number') this._emit('rssi', { rssi: e.rssi });
    });
    this._emit('device', { name: device.name, id: device.id });
  }

  // 供模拟设备等外部来源注入（降级 / 演示模式）
  attachDevice(device) {
    this._attachDevice(device);
  }

  _detachDevice() {
    if (this.device && this._onDisconnected) {
      this.device.removeEventListener('gattserverdisconnected', this._onDisconnected);
    }
    this._stopRssiWatch();
    this.device = null;
    this.server = null;
  }

  // 指数退避重试连接
  async connectWithRetry(maxAttempts = 3) {
    if (!this.device) return false;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        this._emit('connecting', { attempt, maxAttempts });
        this.server = await this.device.gatt.connect();
        this._emit('connected', {});
        this._startRssiWatch();
        return true;
      } catch (err) {
        this._emit('log', {
          level: 'warn',
          message: `连接失败（第 ${attempt}/${maxAttempts} 次）：${err.message || err}`,
        });
        if (attempt < maxAttempts) await sleep(500 * 2 ** (attempt - 1));
      }
    }
    this._emit('error', { kind: 'connect-failed', message: `连接失败，已重试 ${maxAttempts} 次。` });
    return false;
  }

  async reconnect() {
    if (!this.device) {
      this._emit('error', { kind: 'no-device', message: '没有可重连的设备，请先扫描。' });
      return false;
    }
    if (this.device.gatt.connected) return true;
    return this.connectWithRetry();
  }

  disconnect() {
    this._manualDisconnect = true;
    this.disconnectReason = '用户主动断开';
    if (this.device && this.device.gatt.connected) {
      this.device.gatt.disconnect();
    } else {
      this._emit('disconnected', { reason: this.disconnectReason });
    }
  }

  _handleDisconnected() {
    this._stopRssiWatch();
    this.server = null;
    if (!this.disconnectReason) {
      this.disconnectReason = this._manualDisconnect
        ? '用户主动断开'
        : '设备断开（可能超出范围、电量不足或设备主动关闭连接）';
    }
    this._emit('disconnected', { reason: this.disconnectReason });
  }

  async _startRssiWatch() {
    if (this.device && typeof this.device.startRssi === 'function') {
      this._simStopRssi = this.device.startRssi((rssi) => this._emit('rssi', { rssi }));
      return;
    }
    if (!this.device || typeof this.device.watchAdvertisements !== 'function') {
      this._emit('log', { level: 'warn', message: '此浏览器不支持 watchAdvertisements，无法实时显示 RSSI。' });
      return;
    }
    try {
      this._rssiAbort = new AbortController();
      await this.device.watchAdvertisements({ signal: this._rssiAbort.signal });
      this._emit('log', { level: 'ok', message: '已开始监听广播包（RSSI）。' });
    } catch (err) {
      this._emit('log', { level: 'warn', message: `RSSI 监听不可用：${err.message || err}` });
    }
  }

  _stopRssiWatch() {
    if (this._simStopRssi) {
      this._simStopRssi();
      this._simStopRssi = null;
    }
    if (this._rssiAbort) {
      this._rssiAbort.abort();
      this._rssiAbort = null;
    }
  }

  async discoverServices() {
    if (!this.server) return [];
    try {
      const services = await this.server.getPrimaryServices();
      const tree = [];
      for (const service of services) {
        const chars = await service.getCharacteristics();
        tree.push({
          uuid: service.uuid,
          characteristics: chars.map((c) => ({
            uuid: c.uuid,
            properties: Object.entries({
              read: c.properties.read,
              write: c.properties.write,
              writeWithoutResponse: c.properties.writeWithoutResponse,
              notify: c.properties.notify,
              indicate: c.properties.indicate,
            }).filter(([, v]) => v).map(([k]) => k),
          })),
        });
      }
      return tree;
    } catch (err) {
      this._emit('error', { kind: 'discover-failed', message: `服务发现失败：${err.message || err}` });
      return [];
    }
  }

  async _getCharacteristic(serviceUuid, charUuid) {
    if (!this.server) throw new Error('设备未连接');
    let service;
    try {
      service = await this.server.getPrimaryService(serviceUuid);
    } catch (err) {
      const e = new Error(`服务不匹配：设备上找不到服务 ${serviceUuid}`);
      e.kind = 'service-mismatch';
      throw e;
    }
    try {
      return await service.getCharacteristic(charUuid);
    } catch (err) {
      const e = new Error(`特征不存在：服务 ${serviceUuid} 下找不到特征 ${charUuid}`);
      e.kind = 'characteristic-mismatch';
      throw e;
    }
  }

  // 读写失败自动重试一次（GATT 偶发 in-progress 错误）
  async _withRetry(fn, label) {
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        this._emit('log', { level: 'warn', message: `${label}失败（第 ${attempt} 次）：${err.message || err}` });
        if (attempt < 2) await sleep(300);
      }
    }
    throw lastErr;
  }

  async readValue(serviceUuid, charUuid) {
    const char = await this._getCharacteristic(serviceUuid, charUuid);
    const value = await this._withRetry(() => char.readValue(), '读取');
    return new Uint8Array(value.buffer);
  }

  async writeValue(serviceUuid, charUuid, bytes) {
    const char = await this._getCharacteristic(serviceUuid, charUuid);
    await this._withRetry(() => char.writeValue(bytes), '写入');
  }

  async subscribe(serviceUuid, charUuid, onData) {
    const char = await this._getCharacteristic(serviceUuid, charUuid);
    await char.startNotifications();
    const handler = (e) => onData(new Uint8Array(e.target.value.buffer));
    char.addEventListener('characteristicvaluechanged', handler);
    return () => {
      char.removeEventListener('characteristicvaluechanged', handler);
      char.stopNotifications().catch(() => {});
    };
  }
}
