import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SidecarError } from './errors.js';

export const GLOBAL_INSTRUCTIONS_DIR = path.join(os.homedir(), '.sidecar-cli', 'instructions');

export interface ResolvedInstructionsSource {
  sourcePath: string;
  sourceLabel: string;
  content: string;
}

function readInstructionsFile(sourcePath: string, sourceLabel: string): ResolvedInstructionsSource {
  if (!fs.existsSync(sourcePath)) {
    throw new SidecarError(`Instructions source not found: ${sourcePath}`);
  }
  const stat = fs.statSync(sourcePath);
  if (!stat.isFile()) {
    throw new SidecarError(`Instructions source is not a file: ${sourcePath}`);
  }
  return {
    sourcePath,
    sourceLabel,
    content: fs.readFileSync(sourcePath, 'utf8'),
  };
}

export function resolveInstructionsSource(opts: {
  templateName?: string;
  sourcePath?: string;
  cwd: string;
}): ResolvedInstructionsSource | null {
  const templateName = opts.templateName?.trim();
  const sourcePath = opts.sourcePath?.trim();

  if (!templateName && !sourcePath) return null;
  if (templateName && sourcePath) {
    throw new SidecarError('Use only one option: --instructions-template or --instructions-file.');
  }

  if (sourcePath) {
    const resolvedPath = path.resolve(opts.cwd, sourcePath);
    return readInstructionsFile(resolvedPath, `file:${resolvedPath}`);
  }

  const fileName = templateName?.endsWith('.md') ? templateName : `${templateName}.md`;
  if (!fileName) return null;
  const globalPath = path.join(GLOBAL_INSTRUCTIONS_DIR, fileName);
  if (!fs.existsSync(globalPath)) {
    throw new SidecarError(
      `Instructions template "${templateName}" not found at ${globalPath}. Create it under ${GLOBAL_INSTRUCTIONS_DIR}.`
    );
  }
  return readInstructionsFile(globalPath, `template:${templateName}`);
}
