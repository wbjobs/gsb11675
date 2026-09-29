// Canvas 信号强度可视化：滚动折线图
export class SignalChart {
  constructor(canvas, maxPoints = 120) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.maxPoints = maxPoints;
    this.samples = []; // { rssi, t }
  }

  push(rssi) {
    if (typeof rssi !== 'number' || Number.isNaN(rssi)) return;
    this.samples.push({ rssi, t: Date.now() });
    if (this.samples.length > this.maxPoints) this.samples.shift();
    this.draw();
  }

  clear() {
    this.samples = [];
    this.draw();
  }

  draw() {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // RSSI 典型范围 -100 ~ -30 dBm
    const min = -100;
    const max = -30;
    const toY = (rssi) => h - ((Math.max(min, Math.min(max, rssi)) - min) / (max - min)) * (h - 16) - 8;

    // 网格与刻度
    ctx.strokeStyle = '#2b3a55';
    ctx.fillStyle = '#8fa0bd';
    ctx.font = '10px sans-serif';
    ctx.lineWidth = 1;
    for (const level of [-90, -70, -50, -30]) {
      const y = toY(level);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillText(`${level}`, 4, y - 2);
    }

    if (this.samples.length < 2) return;

    // 折线
    ctx.strokeStyle = '#4f8cff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    this.samples.forEach((s, i) => {
      const x = (i / (this.maxPoints - 1)) * w;
      const y = toY(s.rssi);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 最新点
    const last = this.samples[this.samples.length - 1];
    const lx = ((this.samples.length - 1) / (this.maxPoints - 1)) * w;
    ctx.fillStyle = '#3ecf8e';
    ctx.beginPath();
    ctx.arc(lx, toY(last.rssi), 4, 0, Math.PI * 2);
    ctx.fill();
  }
}
