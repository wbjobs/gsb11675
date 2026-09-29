// 环境能力检测：安全上下文、Web Bluetooth 支持、权限状态
export function detectEnvironment() {
  const secure = window.isSecureContext === true;
  const supported = secure && 'bluetooth' in navigator;
  return { secure, supported };
}

// Permissions API 的 'bluetooth' 并非所有浏览器都实现，需容错
export async function queryBluetoothPermission(onChange) {
  if (!('permissions' in navigator) || !navigator.permissions?.query) {
    return { state: 'unknown', note: 'Permissions API 不可用' };
  }
  try {
    const status = await navigator.permissions.query({ name: 'bluetooth' });
    if (onChange) {
      status.onchange = () => onChange(status.state);
    }
    return { state: status.state, note: '' };
  } catch (err) {
    // Chrome 部分版本不支持 'bluetooth' 权限名，会抛 TypeError
    return { state: 'unknown', note: `无法查询（${err.name}）` };
  }
}

export function permissionLabel(state, note = '') {
  switch (state) {
    case 'granted': return { text: '已授权', cls: 'ok' };
    case 'denied': return { text: '已拒绝', cls: 'err' };
    case 'prompt': return { text: '待询问（首次连接时弹出）', cls: 'warn' };
    default: return { text: `未知${note ? '：' + note : ''}`, cls: 'warn' };
  }
}
