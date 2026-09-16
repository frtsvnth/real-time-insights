export interface MicCapture {
  stop(): void;
  pause(): void;
  resume(): void;
}

function computeRms(buffer: ArrayBuffer): number {
  const view = new Int16Array(buffer);
  if (view.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < view.length; i++) {
    const s = view[i] / 32768;
    sumSquares += s * s;
  }
  return Math.sqrt(sumSquares / view.length);
}

/**
 * Захватывает микрофон и отдаёт PCM16 mono 16kHz чанками по ~150мс.
 * AudioContext создаётся сразу с sampleRate 16000 — так браузер сам ресемплирует
 * с аппаратной частоты микрофона, и не нужен ручной ресемплинг в ворклете.
 */
export async function startMicCapture(
  onPcmChunk: (chunk: ArrayBuffer) => void,
  onLevel: (rms: number) => void,
): Promise<MicCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });

  const audioContext = new AudioContext({ sampleRate: 16000 });
  const workletUrl = new URL('./pcm.worklet.ts', import.meta.url);
  await audioContext.audioWorklet.addModule(workletUrl);

  const source = audioContext.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(audioContext, 'pcm-processor');

  worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
    onPcmChunk(event.data);
    onLevel(computeRms(event.data));
  };

  source.connect(worklet);
  // Не подключаем worklet к destination — не нужно проигрывать свой же голос обратно.

  return {
    stop() {
      worklet.port.onmessage = null;
      source.disconnect();
      worklet.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void audioContext.close();
    },
    // Пауза не рвёт сессию и не трогает разрешение на микрофон — просто останавливает
    // граф обработки, чтобы ворклет не слал чанки, пока пользователь на паузе.
    pause() {
      void audioContext.suspend();
    },
    resume() {
      void audioContext.resume();
    },
  };
}
