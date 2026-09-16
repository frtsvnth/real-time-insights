import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8000),

  WHISPER_BASE_URL: z.string().min(1, 'WHISPER_BASE_URL обязателен'),
  WHISPER_API_KEY: z.string().optional().default(''),
  WHISPER_MODEL: z.string().optional().default(''),
  WHISPER_PROTOCOL: z.enum(['openai', 'asr', 'custom']).default('custom'),
  WHISPER_FIELD_NAME: z.string().optional().default('file'),
  WHISPER_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),

  LLM_BASE_URL: z.string().min(1, 'LLM_BASE_URL обязателен'),
  LLM_API_KEY: z.string().optional().default(''),
  LLM_MODEL: z.string().min(1, 'LLM_MODEL обязателен'),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(25000),

  // Курс для счётчика расходов в UI. Провайдеры (routerai и т.п.) отдают cost в USD
  // прямо в ответе API — переводим в рубли просто по фиксированному курсу, без похода
  // за курсом ЦБ ради счётчика в углу экрана.
  USD_TO_RUB_RATE: z.coerce.number().positive().default(80),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Некорректная конфигурация окружения:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
