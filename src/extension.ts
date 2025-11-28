import * as vscode from "vscode";
import { getFontActions } from "./utils/font-manager";
import { getThemeActions } from "./utils/theme-manager";

export function activate(context: vscode.ExtensionContext): void {
  // Workbench font actions
  const workbenchFontActions = vscode.commands.registerCommand(
    "sh1ffy.workbenchFontActions",
    async () => {
      const actions = getFontActions();

      const picked = await vscode.window.showQuickPick(
        actions.map(action => ({
          label: action.label,
          description: action.description,
          action,
        })),
        {
          placeHolder: "Sh1ffy – WorkBench font actions",
          matchOnDescription: true,
        },
      );

      if (!picked) {
        return;
      }

      await picked.action.handler();
    },
  );

  // Color theme actions
  const colorThemeActions = vscode.commands.registerCommand(
    "sh1ffy.colorThemeActions",
    async () => {
      const actions = getThemeActions();

      const picked = await vscode.window.showQuickPick(
        actions.map(action => ({
          label: action.label,
          description: action.description,
          action,
        })),
        {
          placeHolder: "Sh1ffy – Theme actions",
          matchOnDescription: true,
        },
      );

      if (!picked) {
        return;
      }

      await picked.action.handler(context);
    },
  );

  context.subscriptions.push(workbenchFontActions, colorThemeActions);
}

export function deactivate(): void {
  // No explicit cleanup required.
}