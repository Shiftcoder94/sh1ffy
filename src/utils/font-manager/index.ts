import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

/**
 * ID of the <style> tag that Sh1ffy injects into the workbench HTML.
 * This is used both for insertion and removal.
 */
const STYLE_ID = "sh1ffy-tweaks";

/**
 * Opening tag pattern used as a quick presence check in the workbench HTML.
 */
const STYLE_TAG_OPEN = `<style id="${STYLE_ID}">`;

/**
 * Logical identifiers for font-related actions.
 */
type FontActionId = "set" | "enable" | "disable" | "reload" | "reset";

/**
 * Descriptor for a single font-related action.
 * Used to build the QuickPick menu in the extension entrypoint.
 */
export interface FontAction {
  readonly id: FontActionId;
  readonly label: string;        // Short label, shown as the primary line in QuickPick
  readonly description: string;  // Secondary line in QuickPick, explains the action
  readonly handler: () => Promise<void>;
}

/**
 * Returns the list of font actions available under the Sh1ffy workbench font menu.
 *
 * All UI logic is kept in the handlers; this function is a pure descriptor factory.
 */
export function getFontActions(): FontAction[] {
  return [
    {
      id: "set",
      label: "Set WorkBench Font",
      description: "Choose the workbench UI font family",
      handler: handleSetCustomFont,
    },
    {
      id: "enable",
      label: "Enable WorkBench Font",
      description: "Apply Sh1ffy font tweaks to the workbench UI",
      handler: handleEnableCustomFont,
    },
    {
      id: "disable",
      label: "Disable WorkBench Font",
      description: "Remove Sh1ffy font tweaks from the workbench UI",
      handler: handleDisableCustomFont,
    },
    {
      id: "reload",
      label: "Reload Font Configuration",
      description: "Reapply the current Sh1ffy workbench font configuration",
      handler: handleReloadFontConfiguration,
    },
    {
      id: "reset",
      label: "Reset to Defaults",
      description: "Clear Sh1ffy font configuration and restore default UI font",
      handler: handleResetToDefaults,
    },
  ];
}

/* -------------------------------------------------------------------------- */
/*                               Action handlers                              */
/* -------------------------------------------------------------------------- */

/**
 * Prompts the user for a font family name and persists it in Sh1ffy's configuration.
 *
 * After saving, optionally offers a follow-up action:
 *  - If tweaks are not yet enabled: "Enable and reload".
 *  - If tweaks are already enabled: "Reload with new font".
 */
async function handleSetCustomFont(): Promise<void> {
  const current = getWorkbenchFont();

  const value = await vscode.window.showInputBox({
    prompt: "Enter the full name of the font family to use for the workbench UI",
    placeHolder: "Examples: JetBrains Mono, Cascadia Code",
    value: current ?? "",
    ignoreFocusOut: true,
  });

  // User cancelled the input box.
  if (value === undefined) {
    return;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    await vscode.window.showWarningMessage(
      "Sh1ffy: Font name was empty. No changes were made.",
    );
    return;
  }

  await setWorkbenchFont(trimmed);

  // Detect whether the Sh1ffy style is currently present.
  // If workbench.html cannot be read, fall back to a simple informational message.
  let hasStyle = false;
  try {
    const html = getWorkbenchHtml();
    hasStyle = html.includes(STYLE_TAG_OPEN);
  } catch (error) {
    console.warn("Sh1ffy: Could not inspect workbench.html:", error);
    await vscode.window.showInformationMessage(
      `Sh1ffy: Workbench font saved as "${trimmed}". Use "Enable WorkBench Font" from the Sh1ffy menu to apply it.`,
    );
    return;
  }

  const buttonLabel = hasStyle ? "Reload with new font" : "Enable and reload";
  const message = hasStyle
    ? `Sh1ffy: Workbench font updated to "${trimmed}". Reload to apply it now.`
    : `Sh1ffy: Workbench font set to "${trimmed}". Enable and reload to apply it.`;

  const action = await vscode.window.showInformationMessage(
    message,
    buttonLabel,
  );

  if (!action) {
    return;
  }

  if (hasStyle) {
    await handleReloadFontConfiguration();
  } else {
    await handleEnableCustomFont();
  }
}

/**
 * Enables the Sh1ffy font tweaks by injecting a <style> block into workbench.html,
 * then offers to reload the window to apply changes.
 */
async function handleEnableCustomFont(): Promise<void> {
  const font = getWorkbenchFont();
  if (!font) {
    const action = await vscode.window.showWarningMessage(
      "Sh1ffy: No workbench font is configured.",
      "Set font",
    );
    if (action === "Set font") {
      await handleSetCustomFont();
    }
    return;
  }

  try {
    const html = getWorkbenchHtml();

    if (html.includes(STYLE_TAG_OPEN)) {
      await vscode.window.showInformationMessage(
        "Sh1ffy: Workbench font tweaks are already enabled.",
      );
      return;
    }

    const styleMarkup = getStyleMarkup(font);
    const newHtml = injectStyle(html, styleMarkup);
    saveWorkbenchHtml(newHtml);

    await showReloadNotification(
      `Sh1ffy: Workbench font "${font}" enabled. Reload the window to apply it.`,
    );
  } catch (error) {
    console.error("Sh1ffy: Failed to enable custom font:", error);
    await vscode.window.showErrorMessage(
      "Sh1ffy: Failed to enable the workbench font. See logs for details.",
    );
  }
}

/**
 * Disables Sh1ffy font tweaks by removing the injected <style> block
 * from workbench.html, then offers to reload the window.
 */
async function handleDisableCustomFont(): Promise<void> {
  try {
    const html = getWorkbenchHtml();

    if (!html.includes(STYLE_TAG_OPEN)) {
      await vscode.window.showInformationMessage(
        "Sh1ffy: Workbench font tweaks are already disabled.",
      );
      return;
    }

    const newHtml = removeStyle(html);
    saveWorkbenchHtml(newHtml);

    await showReloadNotification(
      "Sh1ffy: Workbench font tweaks removed. Reload the window to revert the UI.",
    );
  } catch (error) {
    console.error("Sh1ffy: Failed to disable custom font:", error);
    await vscode.window.showErrorMessage(
      "Sh1ffy: Failed to disable the workbench font. See logs for details.",
    );
  }
}

/**
 * Re-applies the Sh1ffy font configuration:
 *  - Removes any existing Sh1ffy style block.
 *  - Injects a fresh style block using the current configuration value.
 */
async function handleReloadFontConfiguration(): Promise<void> {
  const font = getWorkbenchFont();
  if (!font) {
    await vscode.window.showWarningMessage(
      "Sh1ffy: No workbench font is configured. Set one first.",
    );
    return;
  }

  try {
    let html = getWorkbenchHtml();

    if (html.includes(STYLE_TAG_OPEN)) {
      html = removeStyle(html);
    }

    const styleMarkup = getStyleMarkup(font);
    const newHtml = injectStyle(html, styleMarkup);
    saveWorkbenchHtml(newHtml);

    await showReloadNotification(
      `Sh1ffy: Workbench font reloaded with "${font}". Reload the window to see the result.`,
    );
  } catch (error) {
    console.error("Sh1ffy: Failed to reload font configuration:", error);
    await vscode.window.showErrorMessage(
      "Sh1ffy: Failed to reload the workbench font configuration.",
    );
  }
}

/**
 * Resets Sh1ffy font configuration to defaults:
 *  - Clears the stored workbench font setting.
 *  - Removes any Sh1ffy style block from workbench.html.
 */
async function handleResetToDefaults(): Promise<void> {
  const confirmation = await vscode.window.showWarningMessage(
    "Reset Sh1ffy workbench font configuration to defaults?",
    { modal: true },
    "Reset",
  );

  if (confirmation !== "Reset") {
    return;
  }

  try {
    // Clear configuration (revert to default / unset)
    await setWorkbenchFont(undefined);

    // Remove style if present
    let changed = false;
    try {
      const html = getWorkbenchHtml();
      if (html.includes(STYLE_TAG_OPEN)) {
        const newHtml = removeStyle(html);
        saveWorkbenchHtml(newHtml);
        changed = true;
      }
    } catch (error) {
      console.warn("Sh1ffy: Could not modify workbench.html during reset:", error);
    }

    if (changed) {
      await showReloadNotification(
        "Sh1ffy: Workbench font configuration reset. Reload the window to restore the default UI font.",
      );
    } else {
      await vscode.window.showInformationMessage(
        "Sh1ffy: Workbench font configuration reset to defaults.",
      );
    }
  } catch (error) {
    console.error("Sh1ffy: Failed to reset font configuration:", error);
    await vscode.window.showErrorMessage(
      "Sh1ffy: Failed to reset the workbench font configuration.",
    );
  }
}

/* -------------------------------------------------------------------------- */
/*                           Workbench HTML helpers                           */
/* -------------------------------------------------------------------------- */

/**
 * Cached path to workbench.html to avoid redundant filesystem checks.
 */
let cachedWorkbenchPath: string | undefined;

/**
 * Resolves the absolute path to workbench.html for the current VS Code installation.
 *
 * Supports both the "electron-sandbox" and older "electron-browser" layouts.
 */
function getWorkbenchPath(): string {
  if (cachedWorkbenchPath) {
    return cachedWorkbenchPath;
  }

  const sandboxRelative =
    "out/vs/code/electron-sandbox/workbench/workbench.html";
  const browserRelative =
    "out/vs/code/electron-browser/workbench/workbench.html";

  let resolved = path.join(vscode.env.appRoot, sandboxRelative);

  if (!fs.existsSync(resolved)) {
    resolved = path.join(vscode.env.appRoot, browserRelative);
  }

  cachedWorkbenchPath = resolved;
  return resolved;
}

/**
 * Reads and returns the contents of workbench.html as UTF-8 text.
 */
function getWorkbenchHtml(): string {
  return fs.readFileSync(getWorkbenchPath(), "utf8");
}

/**
 * Writes the given HTML content back to workbench.html using UTF-8 encoding.
 */
function saveWorkbenchHtml(html: string): void {
  fs.writeFileSync(getWorkbenchPath(), html, "utf8");
}

/**
 * Builds the <style> markup injected into workbench.html using the given font family.
 *
 * The CSS is based on the selectors you provided, with the font family substituted.
 */
function getStyleMarkup(fontFamily: string): string {
  // Escape double quotes to avoid breaking the CSS string literal.
  const safeFont = fontFamily.replace(/"/g, '\\"');

  const css = `
*:not(
  .monaco-editor-background,
  .monaco-editor-background *,
  .sticky-widget-lines-scrollable,
  .sticky-widget-lines-scrollable *,
  .notebookOverlay,
  .notebookOverlay *
),
.extensions-search-container *,
.settings-editor * {
  font-family: "${safeFont}";
}
`.trim();

  return `<style id="${STYLE_ID}">
${css}
</style>`;
}

/**
 * Injects the style markup immediately before </head> in the given HTML.
 * If </head> is not found, the style is appended to the end of the document.
 */
function injectStyle(html: string, styleMarkup: string): string {
  const headCloseIndex = html.indexOf("</head>");

  if (headCloseIndex === -1) {
    return `${html}\n${styleMarkup}\n`;
  }

  return (
    html.slice(0, headCloseIndex) +
    styleMarkup +
    "\n" +
    html.slice(headCloseIndex)
  );
}

/**
 * Removes the Sh1ffy <style> block (identified by STYLE_ID) from the given HTML.
 */
function removeStyle(html: string): string {
  const pattern = new RegExp(
    `<style\\s+id="${STYLE_ID}"[^>]*>[\\s\\S]*?<\\/style>`,
    "m",
  );
  return html.replace(pattern, "");
}

/* -------------------------------------------------------------------------- */
/*                           Configuration helpers                            */
/* -------------------------------------------------------------------------- */

/**
 * Reads the configured Sh1ffy workbench font from the global VS Code settings.
 */
function getWorkbenchFont(): string | undefined {
  return vscode.workspace
    .getConfiguration()
    .get<string>("sh1ffy.workbenchFont");
}

/**
 * Persists the given font family as the global Sh1ffy workbench font.
 * Passing undefined clears the setting (reverts to default).
 */
async function setWorkbenchFont(font: string | undefined): Promise<void> {
  await vscode.workspace
    .getConfiguration()
    .update(
      "sh1ffy.workbenchFont",
      font,
      vscode.ConfigurationTarget.Global,
    );
}

/* -------------------------------------------------------------------------- */
/*                           Reload notification                              */
/* -------------------------------------------------------------------------- */

/**
 * Shows a notification with a "Reload Window" button and, if clicked,
 * triggers VS Code's built-in window reload command.
 */
async function showReloadNotification(message: string): Promise<void> {
  const action = await vscode.window.showInformationMessage(
    message,
    "Reload Window",
  );

  if (action === "Reload Window") {
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
}