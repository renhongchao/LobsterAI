import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  applyBundledOpenClawRuntimeHotfixes,
  patchCronToolOwnerOnly,
  patchCronOwnerFallback,
  patchWecomMessageProviderExecDeny,
} = require('../dist-electron/main/libs/openclawRuntimeHotfix.js');

const walkJsFiles = (dirPath, files = []) => {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkJsFiles(fullPath, files);
      continue;
    }
    if (entry.isFile() && fullPath.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
};

test('patchCronToolOwnerOnly only flips the cron tool guard', () => {
  const source = [
    'function createCronTool(opts, deps) {',
    '  return {',
    '    label: "Cron",',
    '    name: "cron",',
    '    ownerOnly: true,',
    '  };',
    '}',
    'function createGatewayTool() {',
    '  return {',
    '    label: "Gateway",',
    '    name: "gateway",',
    '    ownerOnly: true,',
    '  };',
    '}',
  ].join('\n');

  const result = patchCronToolOwnerOnly(source);

  assert.equal(result.changed, true);
  assert.match(result.content, /name: "cron",\n\s+ownerOnly: false,/);
  assert.match(result.content, /name: "gateway",\n\s+ownerOnly: true,/);
});

test('patchCronOwnerFallback removes cron from owner-only fallback names only', () => {
  const source = [
    'const OWNER_ONLY_TOOL_NAME_FALLBACKS = new Set([',
    '  "whatsapp_login",',
    '  "cron",',
    '  "gateway"',
    ']);',
  ].join('\n');

  const result = patchCronOwnerFallback(source);

  assert.equal(result.changed, true);
  assert.doesNotMatch(result.content, /"cron"/);
  assert.match(result.content, /"whatsapp_login"/);
  assert.match(result.content, /"gateway"/);
});

test('patchWecomMessageProviderExecDeny denies exec/process for WeCom native sessions only', () => {
  const source = 'const TOOL_DENY_BY_MESSAGE_PROVIDER = { voice: ["tts"] };';

  const result = patchWecomMessageProviderExecDeny(source);

  assert.equal(result.changed, true);
  assert.match(
    result.content,
    /const TOOL_DENY_BY_MESSAGE_PROVIDER = \{ voice: \["tts"\], wecom: \["exec", "process"\] \};/,
  );
});

test('applyBundledOpenClawRuntimeHotfixes patches matching runtime dist files', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-runtime-hotfix-'));
  const distDir = path.join(tmpRoot, 'dist', 'plugin-sdk');
  fs.mkdirSync(distDir, { recursive: true });

  const targetFile = path.join(distDir, 'reply.js');
  fs.writeFileSync(
    targetFile,
    [
      'function createCronTool(opts, deps) {',
      '  return {',
      '    label: "Cron",',
      '    name: "cron",',
      '    ownerOnly: true,',
      '  };',
      '}',
      'const OWNER_ONLY_TOOL_NAME_FALLBACKS = new Set([',
      '  "whatsapp_login",',
      '  "cron",',
      '  "gateway"',
      ']);',
      'const TOOL_DENY_BY_MESSAGE_PROVIDER = { voice: ["tts"] };',
    ].join('\n'),
    'utf8',
  );

  const controlFile = path.join(tmpRoot, 'dist', 'other.js');
  fs.writeFileSync(
    controlFile,
    [
      'function noop() {',
      '  return { ownerOnly: true };',
      '}',
    ].join('\n'),
    'utf8',
  );

  const result = applyBundledOpenClawRuntimeHotfixes(tmpRoot);

  assert.equal(result.changed, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.patchedFiles, [targetFile]);
  assert.match(fs.readFileSync(targetFile, 'utf8'), /ownerOnly: false,/);
  assert.doesNotMatch(
    fs.readFileSync(targetFile, 'utf8'),
    /OWNER_ONLY_TOOL_NAME_FALLBACKS[\s\S]*"cron"/,
  );
  assert.match(
    fs.readFileSync(targetFile, 'utf8'),
    /TOOL_DENY_BY_MESSAGE_PROVIDER = \{ voice: \["tts"\], wecom: \["exec", "process"\] \};/,
  );
  assert.match(fs.readFileSync(controlFile, 'utf8'), /ownerOnly: true/);
});

test('bundled OpenClaw runtime exposes cron to non-owner native sessions', () => {
  const runtimeDist = path.resolve('vendor/openclaw-runtime/mac-arm64/dist');
  const cronOwnerOffendingFiles = [];
  const cronFallbackOffendingFiles = [];

  for (const filePath of walkJsFiles(runtimeDist)) {
    const source = fs.readFileSync(filePath, 'utf8');
    if (patchCronToolOwnerOnly(source).changed) {
      cronOwnerOffendingFiles.push(path.relative(process.cwd(), filePath));
    }
    if (patchCronOwnerFallback(source).changed) {
      cronFallbackOffendingFiles.push(path.relative(process.cwd(), filePath));
    }
  }

  assert.deepEqual(cronOwnerOffendingFiles, []);
  assert.deepEqual(cronFallbackOffendingFiles, []);
});
