import { describe, expect, it } from 'vitest';
import { stitchText, isLikelyHallucination, InterimScheduler } from './windowing.js';

describe('stitchText', () => {
  it('склеивает перекрывающиеся окна без дублирования хвоста', () => {
    const prev = 'завтра будет хорошая погода';
    const next = 'хорошая погода и солнце';
    expect(stitchText(prev, next)).toBe('завтра будет хорошая погода и солнце');
  });

  it('без пересечения — просто конкатенирует', () => {
    expect(stitchText('привет мир', 'как дела')).toBe('привет мир как дела');
  });

  it('пустой prev возвращает next как есть', () => {
    expect(stitchText('', 'новый текст')).toBe('новый текст');
  });

  it('пустой next возвращает prev как есть', () => {
    expect(stitchText('старый текст', '')).toBe('старый текст');
  });
});

describe('isLikelyHallucination', () => {
  it('отбрасывает пустой текст', () => {
    expect(isLikelyHallucination('   ')).toBe(true);
  });

  it('отбрасывает типовые галлюцинации whisper на тишине', () => {
    expect(isLikelyHallucination('Продолжение следует...')).toBe(true);
  });

  it('пропускает нормальный текст', () => {
    expect(isLikelyHallucination('Завтра на улице будет 17 градусов')).toBe(false);
  });

  it('отбрасывает точные фразы-подписи из словаря галлюцинаций (ё/регистр не важны)', () => {
    expect(isLikelyHallucination('Весёлая музыка')).toBe(true);
    expect(isLikelyHallucination('лай собак')).toBe(true);
  });

  it('не путает точную фразу-подпись с реальной речью на ту же тему', () => {
    expect(isLikelyHallucination('Мне очень нравится весёлая музыка по выходным')).toBe(false);
  });

  it('отбрасывает повтор одного символа и текст без единой буквы', () => {
    expect(isLikelyHallucination('ААААААААААААА')).toBe(true);
    expect(isLikelyHallucination('🦜 💥 😎')).toBe(true);
  });
});

describe('InterimScheduler', () => {
  it('не стреляет чаще windowMs', () => {
    const scheduler = new InterimScheduler({ windowMs: 3000 });
    expect(scheduler.shouldFire(0)).toBe(true);
    scheduler.nextWindow(0, 0);
    expect(scheduler.shouldFire(1000)).toBe(false);
    expect(scheduler.shouldFire(3000)).toBe(true);
  });

  it('следующее окно перекрывается с предыдущим на overlapMs', () => {
    const scheduler = new InterimScheduler({ windowMs: 3000, overlapMs: 500 });
    scheduler.nextWindow(3000, 0);
    const range = scheduler.nextWindow(6000, 0);
    expect(range.startMs).toBe(2500);
    expect(range.endMs).toBe(6000);
  });
});
