export function isColorEnabled(): boolean {
  const forced = process.env.FORCE_COLOR === '1' || process.env.FORCE_COLOR === 'true';
  const hasTty = Boolean(process.stdout.isTTY) || forced;
  return hasTty && !process.env.NO_COLOR && !process.argv.includes('--json');
}

const codes = {
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  reset: '\x1b[0m',
};

// Evaluate isColorEnabled() on every call so late changes to NO_COLOR,
// FORCE_COLOR, or --json (e.g. tests flipping env vars) take effect.
// Cheap: two env-var reads plus an argv scan.
function wrap(code: string): (s: string) => string {
  return (s: string): string => (isColorEnabled() ? code + s + codes.reset : s);
}

export const c = {
  bold: wrap(codes.bold),
  dim: wrap(codes.dim),
  red: wrap(codes.red),
  green: wrap(codes.green),
  yellow: wrap(codes.yellow),
  cyan: wrap(codes.cyan),
  magenta: wrap(codes.magenta),
};
