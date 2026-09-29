# Web Bluetooth 控制台

无框架、纯原生 Web API 的低功耗蓝牙（BLE）调试控制台。

## 运行

Web Bluetooth 要求安全上下文（HTTPS 或 `localhost`）：

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

浏览器要求：Chrome / Edge（桌面或 Android）。Firefox、Safari 不支持 Web Bluetooth，页面会自动降级到手动输入模式。

## 功能

- 扫描并连接 BLE 设备（支持名称前缀过滤）
- 展示设备名称、ID、GATT 状态、RSSI 信号强度（Canvas 实时曲线）
- 服务 / 特征树展示，一键选用特征
- 读 / 写特征值（hex），订阅 / 取消订阅通知
- 权限状态、连接状态、断开原因实时展示
- 连接指数退避重试、读写失败自动重试、断线一键重连
- 设备记录与操作日志持久化到 IndexedDB，日志可导出

## 异常处理

| 场景 | 行为 |
| --- | --- |
| 非安全上下文 | 禁用扫描，提示并降级到手动输入 |
| 浏览器不支持 | 禁用扫描，提示并降级到手动输入 |
| 权限被拒 / 用户取消 | 提示引导开启权限，降级到手动输入 |
| 设备未找到 | 横幅提示，可一键重试扫描 |
| 连接失败 | 自动重试 3 次（指数退避），失败后可手动重试 |
| 服务 / 特征不匹配 | 明确提示 UUID 不存在 |
| 读写失败 | 自动重试 1 次，结果显示在操作区 |
| 断线 | 展示断开原因，横幅提供重连按钮 |

## 降级与演示

- **手动输入模式**：手动录入设备名称与信号强度，保存到本地。
- **模拟设备**：内置一台模拟 BLE 设备（电池服务 + 设备信息服务），可在无真实设备、无蓝牙权限时体验完整扫描→连接→读→订阅→断线→重连流程。

## 文件结构

```
index.html          页面结构
css/styles.css      样式
js/main.js          UI  wiring 与交互
js/bluetooth-manager.js  蓝牙核心：扫描/连接/重试/读写/订阅/RSSI
js/permissions.js   环境与权限检测（Permissions API）
js/signal-chart.js  Canvas RSSI 曲线
js/storage.js       IndexedDB 持久化
js/simulator.js     模拟 BLE 设备
```
