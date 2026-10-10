import { z } from 'zod';

import { refusal, type DbError } from '../_shared/dbErrors.ts';
import { createHandler, type HandlerContext, type HandlerResult } from '../_shared/handler.ts';
import { HttpError } from '../_shared/http.ts';
import { cleanImage, MAX_UPLOAD_BYTES } from './image.ts';
import { readerKey, readRun } from './reader.ts';

// Reads a run from a screenshot (PRD 6.3, 11). Nothing is saved as a run here:
// the runner sees the values and confirms them with screenshot-confirm.
//
//   1. The shared wrapper: POST only, rate limits (3 a minute and 10 a day per
//      user, PRD 9.3, counted on every attempt so failed reads cost the same),
//      verified login, strict input.
//   2. Kill switch: no API key means the reader is off.
//   3. The image is checked and cleaned (image.ts), then sent to Claude
//      (reader.ts). It is never stored and never logged.
//   4. The reading and the image's fingerprint are saved, unless the same
//      screenshot has been used before, by anyone (PRD 6.4).

// Base64 makes 5 MB into about 6.7 MB of text.
const MAX_BASE64_CHARS = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4;

const schema = z.strictObject({
  image: z.base64({ error: 'That image could not be sent.' }).min(4).max(MAX_BASE64_CHARS, {
    error: 'That screenshot is too big. The limit is 5 MB.',
  }),
});
type Input = z.output<typeof schema>;

const TYPE_IT_IN = 'Type your run in instead.';
const KNOWN = { invalid_reading: new HttpError(422, 'not_a_run', `We couldn't read a run from that screenshot. ${TYPE_IT_IN}`) };

async function handle({ userId, input, admin }: HandlerContext<Input>): Promise<HandlerResult> {
  const apiKey = readerKey();
  if (!apiKey) {
    throw new HttpError(503, 'reader_off', `The screenshot reader is switched off right now. ${TYPE_IT_IN}`);
  }

  const image = await cleanImage(decodeBase64(input.image));
  const result = await readRun(image.jpeg, apiKey);
  if (result.kind === 'unavailable') {
    throw new HttpError(503, 'reader_unavailable', `The screenshot reader isn't working right now. ${TYPE_IT_IN}`);
  }
  if (result.kind === 'not_a_run') {
    throw new HttpError(422, 'not_a_run', `We couldn't read a run from that screenshot. ${TYPE_IT_IN}`);
  }

  const { reading } = result;
  const { data, error } = await admin
    .rpc('save_screenshot_reading', {
      p_user_id: userId,
      // As text: a JSON number cannot hold every 64-bit value exactly.
      p_dhash: image.dhash.toString(),
      p_distance_m: reading.distance_m,
      p_duration_s: reading.duration_s,
      p_run_date: reading.date,
      p_start_time: reading.start_time,
      p_source_app: reading.source_app,
    })
    .single<{ status: string; reading_id: string | null; expires_at: string | null }>();
  if (error) throw refusal(error as DbError, KNOWN) ?? error;

  if (data.status === 'reused') {
    throw new HttpError(409, 'screenshot_reused', 'That screenshot has already been used. Each run can only be logged once.');
  }
  if (data.status !== 'new' && data.status !== 'existing') {
    throw new Error('Unexpected result from the database');
  }
  return {
    status: 200,
    body: {
      reading: {
        id: data.reading_id,
        expires_at: data.expires_at,
        distance_m: reading.distance_m,
        duration_s: reading.duration_s,
        date: reading.date,
        start_time: reading.start_time,
        source_app: reading.source_app,
      },
    },
  };
}

function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

Deno.serve(
  createHandler({
    name: 'screenshot-read',
    schema,
    // PRD 9.3: screenshot upload and read, 3 per minute and 10 per day per user.
    limits: [
      { scope: 'screenshot_read', limit: 3, windowSeconds: 60 },
      { scope: 'screenshot_read', limit: 10, windowSeconds: 86400 },
    ],
    // The image plus JSON wrapping, and nothing more.
    maxBodyBytes: MAX_BASE64_CHARS + 1024,
    handle,
  }),
);
