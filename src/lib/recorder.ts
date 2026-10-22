// Запись ответов в браузере. Chrome пишет webm/opus, Safari — mp4/aac; расшифровка понимает оба.

export interface MicInfo {
  label: string;
  settings: MediaTrackSettings;
}

let stream: MediaStream | null = null;

export async function getMic(): Promise<MediaStream> {
  if (stream && stream.getAudioTracks().some((t) => t.readyState === 'live')) return stream;
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  return stream;
}

export function micInfo(s: MediaStream): MicInfo {
  const track = s.getAudioTracks()[0];
  return { label: track?.label ?? '', settings: track?.getSettings() ?? {} };
}

export function pickMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? '';
}

export function extFor(mime: string): string {
  return mime.startsWith('audio/mp4') ? 'mp4' : 'webm';
}

export class Recording {
  private recorder: MediaRecorder;
  private chunks: Blob[] = [];
  readonly mime: string;
  startedAt = 0;

  constructor(s: MediaStream) {
    this.mime = pickMime();
    // 64 кбит/с с запасом хватает речи и Whisper, а архив для версии на Pages не разрастается.
    this.recorder = new MediaRecorder(s, { ...(this.mime ? { mimeType: this.mime } : {}), audioBitsPerSecond: 64_000 });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
  }

  start(): void {
    this.startedAt = Date.now();
    this.recorder.start(1000);
  }

  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      this.recorder.onstop = () => resolve(new Blob(this.chunks, { type: this.recorder.mimeType || this.mime }));
      if (this.recorder.state === 'inactive') this.recorder.onstop(new Event('stop'));
      else this.recorder.stop();
    });
  }
}

// Уровень сигнала 0–1 для индикатора: видно, что микрофон слышит, и не нужно гадать, идёт ли запись.
export function levelMeter(s: MediaStream, onLevel: (v: number) => void): () => void {
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(s);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  let raf = 0;
  const tick = () => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
    raf = requestAnimationFrame(tick);
  };
  tick();
  return () => {
    cancelAnimationFrame(raf);
    source.disconnect();
    void ctx.close();
  };
}

// Короткий сигнал перед записью — как на экзамене, где старт ответа слышен, а не только виден.
export function beep(freq = 880, ms = 160): Promise<void> {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  gain.gain.value = 0.08;
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  return new Promise((resolve) =>
    setTimeout(() => {
      osc.stop();
      void ctx.close();
      resolve();
    }, ms),
  );
}
