/**
 * Dev-only: serve one cached frame to the labelling page.
 *
 * The frames live in cache/tokon/frames/<id>/<zero-padded second>.png, outside
 * public/, and they must stay there — they are ~3.6 GB of downloaded footage,
 * gitignored, and nothing about them belongs in a built site. This hands them to
 * the dev page and 404s everywhere else.
 *
 * The id and second are both validated against strict patterns before touching
 * the filesystem. They arrive from a query string, so treating them as a path is
 * how a dev tool becomes an arbitrary-file-read.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ID_RE = /^[A-Za-z0-9_-]{6,20}$/;

export default defineEventHandler((event) => {
  if (!import.meta.dev) throw createError({ statusCode: 404 });

  const q = getQuery(event);
  const id = String(q.id ?? '');
  const sec = Number(q.sec);
  if (!ID_RE.test(id)) throw createError({ statusCode: 400, statusMessage: 'bad id' });
  if (!Number.isInteger(sec) || sec < 0 || sec > 86_400) {
    throw createError({ statusCode: 400, statusMessage: 'bad sec' });
  }

  const dir = resolve(process.cwd(), 'cache/tokon/frames');
  const file = join(dir, id, `${String(sec).padStart(6, '0')}.png`);
  // Belt and braces: the patterns above already exclude traversal, and this
  // proves the resolved path never leaves the frame cache.
  if (!resolve(file).startsWith(dir + '/')) throw createError({ statusCode: 400 });
  if (!existsSync(file)) throw createError({ statusCode: 404, statusMessage: 'no such frame' });

  setHeader(event, 'content-type', 'image/png');
  setHeader(event, 'content-length', statSync(file).size);
  // These are immutable on disk; let the browser keep them across a labelling
  // session so paging back and forth does not re-read from disk every time.
  setHeader(event, 'cache-control', 'private, max-age=3600');
  return sendStream(event, createReadStream(file));
});
