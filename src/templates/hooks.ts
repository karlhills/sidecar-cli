// Claude Code hook settings template for Sidecar ambient capture.
// Drop into .claude/settings.json (project) or ~/.claude/settings.json (user) —
// Claude Code merges arrays across scopes.
//
// Also referenced from the README "Ambient capture via hooks" section and emitted
// by `sidecar hooks print` for copy/paste.
export const CLAUDE_CODE_HOOK_SETTINGS = {
  hooks: {
    SessionStart: [
      {
        hooks: [{ type: 'command', command: 'sidecar hook session-start' }],
      },
    ],
    SessionEnd: [
      {
        hooks: [{ type: 'command', command: 'sidecar hook session-end' }],
      },
    ],
    PostToolUse: [
      {
        matcher: 'Edit|Write|MultiEdit|NotebookEdit',
        hooks: [{ type: 'command', command: 'sidecar hook file-edit' }],
      },
    ],
    UserPromptSubmit: [
      {
        hooks: [{ type: 'command', command: 'sidecar hook user-prompt' }],
      },
    ],
  },
} as const;

export function renderClaudeCodeHooksJson(): string {
  return JSON.stringify(CLAUDE_CODE_HOOK_SETTINGS, null, 2);
}
