// 模拟 BLE 设备：在 Web Bluetooth 不可用 / 权限被拒时演示完整流程
export function createSimulatedDevice() {
  let battery = 87;
  let connected = false;
  const listeners = new Map();

  const fire = (type, event) => {
    (listeners.get(type) || []).forEach((fn) => fn(event));
  };

  const makeCharacteristic = (uuid, props, readFn) => ({
    uuid,
    properties: {
      read: props.includes('read'),
      write: props.includes('write'),
      writeWithoutResponse: false,
      notify: props.includes('notify'),
      indicate: false,
    },
    _notifyHandler: null,
    async readValue() {
      return new DataView(readFn());
    },
    async writeValue(bytes) {
      fire('sim-write', { uuid, bytes: Array.from(bytes) });
    },
    async startNotifications() {
      if (uuid === '0x2a19') {
        this._timer = setInterval(() => {
          battery = Math.max(5, battery - 1);
          if (this._notifyHandler) {
            this._notifyHandler({ target: { value: new DataView(new Uint8Array([battery]).buffer) } });
          }
        }, 2000);
      }
    },
    async stopNotifications() {
      clearInterval(this._timer);
    },
    addEventListener(type, fn) { if (type === 'characteristicvaluechanged') this._notifyHandler = fn; },
    removeEventListener() { this._notifyHandler = null; },
  });

  const services = [
    {
      uuid: '0x180f',
      getCharacteristics: async () => [
        makeCharacteristic('0x2a19', ['read', 'notify'], () => new Uint8Array([battery]).buffer),
      ],
    },
    {
      uuid: '0x180a',
      getCharacteristics: async () => [
        makeCharacteristic('0x2a29', ['read'], () => new TextEncoder().encode('SimuTech').buffer),
        makeCharacteristic('0x2a24', ['read'], () => new TextEncoder().encode('ST-1000').buffer),
      ],
    },
  ];

  const device = {
    name: '模拟设备 ST-1000',
    id: 'sim-st-1000',
    gatt: {
      get connected() { return connected; },
      async connect() {
        await new Promise((r) => setTimeout(r, 400));
        connected = true;
        return {
          getPrimaryServices: async () => services,
          getPrimaryService: async (uuid) => {
            const norm = String(uuid).toLowerCase();
            const found = services.find((s) => s.uuid === norm || s.uuid === `0x${norm}`);
            if (!found) throw new DOMException('Service not found', 'NotFoundError');
            return {
              uuid: found.uuid,
              getCharacteristics: found.getCharacteristics,
              getCharacteristic: async (cu) => {
                const chars = await found.getCharacteristics();
                const c = chars.find((x) => x.uuid === String(cu).toLowerCase());
                if (!c) throw new DOMException('Characteristic not found', 'NotFoundError');
                return c;
              },
            };
          },
        };
      },
      disconnect() {
        connected = false;
        fire('gattserverdisconnected', {});
      },
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) || [];
      listeners.set(type, list.filter((f) => f !== fn));
    },
    // 模拟设备直接推送 RSSI
    startRssi(onRssi) {
      const timer = setInterval(() => {
        if (!connected) return;
        onRssi(-55 - Math.round(Math.random() * 25));
      }, 1000);
      return () => clearInterval(timer);
    },
  };

  return device;
}
