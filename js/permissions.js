// 环境与权限检测：安全上下文 / 浏览器支持 / Permissions API
export const EnvState = {
  OK: 'ok',
  INSECURE_CONTEXT: 'insecure-context',
  UNSUPPORTED: 'unsupported',
};

export function detectEnvironment() {
  if (!window.isSecureContext) {
    return {
      state: EnvState.INSECURE_CONTEXT,
      message: '当前页面不在安全上下文（HTTPS 或 localhost）中，Web Bluetooth 已被浏览器禁用。',
    };
  }
  if (!('bluetooth' in navigator)) {
    return {
      state: EnvState.UNSUPPORTED,
      message: '当前浏览器不支持 Web Bluetooth。请使用 Chrome / Edge（桌面或 Android）并通过 HTTPS 访问。',
    };
  }
  return { state: EnvState.OK, message: '' };
}

export const PermState = {
  GRANTED: 'granted',
  DENIED: 'denied',
  PROMPT: 'prompt',
  UNKNOWN: 'unknown',
};

// 查询蓝牙权限状态。Permissions API 的 'bluetooth' 名称并非所有浏览器都实现，
// 不实现时优雅降级为 UNKNOWN，绝不抛出。
export async function queryBluetoothPermission(onChange) {
  if (!('permissions' in navigator) || !navigator.permissions.query) {
    return PermState.UNKNOWN;
  }
  try {
    const status = await navigator.permissions.query({ name: 'bluetooth' });
    if (onChange && typeof status.addEventListener === 'function') {
      status.addEventListener('change', () => onChange(status.state));
    }
    return status.state;
  } catch (err) {
    // Firefox / Safari 等不支持 'bluetooth' 权限名
    return PermState.UNKNOWN;
  }
}

// 将 requestDevice 抛出的错误映射为权限语义
export function classifyRequestError(err) {
  if (!err) return { kind: 'unknown', message: '未知错误' };
  switch (err.name) {
    case 'NotFoundError':
      return { kind: 'device-not-found', message: '未选择设备或未找到符合条件的设备，可重试扫描。' };
    case 'NotAllowedError':
      return { kind: 'permission-denied', message: '蓝牙权限被拒绝（或用户取消）。请在浏览器站点设置中允许蓝牙后重试。' };
    case 'SecurityError':
      return { kind: 'security', message: '安全错误：需要用户手势触发，或权限策略（Permissions-Policy）禁止了蓝牙。' };
    case 'NotSupportedError':
      return { kind: 'unsupported', message: '当前环境不支持该蓝牙操作。' };
    default:
      return { kind: 'unknown', message: err.message || String(err) };
  }
}
