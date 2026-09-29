// Canvas 信号强度（RSSI）实时曲线
export class SignalChart {
  constructor(canvas, { maxPoints = 120, minDbm = -100, maxDbm = -30 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.maxPoints = maxPoints;
    this.minDbm = minDbm;
    this.maxDbm = maxDbm;
    this.points = [];
  }

  push(rssi) {
    if (typeof rssi !== 'number' || Number.isNaN(rssi)) return;
    this.points.push(rssi);
    if (this.points.length > this.maxPoints) this.points.shift();
    this.draw();
  }

  clear() {
    this.points = [];
    this.draw();
  }

  draw() {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // 网格与刻度
    ctx.strokeStyle = '#2c3a55';
    ctx.fillStyle = '#8fa1bd';
    ctx.font = '10px monospace';
    ctx.lineWidth = 1;
    for (let dbm = this.minDbm; dbm <= this.maxDbm; dbm += 10) {
      const y = this._toY(dbm, h);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillText(String(dbm), 4, y - 2);
    }

    if (this.points.length < 2) return;

    ctx.strokeStyle = '#4da3ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    this.points.forEach((rssi, i) => {
      const x = (i / (this.maxPoints - 1)) * w;
      const y = this._toY(rssi, h);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    const last = this.points[this.points.length - 1];
    ctx.fillStyle = '#e6ecf5';
    ctx.fillText(`${last} dBm`, w - 64, this._toY(last, h) - 6);
  }

  _toY(dbm, h) {
    const clamped = Math.min(this.maxDbm, Math.max(this.minDbm, dbm));
    const ratio = (clamped - this.minDbm) / (this.maxDbm - this.minDbm);
    return h - ratio * (h - 14) - 4;
  }
}
