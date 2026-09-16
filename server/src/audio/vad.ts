// Простой VAD по энергии (RMS) сигнала, без внешних зависимостей.
// Идея: считаем RMS каждого входящего чанка PCM16; если он выше порога — это речь.
// Если тишина держится дольше silenceMs — считаем это границей конца реплики (utterance).

export interface VadEvent {
  isSpeech: boolean;
  /** true один раз в момент перехода тишина -> речь */
  speechStarted: boolean;
  /** true один раз в момент, когда тишина длилась достаточно долго, чтобы закрыть реплику */
  utteranceBoundary: boolean;
}

export interface VadOptions {
  /** порог RMS (0..1 от полной шкалы int16), подобран эмпирически под обычный микрофон */
  energyThreshold?: number;
  /** тишина дольше этого — граница реплики */
  silenceMs?: number;
}

export class RmsVad {
  private readonly energyThreshold: number;
  private readonly silenceMs: number;
  private speaking = false;
  private lastSpeechAt: number | null = null;
  private boundaryEmitted = true; // на старте "границы" уже как бы закрыты

  constructor(options: VadOptions = {}) {
    this.energyThreshold = options.energyThreshold ?? 0.02;
    this.silenceMs = options.silenceMs ?? 700;
  }

  private rms(pcm: Buffer): number {
    if (pcm.length < 2) return 0;
    const sampleCount = Math.floor(pcm.length / 2);
    let sumSquares = 0;
    for (let i = 0; i < sampleCount; i++) {
      const sample = pcm.readInt16LE(i * 2) / 32768;
      sumSquares += sample * sample;
    }
    return Math.sqrt(sumSquares / sampleCount);
  }

  feed(pcm: Buffer, timestampMs: number): VadEvent {
    const energy = this.rms(pcm);
    const isSpeech = energy >= this.energyThreshold;
    let speechStarted = false;
    let utteranceBoundary = false;

    if (isSpeech) {
      if (!this.speaking) {
        speechStarted = true;
        this.speaking = true;
      }
      this.lastSpeechAt = timestampMs;
      this.boundaryEmitted = false;
    } else if (this.speaking && !this.boundaryEmitted && this.lastSpeechAt !== null) {
      const silenceDuration = timestampMs - this.lastSpeechAt;
      if (silenceDuration >= this.silenceMs) {
        utteranceBoundary = true;
        this.boundaryEmitted = true;
        this.speaking = false;
      }
    }

    return { isSpeech, speechStarted, utteranceBoundary };
  }

  reset(): void {
    this.speaking = false;
    this.lastSpeechAt = null;
    this.boundaryEmitted = true;
  }
}
