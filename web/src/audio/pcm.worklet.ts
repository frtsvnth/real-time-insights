// AudioWorklet-процессор: копит Float32-сэмплы и отдаёт их пачками как PCM16 LE.
// Типы AudioWorklet не входят в стандартный DOM lib, поэтому объявляем минимум сами.
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

// ~150мс при 16kHz — попадает в требуемый диапазон 100-200мс на чанк.
const CHUNK_SAMPLES = 2400;

class PcmProcessor extends AudioWorkletProcessor {
  private samples: number[] = [];

  process(inputs: Float32Array[][]): boolean {
    const channelData = inputs[0]?.[0];
    if (channelData) {
      for (let i = 0; i < channelData.length; i++) {
        this.samples.push(channelData[i]);
      }
      while (this.samples.length >= CHUNK_SAMPLES) {
        const chunk = this.samples.splice(0, CHUNK_SAMPLES);
        const pcm16 = new Int16Array(chunk.length);
        for (let i = 0; i < chunk.length; i++) {
          const clamped = Math.max(-1, Math.min(1, chunk[i]));
          pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
        }
        this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
      }
    }
    return true;
  }
}

registerProcessor('pcm-processor', PcmProcessor);
