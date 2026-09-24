/**
 * /compose — Multiline composer overlay for Pi
 *
 * Opens a dedicated modal/overlay multiline editor for reliable
 * multiline prompt entry.
 *
 * Usage:
 *   /compose          — open the multiline composer
 *
 * Interaction:
 *   Enter            — insert a newline (multiline editing)
 *   Ctrl+Enter       — submit the composed text via sendUserMessage
 *   Escape / Ctrl+C  — cancel without sending
 *
 * Behavior:
 *   - Empty or whitespace-only input is rejected (nothing sent)
 *   - sendUserMessage is called exactly once per submit action
 *   - No coupling to Autopilot, Workflow, Subagents, Model Router,
 *     Memory, Git, or other orchestration layers.
 *
 * Dependencies:
 *   - @earendil-works/pi-tui (bundled static import via loader)
 *   - @earendil-works/pi-coding-agent (bundled static import via loader)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Editor, matchesKey } from "@earendil-works/pi-tui";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("compose", {
    description: "Open a multiline composer for reliable prompt entry",
    handler: async (args, ctx) => {
      const text = await ctx.ui.custom<string | undefined>(
        (tui, theme, keybindings, done) => {
          const editor = new Editor(tui, theme);
          // Disable default Enter→submit so Enter inserts newlines instead
          editor.disableSubmit = true;

          // Override handleInput: Enter→newline, Ctrl+Enter→submit, Esc→cancel
          const originalHandleInput = editor.handleInput.bind(editor);
          editor.handleInput = (data) => {
            // Enter → insert newline (reliable across terminals)
            if (matchesKey(data, "enter")) {
              (editor as any).addNewLine();
              return;
            }
            // Ctrl+Enter → submit the composed text
            if (matchesKey(data, "ctrl+enter")) {
              done(editor.getText());
              return;
            }
            // Escape / Ctrl+C → cancel without sending
            if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
              done(undefined);
              return;
            }
            // All other keys → Editor default handling (arrows, backspace, etc.)
            originalHandleInput(data);
          };

          return editor;
        },
        { overlay: true },
      );

      // Send exactly once if text is non-empty
      if (text && text.trim()) {
        await pi.sendUserMessage(text);
      } else {
        ctx.ui.notify("Compose cancelled or empty — nothing sent.", "info");
      }
    },
  });
}
