#!/usr/bin/env node

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const version = getArg('--version');
const url = getArg('--url');
const sha256 = getArg('--sha256');

if (!version || !url || !sha256) {
  console.error('Usage: node scripts/generate-homebrew-formula.mjs --version <version> --url <url> --sha256 <sha256>');
  process.exit(1);
}

const formula = `class Sidecar < Formula
  desc "Local-first project memory and recording CLI"
  homepage "https://github.com/${process.env.GITHUB_REPOSITORY || 'OWNER/REPO'}"
  url "${url}"
  version "${version}"
  sha256 "${sha256}"
  license "ISC"

  depends_on "node"

  def install
    libexec.install Dir["*"]
    bin.write_exec_script libexec/"dist/cli.js"
  end

  test do
    assert_match "sidecar", shell_output("#{bin}/sidecar --help")
  end
end
`;

process.stdout.write(formula);
