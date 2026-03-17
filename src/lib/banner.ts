export const SIDECAR_MARK = '[■]─[▪]  sidecar';
export const SIDECAR_TAGLINE = 'project memory for your work';

export function bannerDisabled(argv: string[] = process.argv): boolean {
  return process.env.SIDECAR_NO_BANNER === '1' || argv.includes('--no-banner');
}

export function renderBanner(includeTagline = true): string {
  const lines = [SIDECAR_MARK, ''];
  if (includeTagline) {
    lines.push(SIDECAR_TAGLINE);
  }
  return lines.join('\n');
}

