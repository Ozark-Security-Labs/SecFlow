import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

export function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

export function relativePosix(root: string, filePath: string): string {
  return toPosixPath(path.relative(root, filePath));
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, {recursive: true});
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

export async function writeText(filePath: string, value: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, value, 'utf8');
}

export function isIgnoredRelativePath(relativePath: string): boolean {
  const normalized = toPosixPath(relativePath);
  return (
    normalized === '' ||
    normalized.startsWith('.git/') ||
    normalized.startsWith('node_modules/') ||
    normalized.startsWith('dist/') ||
    normalized.startsWith('coverage/') ||
    normalized.startsWith('.secflow/runs/') ||
    normalized.includes('/node_modules/') ||
    normalized.includes('/.git/')
  );
}
