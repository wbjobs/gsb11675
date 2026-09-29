# Web Bluetooth 控制台

纯原生（无框架）的 Web Bluetooth 低功耗蓝牙调试页面：扫描连接、服务/特征浏览、读写、订阅通知、信号可视化、权限与断线处理。

## 运行

Web Bluetooth 要求安全上下文（HTTPS 或 `localhost`），直接用 `file://` 打开会被浏览器禁用。

```bash
cd 本目录
python3 -m http.server 8000
# 打开 http://localhost:8000
```

浏览器要求：Chrome / Edge（桌面或 Android）。Safari、Firefox 不支持 Web Bluetooth，页面会自动降级到手动模式。

## 功能对照验

- **扫描连接**：点击「扫描并连接」（必须由用户点击触发），支持设备名前缀 / 服务 UUID 过滤或接受所有设备。
- **服务与特征**：连接后自动列出全部主服务、特征 UUID 及属性（read/write/notify…），点「使用」填入操作区。
- **读写订阅**：读取展示 hex 值；写入接受 hex 输入（如 `01 0A FF`）；订阅后通知实时刷新。
- **权限状态**：通过 Permissions API 展示 granted/prompt/denied，权限变化实时更新；不支持的浏览器显示「未知」。
- **降级**：非安全上下文 / 浏览器不支持 / 权限被拒，分别给出对应提示并切换到手动模式（配置存 IndexedDB）。
- **异常处理**：设备未找到、连接失败、服务不匹配、读写失败均有明确提示且可直接重试。
- **断线重连**：非用户主动断开时按指数退避自动重连（最多 3 次），并记录断开原因。
- **信号可视化**：通过 `watchAdvertisements` 获取 RSSI，Canvas 绘制滚动折线图；不支持时给出提示。

## 文件结构

```
index.html        页面结构
styles.css        样式
js/env.js         安全上下文 / 支持度 / 权限检测
js/bluetooth.js   BLE 管理器（扫描、连接、重连、读写、订阅、错误分类）
js/signal.js      Canvas RSSI 折线图
js/storage.js     IndexedDB（手动配置 + 连接历史）
js/main.js        UI 装配与事件绑定
```
