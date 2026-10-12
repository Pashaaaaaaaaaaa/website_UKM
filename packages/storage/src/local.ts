import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.uploads');

export async function saveLocalImage(bucket: string, key: string, buffer: Buffer) {
  const relative = `${bucket}/${key}`;
  const target = resolve(root, relative);
  if (!target.startsWith(`${root}${sep}`)) throw new Error('Invalid local media path');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buffer, { flag: 'wx' });
  return `local:${relative.replaceAll('\\', '/')}`;
}

export async function readLocalImage(path: string) {
  if (!path.startsWith('local:')) return null;
  const target = resolve(root, path.slice('local:'.length));
  if (!target.startsWith(`${root}${sep}`)) return null;
  return readFile(target);
}
