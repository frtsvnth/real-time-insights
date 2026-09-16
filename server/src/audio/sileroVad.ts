import { NonRealTimeVAD } from '@ricky0123/vad-node';

const SAMPLE_RATE = 16000;

let vadPromise: Promise<NonRealTimeVAD> | null = null;

function getVad(): Promise<NonRealTimeVAD> {
  if (!vadPromise) vadPromise = NonRealTimeVAD.new();
  return vadPromise;
}

function pcm16ToFloat32(pcm: Buffer): Float32Array {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] / 32768;
  return out;
}

/**
 * Гейт перед Whisper: реальная нейросетевая VAD (Silero) вместо RMS-энергии.
 * Отсекает тишину и не-речевой шум (в т.ч. громкий), на которых Whisper склонен
 * галлюцинировать — RMS-детектор такое пропускал, т.к. смотрит только на громкость.
 * Возвращает true, если в буфере есть хотя бы один сегмент речи.
 */
export async function hasSpeech(pcm: Buffer): Promise<boolean> {
  if (pcm.length < 2) return false;
  const vad = await getVad();
  for await (const _segment of vad.run(pcm16ToFloat32(pcm), SAMPLE_RATE)) {
    return true;
  }
  return false;
}
