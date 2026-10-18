// 왁스 부서지는 소리를 Web Audio 로 합성한다 (음원 파일 없이 ₩0).
// 짧은 노이즈 알갱이(grain) 수십 개를 밴드패스로 걸러 겹치면 '와삭' 하는 질감이 난다.
// 나중에 실제 녹음 샘플로 바꿀 때는 grain() 대신 샘플 재생으로 교체하면 된다.

export type CrunchProfile = "soft" | "crispy" | "hard";

const PROFILES: Record<CrunchProfile, { lo: number; hi: number; q: number; grains: number; thump: number; click: number }> = {
  soft: { lo: 700, hi: 3200, q: 1.0, grains: 0.75, thump: 1.3, click: 0.3 },
  crispy: { lo: 1600, hi: 6500, q: 1.8, grains: 1.0, thump: 0.8, click: 0.7 },
  hard: { lo: 2400, hi: 9000, q: 3.0, grains: 1.15, thump: 0.6, click: 1.0 },
};

export interface Bus {
  input: GainNode;
  /** 영상 녹화용 오디오 트랙 */
  stream: MediaStreamAudioDestinationNode | null;
}

class Sfx {
  readonly ctx = new AudioContext();
  private master: GainNode;
  private noise: AudioBuffer;

  constructor() {
    const { ctx } = this;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    comp.attack.value = 0.002;
    comp.release.value = 0.12;
    this.master.connect(comp).connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // iOS 는 pointerdown 만으로는 소리를 못 켜서, 손을 뗄 때(touchend·pointerup) 한 번 더 깨운다
    const unlock = () => {
      if (ctx.state === "running") return done();
      ctx.resume().then(() => ctx.state === "running" && done(), () => {});
    };
    const done = () => {
      for (const ev of ["touchend", "pointerup"]) window.removeEventListener(ev, unlock, true);
    };
    for (const ev of ["touchend", "pointerup"]) window.addEventListener(ev, unlock, { capture: true, passive: true });
  }

  /** iOS 는 전화·다른 앱 소리로 "interrupted" 가 되기도 해서 running 이 아니면 늘 깨운다 */
  resume() {
    if (this.ctx.state !== "running") this.ctx.resume().catch(() => {});
  }

  createBus(): Bus {
    const input = this.ctx.createGain();
    input.connect(this.master);
    let stream: MediaStreamAudioDestinationNode | null = null;
    try {
      stream = this.ctx.createMediaStreamDestination();
      input.connect(stream);
    } catch {
      /* 녹화 오디오 미지원 브라우저 */
    }
    return { input, stream };
  }

  /** 금 갈 때: intensity 0~1, rate<1 이면 슬로모(낮고 길게) */
  crunch(bus: Bus, intensity: number, profile: CrunchProfile, rate = 1) {
    const p = PROFILES[profile];
    const t0 = this.ctx.currentTime + 0.005;
    const dur = (0.05 + 0.2 * intensity) / rate;
    const n = Math.round((5 + 26 * intensity) * p.grains);
    for (let i = 0; i < n; i++) {
      const t = t0 + dur * Math.pow(Math.random(), 1.7);
      const freq = (p.lo + Math.random() * (p.hi - p.lo)) * rate;
      const gain = (0.12 + Math.random() * 0.35) * (0.5 + 0.5 * intensity);
      this.grain(bus.input, t, freq, p.q, gain, (0.004 + Math.random() * 0.016) / rate, rate);
    }
    this.thump(bus.input, t0, 0.35 * p.thump * intensity, rate);
    const clicks = Math.round(1 + 3 * p.click * intensity);
    for (let i = 0; i < clicks; i++) this.click(bus.input, t0 + Math.random() * dur * 0.5, 0.25 * p.click, rate);
  }

  /** 완전히 부서질 때 */
  shatter(bus: Bus, profile: CrunchProfile, rate = 1) {
    const p = PROFILES[profile];
    this.crunch(bus, 1, profile, rate);
    const t0 = this.ctx.currentTime + 0.04 / rate;
    const tail = 0.45 / rate;
    const n = Math.round(60 * p.grains);
    for (let i = 0; i < n; i++) {
      const u = Math.pow(Math.random(), 2.2);
      const freq = (p.lo + Math.random() * (p.hi - p.lo)) * rate;
      this.grain(bus.input, t0 + tail * u, freq, p.q, (0.08 + Math.random() * 0.22) * (1 - u * 0.7), (0.003 + Math.random() * 0.012) / rate, rate);
    }
    this.thump(bus.input, this.ctx.currentTime + 0.005, 0.7 * p.thump, rate * 0.8);
  }

  /** 조각이 바닥에 떨어질 때 */
  tick(bus: Bus, strength: number, profile: CrunchProfile, rate = 1) {
    const p = PROFILES[profile];
    const t = this.ctx.currentTime + 0.002;
    for (let i = 0; i < 2; i++) {
      this.grain(bus.input, t + i * 0.006 / rate, (p.hi * 0.7 + Math.random() * p.hi * 0.3) * rate, p.q, 0.12 * strength, 0.006 / rate, rate);
    }
  }

  /** 슬라임 찌르기·늘이기 (rate 가 높을수록 높고 짧게) */
  squelch(bus: Bus, rate = 1, gain = 0.55) {
    const { ctx } = this;
    const t = ctx.currentTime + 0.005;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 5;
    f.frequency.setValueAtTime(260 * rate, t);
    f.frequency.exponentialRampToValueAtTime(900 * rate, t + 0.12 / rate);
    f.frequency.exponentialRampToValueAtTime(420 * rate, t + 0.22 / rate);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24 / rate);
    src.connect(f).connect(g).connect(bus.input);
    src.start(t, Math.random(), 0.3 / rate);

    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.15 / rate);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.16 / rate);
    osc.connect(og).connect(bus.input);
    osc.start(t);
    osc.stop(t + 0.2 / rate);
  }

  /** 다시 굳힐 때 '뽁' */
  pop(bus: Bus) {
    const { ctx } = this;
    const t = ctx.currentTime + 0.005;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(280, t);
    osc.frequency.exponentialRampToValueAtTime(680, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(g).connect(bus.input);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  /** 희귀 등장: 올라가는 차임 아르페지오 + 반짝이는 쉬머 + 랜덤 고음 '띠링' */
  rareChime(bus: Bus, rate = 1) {
    const { ctx } = this;
    const t0 = ctx.currentTime + 0.15 / rate;
    const notes = [1046.5, 1318.5, 1568, 2093, 2637, 3136]; // 도미솔도미솔
    notes.forEach((f, i) => {
      const t = t0 + (i * 0.075) / rate;
      for (const [type, mult, gain] of [
        ["triangle", 1, 0.11],
        ["sine", 0.5, 0.07],
      ] as const) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f * mult * rate;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9 / rate);
        o.connect(g).connect(bus.input);
        o.start(t);
        o.stop(t + 1 / rate);
      }
    });

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = Math.min(7000 * rate, ctx.sampleRate / 2 - 100);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t0);
    sg.gain.exponentialRampToValueAtTime(0.06, t0 + 0.3 / rate);
    sg.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6 / rate);
    src.connect(hp).connect(sg).connect(bus.input);
    src.start(t0);
    src.stop(t0 + 1.7 / rate);

    for (let i = 0; i < 12; i++) {
      const t = t0 + (0.3 + Math.random() * 1.2) / rate;
      const o = ctx.createOscillator();
      o.frequency.value = (2500 + Math.random() * 2500) * rate;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.04, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12 / rate);
      o.connect(g).connect(bus.input);
      o.start(t);
      o.stop(t + 0.15 / rate);
    }
  }

  /**
   * 다이아몬드 등장: 0.8초 동안 빛을 모으는 '쉬이익' → '쿵' + 크리스털 종소리 화음 → 반짝반짝.
   * (화면 연출의 시간 정지 DIAMOND_CHARGE 와 같은 0.8초)
   */
  diamondChime(bus: Bus, rate = 1) {
    const { ctx } = this;
    const t0 = ctx.currentTime + 0.01;
    const hit = t0 + 0.8 / rate;

    // 1) 차징: 점점 올라가는 바람 소리 + 낮은 사인
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 4;
    bp.frequency.setValueAtTime(300 * rate, t0);
    bp.frequency.exponentialRampToValueAtTime(4500 * rate, hit);
    const wg = ctx.createGain();
    wg.gain.setValueAtTime(0.0001, t0);
    wg.gain.exponentialRampToValueAtTime(0.16, hit - 0.03);
    wg.gain.exponentialRampToValueAtTime(0.0001, hit + 0.05);
    wind.connect(bp).connect(wg).connect(bus.input);
    wind.start(t0);
    wind.stop(hit + 0.1);
    const rise = ctx.createOscillator();
    rise.frequency.setValueAtTime(180 * rate, t0);
    rise.frequency.exponentialRampToValueAtTime(900 * rate, hit);
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.0001, t0);
    rg.gain.exponentialRampToValueAtTime(0.06, hit - 0.03);
    rg.gain.exponentialRampToValueAtTime(0.0001, hit + 0.04);
    rise.connect(rg).connect(bus.input);
    rise.start(t0);
    rise.stop(hit + 0.1);

    // 2) 쿵
    const boom = ctx.createOscillator();
    boom.frequency.setValueAtTime(110 * rate, hit);
    boom.frequency.exponentialRampToValueAtTime(38 * rate, hit + 0.6 / rate);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, hit);
    bg.gain.exponentialRampToValueAtTime(0.55, hit + 0.01);
    bg.gain.exponentialRampToValueAtTime(0.0001, hit + 0.9 / rate);
    boom.connect(bg).connect(bus.input);
    boom.start(hit);
    boom.stop(hit + 1 / rate);
    this.thump(bus.input, hit, 0.5, rate * 0.7);

    // 3) 크리스털 종소리: 화음 4음, 각 음에 종 특유의 배음(1, 2.76, 5.4배)
    const notes = [1318.5, 1661.2, 1975.5, 2637]; // 미·솔#·시·미
    const partials: [number, number][] = [
      [1, 0.09],
      [2.76, 0.035],
      [5.4, 0.015],
    ];
    notes.forEach((f, i) => {
      const t = hit + (i * 0.04) / rate;
      for (const [mult, gain] of partials) {
        const o = ctx.createOscillator();
        o.frequency.value = Math.min(f * mult * rate, ctx.sampleRate / 2 - 100);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6 / rate / Math.sqrt(mult));
        o.connect(g).connect(bus.input);
        o.start(t);
        o.stop(t + 2.7 / rate);
      }
    });

    // 4) 반짝반짝
    for (let i = 0; i < 20; i++) {
      const t = hit + (0.2 + Math.random() * 2.2) / rate;
      const o = ctx.createOscillator();
      o.frequency.value = (3000 + Math.random() * 3000) * rate;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.035, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15 / rate);
      o.connect(g).connect(bus.input);
      o.start(t);
      o.stop(t + 0.18 / rate);
    }
  }

  private grain(dest: AudioNode, t: number, freq: number, q: number, gain: number, dur: number, rate: number) {
    const { ctx } = this;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = Math.min(freq, ctx.sampleRate / 2 - 100);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.0008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5, dur + 0.02);
  }

  private thump(dest: AudioNode, t: number, gain: number, rate: number) {
    const { ctx } = this;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 380 * rate;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09 / rate);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random(), 0.12 / rate);
  }

  private click(dest: AudioNode, t: number, gain: number, rate: number) {
    const { ctx } = this;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 5000 * rate;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.0005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.006 / rate);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random(), 0.02 / rate);
  }
}

let instance: Sfx | null = null;
/** 첫 터치(사용자 제스처) 안에서 호출해야 소리가 난다 */
export function sfx(): Sfx {
  instance ??= new Sfx();
  instance.resume();
  return instance;
}

/** 안드로이드 진동 (iOS 사파리는 미지원이라 조용히 무시) */
export function buzz(pattern: number | number[]) {
  if ("vibrate" in navigator) navigator.vibrate(pattern);
}
