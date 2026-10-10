// A stand-in for the Claude API, used by the screenshot tests so they cost
// nothing and need no real key. The screenshot-read function is pointed at it
// only on the local stack (see scripts/test-integration.mjs). It records every
// request so the tests can check exactly what would have been sent to Claude.
import { createServer, type Server } from 'node:http';
import { crc32, deflateSync } from 'node:zlib';

export type FakeReply = { status: number; body: unknown };
export type CapturedRequest = { path: string; headers: Record<string, string | string[] | undefined>; body: any };

export class FakeClaude {
  readonly requests: CapturedRequest[] = [];
  private readonly replies: FakeReply[] = [];
  private server: Server | null = null;

  async start(port: number): Promise<void> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        let body: unknown = null;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          body = null;
        }
        this.requests.push({ path: req.url ?? '', headers: req.headers, body });
        // Nothing queued: behave like an API outage.
        const reply = this.replies.shift() ?? { status: 500, body: { type: 'error', error: { type: 'api_error', message: 'fake outage' } } };
        res.writeHead(reply.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(reply.body));
      });
    });
    // All interfaces, so the function in Docker can reach it via host.docker.internal.
    await new Promise<void>((resolve) => this.server!.listen(port, '0.0.0.0', resolve));
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  reset(): void {
    this.requests.length = 0;
    this.replies.length = 0;
  }

  // Queue the next reply: a normal message whose text is `output` (an object
  // is sent as JSON, a string as it is).
  willAnswer(output: unknown, stopReason = 'end_turn'): void {
    this.replies.push({ status: 200, body: message(typeof output === 'string' ? output : JSON.stringify(output), stopReason) });
  }

  willFail(status: number, times = 1): void {
    for (let i = 0; i < times; i++) {
      this.replies.push({ status, body: { type: 'error', error: { type: status === 529 ? 'overloaded_error' : 'api_error', message: 'fake' } } });
    }
  }

  // The image the function sent in its most recent request, decoded.
  lastImage(): Buffer {
    const content = this.requests.at(-1)?.body?.messages?.[0]?.content ?? [];
    const image = content.find((c: { type: string }) => c.type === 'image');
    return Buffer.from(image.source.data, 'base64');
  }
}

function message(text: string, stopReason: string) {
  return {
    id: 'msg_fake',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

// Test images ------------------------------------------------------------------

// A real PNG drawn pixel by pixel, optionally with a text chunk (metadata that
// must not survive cleaning).
export function png(width: number, height: number, pixel: (x: number, y: number) => number, text?: string): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const rows = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rows[y * (width + 1) + 1 + x] = pixel(x, y);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...(text ? [chunk('tEXt', Buffer.from(`Comment\0${text}`, 'latin1'))] : []),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Bright on the left, dark on the right, and the reverse: as different as two
// images can be to a dHash.
export const darkening = (w = 120, h = 200) => png(w, h, (x) => 255 - Math.floor((x / w) * 255));
export const brightening = (w = 120, h = 200) => png(w, h, (x) => Math.floor((x / w) * 255));

// A tiny real JPEG (48 by 32, orange), made once with ImageMagick.
export const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAgADADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwCSV4AAAAAAAAAD//2Q==',
  'base64',
);

// The same JPEG with an EXIF block added straight after the start marker,
// carrying a made-up location, as a phone photo would.
export function jpegWithExif(secret: string): Buffer {
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from(secret, 'latin1')]);
  const segment = Buffer.alloc(4);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([JPEG.subarray(0, 2), segment, payload, JPEG.subarray(2)]);
}

// Width and height of a JPEG, read from its frame header.
export function jpegSize(bytes: Buffer): { width: number; height: number } {
  let i = 2;
  while (i < bytes.length) {
    const marker = bytes[i + 1];
    const length = bytes.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  throw new Error('No JPEG frame header');
}
