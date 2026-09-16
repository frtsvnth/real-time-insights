// Утилиты для скользящих окон interim-распознавания и склейки текста между ними.
// Whisper не умеет streaming: мы шлём перекрывающиеся окна аудио и склеиваем текстовые
// результаты по совпадающему хвосту/началу, чтобы не дублировать слова на стыках.

export interface InterimWindowRange {
  startMs: number;
  endMs: number;
}

export interface InterimSchedulerOptions {
  /** как часто дёргать Whisper во время активной речи, мс */
  windowMs?: number;
  /** перекрытие с предыдущим окном, чтобы не потерять слово на границе, мс */
  overlapMs?: number;
}

export class InterimScheduler {
  private readonly windowMs: number;
  private readonly overlapMs: number;
  private lastFireAtMs: number | null = null;
  private lastWindowEndMs: number | null = null;

  constructor(options: InterimSchedulerOptions = {}) {
    this.windowMs = options.windowMs ?? 3500;
    this.overlapMs = options.overlapMs ?? 650;
  }

  shouldFire(nowMs: number): boolean {
    if (this.lastFireAtMs === null) return true;
    return nowMs - this.lastFireAtMs >= this.windowMs;
  }

  /** Возвращает диапазон аудио (относительно начала utterance), который нужно отправить в Whisper. */
  nextWindow(nowMs: number, utteranceStartMs: number): InterimWindowRange {
    const startMs =
      this.lastWindowEndMs === null
        ? utteranceStartMs
        : Math.max(utteranceStartMs, this.lastWindowEndMs - this.overlapMs);
    const range = { startMs, endMs: nowMs };
    this.lastFireAtMs = nowMs;
    this.lastWindowEndMs = nowMs;
    return range;
  }

  reset(): void {
    this.lastFireAtMs = null;
    this.lastWindowEndMs = null;
  }
}

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * Склеивает текст двух перекрывающихся окон: ищет самый длинный хвост `prev`,
 * совпадающий с началом `next` (по нормализованным словам), и не дублирует его.
 * Если совпадения нет — просто конкатенирует (лучше лишнее слово, чем потеря текста).
 */
export function stitchText(prev: string, next: string): string {
  const prevWords = prev.trim().split(/\s+/).filter(Boolean);
  const nextWords = next.trim().split(/\s+/).filter(Boolean);

  if (prevWords.length === 0) return nextWords.join(' ');
  if (nextWords.length === 0) return prevWords.join(' ');

  const maxOverlap = Math.min(prevWords.length, nextWords.length, 15);
  for (let len = maxOverlap; len > 0; len--) {
    const prevTail = prevWords
      .slice(-len)
      .map(normalizeWord)
      .join(' ');
    const nextHead = nextWords
      .slice(0, len)
      .map(normalizeWord)
      .join(' ');
    if (prevTail.length > 0 && prevTail === nextHead) {
      return [...prevWords, ...nextWords.slice(len)].join(' ');
    }
  }

  return [...prevWords, ...nextWords].join(' ');
}

/**
 * Эвристика галлюцинаций Whisper на тишине/шуме — вторая линия защиты после Silero VAD
 * (та отсеивает не-речь до Whisper, эта ловит то, что всё равно проскочило и было
 * распознано как типовая "подпись" вместо реальной речи).
 * Список коротких фраз-галлюцинаций — из https://gist.github.com/waveletdeboshir/8bf52f04bf78018194f25b2390c08309
 * (собран на 13ч шумовых записей на whisper-large-v2, ru). Сверяем точным совпадением
 * всей реплики, а не подстрокой — иначе "мне нравится музыка" тоже попала бы под фильтр.
 */
const EXACT_HALLUCINATION_PHRASES = new Set([
  'веселая музыка',
  'спокойная музыка',
  'грустная мелодия',
  'лирическая музыка',
  'динамичная музыка',
  'таинственная музыка',
  'торжественная музыка',
  'интригующая музыка',
  'напряженная музыка',
  'печальная музыка',
  'тревожная музыка',
  'музыкальная заставка',
  'перестрелка',
  'гудок поезда',
  'рев мотора',
  'шум двигателя',
  'сигнал автомобиля',
  'лай собак',
  'лай собаки',
  'пес лает',
  'кашель',
  'выстрелы',
  'шум дождя',
  'песня',
  'по громкоговорителю',
  'взрыв',
  'шум мотора',
  'плеск воды',
  'гудок автомобиля',
  'по тв',
  'аплодисменты',
  'городской шум',
  'полиция',
  'городской гудок',
  'сигнал машины',
  'смех',
  'стук в дверь',
  'полицейская сирена',
  'звонок в дверь',
]);

// Фразы-шаблоны (титры/подписки) — реальная речь почти никогда не начинается именно так.
const HALLUCINATION_PREFIX_PATTERNS = [
  /^субтитр/i,
  /^редактор субтитров/i,
  /спасибо за субтитры/i,
  /продолжение следует/i,
  /смотрите продолжение/i,
  /подпишись/i,
  /^спасибо за просмотр/i,
];

function normalizeForHallucinationCheck(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.!?…,;:"'«»]+$/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function isLikelyHallucination(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  if (/^\.+$/.test(trimmed)) return true;
  if (!/\p{L}/u.test(trimmed)) return true; // только эмодзи/символы, ни одной буквы
  if (/^(.)\1{4,}$/u.test(trimmed.replace(/\s+/g, ''))) return true; // "ААААААААААА"

  const normalized = normalizeForHallucinationCheck(trimmed);
  if (EXACT_HALLUCINATION_PHRASES.has(normalized)) return true;
  return HALLUCINATION_PREFIX_PATTERNS.some((re) => re.test(trimmed));
}
