import fs from 'fs';
import path from 'path';

const CRON_OWNER_ONLY_PATTERN =
  /(function createCronTool\([^)]*\)\s*{[\s\S]*?\bname:\s*"cron",\s*\n\s*ownerOnly:\s*)true,/;
const OWNER_ONLY_FALLBACK_PATTERN =
  /(const OWNER_ONLY_TOOL_NAME_FALLBACKS = new Set\(\[\s*\n\s*"whatsapp_login",\s*\n\s*)"cron",\s*\n(\s*"gateway"\s*\n\s*\]\);)/;
const WECOM_EXEC_DENY_PATTERN =
  /const TOOL_DENY_BY_MESSAGE_PROVIDER = \{ voice: \["tts"\](?:,\s*wecom: \["exec", "process"\])? \};/;

const walkJsFiles = (dirPath: string, files: string[]): void => {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkJsFiles(fullPath, files);
      continue;
    }
    if (entry.isFile() && fullPath.endsWith('.js')) {
      files.push(fullPath);
    }
  }
};

export const patchCronToolOwnerOnly = (source: string): { changed: boolean; content: string } => {
  if (!source.includes('function createCronTool(') || !source.includes('name: "cron"')) {
    return { changed: false, content: source };
  }
  const next = source.replace(CRON_OWNER_ONLY_PATTERN, '$1false,');
  return {
    changed: next !== source,
    content: next,
  };
};

export const patchCronOwnerFallback = (source: string): { changed: boolean; content: string } => {
  if (!source.includes('OWNER_ONLY_TOOL_NAME_FALLBACKS') || !source.includes('"cron"')) {
    return { changed: false, content: source };
  }
  const next = source.replace(OWNER_ONLY_FALLBACK_PATTERN, '$1$2');
  return {
    changed: next !== source,
    content: next,
  };
};

export const patchWecomMessageProviderExecDeny = (
  source: string,
): { changed: boolean; content: string } => {
  if (!source.includes('TOOL_DENY_BY_MESSAGE_PROVIDER') || !source.includes('voice: ["tts"]')) {
    return { changed: false, content: source };
  }
  if (source.includes('wecom: ["exec", "process"]')) {
    return { changed: false, content: source };
  }
  const next = source.replace(
    WECOM_EXEC_DENY_PATTERN,
    'const TOOL_DENY_BY_MESSAGE_PROVIDER = { voice: ["tts"], wecom: ["exec", "process"] };',
  );
  return {
    changed: next !== source,
    content: next,
  };
};

export const applyBundledOpenClawRuntimeHotfixes = (
  runtimeRoot: string,
): { changed: boolean; patchedFiles: string[]; errors: string[] } => {
  const distRoot = path.join(runtimeRoot, 'dist');
  const jsFiles: string[] = [];
  walkJsFiles(distRoot, jsFiles);

  const patchedFiles: string[] = [];
  const errors: string[] = [];

  for (const filePath of jsFiles) {
    let source = '';
    try {
      source = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      errors.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const cronOwnerPatch = patchCronToolOwnerOnly(source);
    const fallbackPatch = patchCronOwnerFallback(cronOwnerPatch.content);
    const wecomExecPatch = patchWecomMessageProviderExecDeny(fallbackPatch.content);
    if (!cronOwnerPatch.changed && !fallbackPatch.changed && !wecomExecPatch.changed) continue;

    try {
      fs.writeFileSync(filePath, wecomExecPatch.content, 'utf8');
      patchedFiles.push(filePath);
    } catch (error) {
      errors.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    changed: patchedFiles.length > 0,
    patchedFiles,
    errors,
  };
};
