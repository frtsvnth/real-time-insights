// AudioWorklet-процессор: копит Float32-сэмплы и отдаёт их пачками как PCM16 LE.
// Обычный JS, не TS: браузер грузит этот файл напрямую как модуль (AudioWorklet.addModule),
// а не через сборку основного бандла, так что TS-типы тут только мешали бы MIME/расширению.

// ~150мс при 16kHz — попадает в требуемый диапазон 100-200мс на чанк.
const CHUNK_SAMPLES = 2400;

class PcmProcessor extends AudioWorkletProcessor {
  samples = [];

  process(inputs) {
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
