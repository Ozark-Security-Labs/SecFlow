import {readdir, readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import type {RepoProfile} from './types.js';
import {isIgnoredRelativePath, relativePosix} from '../util/files.js';

const manifestNames = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'requirements.txt',
  'pyproject.toml',
  'Gemfile',
  'composer.json',
  'Dockerfile',
  'docker-compose.yml',
  'compose.yaml',
  'terraform.tf',
  'serverless.yml'
]);

const securityFilePatterns = [
  /auth/i,
  /authorize/i,
  /permission/i,
  /policy/i,
  /route/i,
  /controller/i,
  /middleware/i,
  /payment/i,
  /billing/i,
  /tenant/i,
  /admin/i,
  /session/i,
  /webhook/i
];

const frameworkSignals: Array<[RegExp, string]> = [
  [/package\.json$/, 'Node.js'],
  [/next\.config\./, 'Next.js'],
  [/vite\.config\./, 'Vite'],
  [/app\/.*route\.(ts|js)x?$/, 'Next.js App Router'],
  [/src\/main\.(ts|js)x?$/, 'React/Vite-style frontend'],
  [/go\.mod$/, 'Go'],
  [/Cargo\.toml$/, 'Rust'],
  [/pom\.xml$|build\.gradle$/, 'JVM'],
  [/requirements\.txt$|pyproject\.toml$/, 'Python'],
  [/Gemfile$/, 'Ruby'],
  [/composer\.json$/, 'PHP'],
  [/terraform\.tf$/, 'Terraform']
];

export async function profileRepository(targetPath: string): Promise<RepoProfile> {
  const files = await collectFiles(targetPath);
  const extensions: Record<string, number> = {};
  const manifests: string[] = [];
  const securityRelevantFiles: string[] = [];
  const likelyFrameworks = new Set<string>();
  const notableDirectories = new Set<string>();
  const sampledFiles: RepoProfile['sampledFiles'] = [];
  let totalBytes = 0;

  for (const file of files) {
    totalBytes += file.bytes;
    const extension = path.extname(file.relativePath).toLowerCase() || '[none]';
    extensions[extension] = (extensions[extension] ?? 0) + 1;

    if (manifestNames.has(path.basename(file.relativePath))) {
      manifests.push(file.relativePath);
    }

    for (const [pattern, framework] of frameworkSignals) {
      if (pattern.test(file.relativePath)) {
        likelyFrameworks.add(framework);
      }
    }

    const firstDir = file.relativePath.split('/')[0];
    if (firstDir && ['src', 'app', 'pages', 'routes', 'controllers', 'services', 'api', 'server', 'infra'].includes(firstDir)) {
      notableDirectories.add(firstDir);
    }

    const signals = securityFilePatterns.filter((pattern) => pattern.test(file.relativePath)).map((pattern) => pattern.source.replaceAll('\\', ''));
    if (signals.length > 0) {
      securityRelevantFiles.push(file.relativePath);
    }

    if (sampledFiles.length < 50 && (signals.length > 0 || manifests.includes(file.relativePath))) {
      sampledFiles.push({path: file.relativePath, bytes: file.bytes, signals});
    }
  }

  return {
    targetPath,
    generatedAt: new Date().toISOString(),
    fileCount: files.length,
    totalBytes,
    extensions: sortRecord(extensions),
    manifests: manifests.sort(),
    securityRelevantFiles: securityRelevantFiles.sort().slice(0, 200),
    likelyFrameworks: [...likelyFrameworks].sort(),
    notableDirectories: [...notableDirectories].sort(),
    sampledFiles
  };
}

async function collectFiles(root: string): Promise<Array<{absolutePath: string; relativePath: string; bytes: number}>> {
  const results: Array<{absolutePath: string; relativePath: string; bytes: number}> = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, {withFileTypes: true});
    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      const relativePath = relativePosix(root, absolutePath);
      if (isIgnoredRelativePath(relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const fileStat = await stat(absolutePath);
      results.push({absolutePath, relativePath, bytes: fileStat.size});
    }
  }

  await walk(root);
  return results;
}

export async function readSmallTextFile(root: string, relativePath: string, maxBytes = 20000): Promise<string | undefined> {
  const fullPath = path.join(root, relativePath);
  const fileStat = await stat(fullPath);
  if (fileStat.size > maxBytes) {
    return undefined;
  }
  const buffer = await readFile(fullPath);
  if (buffer.includes(0)) {
    return undefined;
  }
  return buffer.toString('utf8');
}

function sortRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}
