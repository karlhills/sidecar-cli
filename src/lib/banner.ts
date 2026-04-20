export const SIDECAR_MARK = '[■]─[▪]  sidecar';
export const SIDECAR_TAGLINE = 'project memory for your work';

export function bannerDisabled(argv: string[] = process.argv): boolean {
  return process.env.SIDECAR_NO_BANNER === '1' || argv.includes('--no-banner');
}

export function renderBanner(variant: 'compact' | 'block' = 'compact', includeTagline = true): string {
  if (variant === 'block') {
    const blockLines = [
      '  [■]─[▪]',
      '  ███████╗██╗██████╗ ███████╗ ██████╗ █████╗ ██████╗',
      '  ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔══██╗██╔══██╗',
      '  ███████╗██║██║  ██║█████╗  ██║     ███████║██████╔╝',
      '  ╚════██║██║██║  ██║██╔══╝  ██║     ██╔══██║██╔══██╗',
      '  ███████║██║██████╔╝███████╗╚██████╗██║  ██║██║  ██║',
      '  ╚══════╝╚═╝╚═════╝ ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝',
    ];
    if (includeTagline) {
      blockLines.push('');
      blockLines.push(SIDECAR_TAGLINE);
    }
    return blockLines.join('\n');
  }

  const lines = [SIDECAR_MARK, ''];
  if (includeTagline) {
    lines.push(SIDECAR_TAGLINE);
  }
  return lines.join('\n');
}

