// BLE 管理器：扫描、连接、重连、服务发现、读写、订阅
// 所有错误分类：用户取消/设备未找到(NotFoundError)、无用户手势(SecurityError)、
// 连接失败(NetworkError)、服务不匹配(NotFoundError on getService)、读写失败

export const DisconnectReason = {
  USER: '用户主动断开',
  DEVICE_LOST: '设备断开（超出范围/关机/链路丢失）',
  GATT_ERROR: 'GATT 错误导致断开',
  UNKNOWN: '未知原因',
};

export class BLEManager extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.server = null;
    this.manualDisconnect = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.reconnectTimer = null;
    this.watchingAds = false;
  }

  get connected() {
    return !!(this.device && this.device.gatt && this.device.gatt.connected);
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  // 扫描并请求设备。必须由用户手势触发，否则抛 SecurityError（此处捕获并上报，不崩溃）
  async scanAndConnect({ namePrefix = '', serviceUuid = '', acceptAll = false } = {}) {
    const options = { optionalServices: [] };
    const filters = [];

    let parsedService = null;
    if (serviceUuid) {
      parsedService = this._parseUuid(serviceUuid);
      if (parsedService === null) {
        throw new Error(`服务 UUID 格式无效：${serviceUuid}`);
      }
      options.optionalServices.push(parsedService);
    }

    if (acceptAll) {
      options.acceptAllDevices = true;
      if (parsedService !== null) options.optionalServices.push(parsedService);
    } else {
      if (namePrefix) filters.push({ namePrefix });
      if (parsedService !== null) filters.push({ services: [parsedService] });
      if (filters.length === 0) {
        // 无过滤条件时必须 acceptAllDevices，否则 Chrome 会报错
        options.acceptAllDevices = true;
      } else {
        options.filters = filters;
      }
    }

    let device;
    try {
      device = await navigator.bluetooth.requestDevice(options);
    } catch (err) {
      throw this._classifyRequestError(err);
    }

    this._attachDevice(device);
    await this._connectGatt();
    return device;
  }

  // 重连此前已授权的设备（Chrome 85+，无需再次弹窗）
  async reconnectSavedDevice() {
    if (!navigator.bluetooth.getDevices) {
      throw new Error('当前浏览器不支持 getDevices()，请使用扫描连接');
    }
    const devices = await navigator.bluetooth.getDevices();
    if (devices.length === 0) {
      throw new Error('没有已授权的设备记录，请先扫描连接');
    }
    const device = devices[0];
    this._attachDevice(device);
    await this._connectGatt();
    return device;
  }

  _attachDevice(device) {
    this._detachDevice();
    this.device = device;
    this.manualDisconnect = false;
    this.reconnectAttempts = 0;
    this._onDisconnect = () => this._handleDisconnect();
    device.addEventListener('gattserverdisconnected', this._onDisconnect);
    device.addEventListener('advertisementreceived', (e) => this._emit('rssi', { rssi: e.rssi }));
  }

  _detachDevice() {
    if (this.device && this._onDisconnect) {
      this.device.removeEventListener('gattserverdisconnected', this._onDisconnect);
    }
    this._stopWatchingAds();
    clearTimeout(this.reconnectTimer);
    this.device = null;
    this.server = null;
  }

  async _connectGatt() {
    try {
      this.server = await this.device.gatt.connect();
      this._emit('connected', { device: this.device });
      this._startWatchingAds();
    } catch (err) {
      // NetworkError：设备不在附近/连接超时，可重试
      throw this._classifyConnectError(err);
    }
  }

  async _handleDisconnect() {
    this._stopWatchingAds();
    const reason = this.manualDisconnect ? DisconnectReason.USER : DisconnectReason.DEVICE_LOST;
    this._emit('disconnected', { reason });

    // 非用户主动断开时自动重连（指数退避）
    if (!this.manualDisconnect && this.device && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts += 1;
      const delay = 1000 * 2 ** (this.reconnectAttempts - 1);
      this._emit('reconnecting', { attempt: this.reconnectAttempts, delay });
      this.reconnectTimer = setTimeout(async () => {
        try {
          await this._connectGatt();
          this.reconnectAttempts = 0;
          this._emit('reconnected', { device: this.device });
        } catch (err) {
          this._handleDisconnect();
        }
      }, delay);
    }
  }

  async disconnect() {
    this.manualDisconnect = true;
    clearTimeout(this.reconnectTimer);
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    } else {
      this._emit('disconnected', { reason: DisconnectReason.USER });
    }
  }

  // 服务发现：返回 [{ uuid, characteristics: [{ uuid, properties }] }]
  async discoverServices() {
    if (!this.connected) throw new Error('设备未连接');
    const services = await this.server.getPrimaryServices();
    const result = [];
    for (const service of services) {
      const chars = await service.getCharacteristics();
      result.push({
        uuid: service.uuid,
        characteristics: chars.map((c) => ({
          uuid: c.uuid,
          properties: this._propertyNames(c.properties),
        })),
      });
    }
    return result;
  }

  async _getCharacteristic(serviceUuid, charUuid) {
    if (!this.connected) throw new Error('设备未连接');
    const svc = this._parseUuid(serviceUuid);
    const chr = this._parseUuid(charUuid);
    if (svc === null) throw new Error(`服务 UUID 格式无效：${serviceUuid}`);
    if (chr === null) throw new Error(`特征 UUID 格式无效：${charUuid}`);
    let service;
    try {
      service = await this.server.getPrimaryService(svc);
    } catch (err) {
      throw new Error(`服务不匹配：设备上不存在服务 ${serviceUuid}（${err.name}）`);
    }
    try {
      return await service.getCharacteristic(chr);
    } catch (err) {
      throw new Error(`特征不存在：服务 ${serviceUuid} 上不存在特征 ${charUuid}（${err.name}）`);
    }
  }

  async readValue(serviceUuid, charUuid) {
    const ch = await this._getCharacteristic(serviceUuid, charUuid);
    try {
      const value = await ch.readValue();
      return this._toHex(value);
    } catch (err) {
      throw new Error(`读取失败（${err.name}: ${err.message}），可重试`);
    }
  }

  async writeValue(serviceUuid, charUuid, hexString) {
    const ch = await this._getCharacteristic(serviceUuid, charUuid);
    const bytes = this._fromHex(hexString);
    if (!bytes) throw new Error(`写入值格式无效：${hexString}（应为 hex，如 "01 0A FF"）`);
    try {
      if (ch.writeValueWithResponse) {
        await ch.writeValueWithResponse(bytes);
      } else {
        await ch.writeValue(bytes);
      }
    } catch (err) {
      throw new Error(`写入失败（${err.name}: ${err.message}），可重试`);
    }
  }

  async toggleNotify(serviceUuid, charUuid, onData) {
    const ch = await this._getCharacteristic(serviceUuid, charUuid);
    if (this._notifyChar === ch) {
      await ch.stopNotifications();
      ch.removeEventListener('characteristicvaluechanged', this._notifyHandler);
      this._notifyChar = null;
      this._notifyHandler = null;
      return false;
    }
    try {
      await ch.startNotifications();
    } catch (err) {
      throw new Error(`订阅失败（${err.name}: ${err.message}），可重试`);
    }
    this._notifyHandler = (e) => onData(this._toHex(e.target.value));
    ch.addEventListener('characteristicvaluechanged', this._notifyHandler);
    this._notifyChar = ch;
    return true;
  }

  // RSSI 监听：watchAdvertisements 仅部分 Chrome 版本支持
  async _startWatchingAds() {
    if (!this.device || !this.device.watchAdvertisements) {
      this._emit('rssi-unavailable', { note: '当前浏览器不支持 watchAdvertisements，无法显示实时信号' });
      return;
    }
    try {
      await this.device.watchAdvertisements();
      this.watchingAds = true;
    } catch {
      this._emit('rssi-unavailable', { note: '信号监听启动失败（设备可能未广播）' });
    }
  }

  _stopWatchingAds() {
    if (this.device && this.watchingAds && this.device.unwatchAdvertisements) {
      try { this.device.unwatchAdvertisements(); } catch { /* 忽略 */ }
    }
    this.watchingAds = false;
  }

  _classifyRequestError(err) {
    if (err.name === 'NotFoundError') {
      return new Error('未选择设备或未发现匹配设备，可调整过滤条件后重试');
    }
    if (err.name === 'SecurityError') {
      return new Error('扫描必须由用户交互（点击按钮）触发，且页面需用户授权');
    }
    if (err.name === 'NotSupportedError') {
      return new Error('请求参数不被支持（acceptAllDevices 需搭配 optionalServices）');
    }
    return new Error(`扫描失败（${err.name}: ${err.message}）`);
  }

  _classifyConnectError(err) {
    if (err.name === 'NetworkError') {
      return new Error('连接失败：设备可能已关机或超出范围，请靠近后重试');
    }
    if (err.name === 'NotFoundError') {
      return new Error('连接失败：设备已不可用，请重新扫描');
    }
    return new Error(`连接失败（${err.name}: ${err.message}），可重试`);
  }

  _parseUuid(input) {
    const s = String(input).trim().toLowerCase();
    if (/^0x[0-9a-f]{1,8}$/.test(s)) return parseInt(s, 16);
    if (/^[0-9a-f]{1,8}$/.test(s)) return parseInt(s, 16);
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)) return s;
    // 标准别名（如 battery_service、heart_rate）直接透传，由浏览器解析
    if (/^[a-z][a-z0-9_]*$/.test(s)) return s;
    return null;
  }

  _propertyNames(props) {
    const names = [];
    for (const key of ['broadcast', 'read', 'writeWithoutResponse', 'write', 'notify', 'indicate', 'authenticatedSignedWrites', 'reliableWrite', 'writableAuxiliaries']) {
      if (props[key]) names.push(key);
    }
    return names;
  }

  _toHex(dataView) {
    return Array.from(new Uint8Array(dataView.buffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
  }

  _fromHex(str) {
    const cleaned = String(str).trim().replace(/[\s,]+/g, '');
    if (!cleaned || cleaned.length % 2 !== 0 || /[^0-9a-fA-F]/.test(cleaned)) return null;
    const bytes = new Uint8Array(cleaned.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }
}
