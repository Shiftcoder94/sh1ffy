import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

/**
 * Logical identifiers for theme-related actions.
 */
type ThemeActionId =
  | "import"
  | "remove"
  | "list"
  | "repair"
  | "restorePackageJson";

/**
 * Descriptor for a single theme-related action.
 * Used to build the QuickPick menu in the extension entrypoint.
 */
export interface ThemeAction {
  readonly id: ThemeActionId;
  readonly label: string;
  readonly description: string;
  readonly handler: (context: vscode.ExtensionContext) => Promise<void>;
}

/**
 * Prefix applied to imported theme labels so they are recognizable
 * in the Color Theme picker.
 */
const THEME_LABEL_PREFIX = "sh1ffy \u2022 "; // "sh1ffy • "

/**
 * Directory (relative to the extension root) where imported themes are stored.
 */
const THEMES_DIR_RELATIVE = "themes";

/**
 * Tag used in contributes.themes entries to recognize Sh1ffy-managed themes.
 */
const SH1FFY_THEME_TAG = "sh1ffy-managed";

/**
 * Backup filename for package.json, created the first time we mutate it.
 */
const PACKAGE_JSON_BACKUP = "package.json.sh1ffy.bak";

/* -------------------------------------------------------------------------- */
/*                             Public API / actions                           */
/* -------------------------------------------------------------------------- */

export function getThemeActions(): ThemeAction[] {
  return [
    {
      id: "import",
      label: "Import Theme(s)",
      description: "Import JSON/JSONC color themes into Sh1ffy",
      handler: handleImportThemes,
    },
    {
      id: "remove",
      label: "Remove Theme(s)",
      description: "Remove previously imported Sh1ffy themes",
      handler: handleRemoveThemes,
    },
    {
      id: "list",
      label: "List Themes",
      description: "Show currently imported Sh1ffy themes with metadata",
      handler: handleListThemes,
    },
    {
      id: "repair",
      label: "Repair Theme Contributions",
      description: "Rescan the themes folder and fix package.json theme entries",
      handler: handleRepairContributions,
    },
    {
      id: "restorePackageJson",
      label: "Restore package.json Backup",
      description: "Restore the original package.json from the Sh1ffy backup",
      handler: handleRestorePackageJsonBackup,
    },
  ];
}

/* -------------------------------------------------------------------------- */
/*                               Data structures                              */
/* -------------------------------------------------------------------------- */

interface Sh1ffyThemeEntry {
  id: string;
  label: string;
  uiTheme: string;
  path: string;         // relative to extension root
  typeLabel: string;    // "Dark", "Light", "High Contrast"
  sourceFile?: string;  // original file name (if captured)
}

/* -------------------------------------------------------------------------- */
/*                              Core entrypoints                              */
/* -------------------------------------------------------------------------- */

/**
 * Imports one or more theme files, strips comments (JSONC → JSON), normalizes
 * them, writes JSON files into the themes folder (renaming .jsonc → .json),
 * and updates package.json "contributes.themes".
 *
 * New behavior:
 *  - If a theme with the same Sh1ffy label already exists, ask before overwriting.
 *  - After importing a single theme, offer "Apply now" and "Reload Window".
 */
async function handleImportThemes(
  context: vscode.ExtensionContext,
): Promise<void> {
  const uris = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: true,
    filters: {
      "Theme files": ["json", "jsonc"],
      "All files": ["*"],
    },
    openLabel: "Import theme(s)",
  });

  if (!uris || uris.length === 0) {
    return;
  }

  const extensionRoot = context.extensionUri.fsPath;
  const themesDir = path.join(extensionRoot, THEMES_DIR_RELATIVE);

  if (!fs.existsSync(themesDir)) {
    fs.mkdirSync(themesDir, { recursive: true });
  }

  const existingThemes = readImportedThemesFromDisk(extensionRoot);
  const importedNames: string[] = [];
  const importedIds: string[] = [];
  const importedPaths: string[] = [];
  const errors: string[] = [];

  for (const uri of uris) {
    try {
      const absolutePath = uri.fsPath;
      const originalFileName = path.basename(absolutePath);
      const originalExt = path.extname(originalFileName).toLowerCase();

      const fileContent = fs.readFileSync(absolutePath, "utf8");
      const stripped = stripJsonComments(fileContent);
      const themeObject = JSON.parse(stripped);

      if (!themeObject || typeof themeObject !== "object") {
        throw new Error("Theme file does not contain a valid JSON object.");
      }

      const normalized = normalizeThemeObject(themeObject, originalFileName);
      const json = JSON.stringify(normalized, null, 2);

      // Determine final filename: .json stays .json, .jsonc becomes .json
      const targetExt = ".json";
      const baseNameWithoutExt = originalFileName.replace(/\.[^.]+$/, "");
      const targetFileName =
        originalExt === ".json"
          ? originalFileName
          : `${baseNameWithoutExt}${targetExt}`;

      const label = normalized.name ?? baseNameWithoutExt;

      // Duplicate detection: same Sh1ffy label already present?
      const alreadyExisting = existingThemes.find(t => t.label === label);
      if (alreadyExisting) {
        const decision = await vscode.window.showWarningMessage(
          `A Sh1ffy theme named "${label}" already exists. Overwrite its file and contribution entry?`,
          "Overwrite",
          "Skip",
        );
        if (decision !== "Overwrite") {
          continue;
        }
      }

      const targetPath = path.join(themesDir, targetFileName);
      fs.writeFileSync(targetPath, json, "utf8");

      importedNames.push(label);
      importedPaths.push(path.join(THEMES_DIR_RELATIVE, targetFileName));
      importedIds.push(toSafeId(label));
    } catch (error) {
      console.error("Sh1ffy: Failed to import theme:", error);
      errors.push(uri.fsPath);
    }
  }

  // Re-scan and rebuild package.json "contributes.themes" after all imports.
  await syncPackageJsonThemes(extensionRoot);

  // Single-theme UX: offer Apply now + Reload options.
  if (importedNames.length === 1) {
    const label = importedNames[0];
    const baseId = toSafeId(label);
    const themeId = `sh1ffy.${baseId}`;

    const action = await vscode.window.showInformationMessage(
      `Sh1ffy: Imported theme "${label}".`,
      "Apply now",
      "Reload Window",
    );

    if (action === "Apply now") {
      try {
        await setColorThemeById(label);
        await showReloadNotification(
          `Sh1ffy: Theme "${label}" applied. Reload the window to fully apply changes.`,
        );
      } catch (error) {
        console.error("Sh1ffy: Failed to apply imported theme:", error);
        await vscode.window.showErrorMessage(
          "Sh1ffy: Failed to apply the imported theme. See logs for details.",
        );
      }
    } else if (action === "Reload Window") {
      await vscode.commands.executeCommand("workbench.action.reloadWindow");      
      await vscode.commands.executeCommand("workbench.action.reloadWindow");
    }
  } else if (importedNames.length > 1) {
    const message = `Sh1ffy: Imported ${importedNames.length} themes. Reload the window to see them in the Color Theme list.`;
    await showReloadNotification(message);
  }

  if (errors.length > 0) {
    await vscode.window.showWarningMessage(
      `Sh1ffy: Some themes could not be imported. See logs for details.\nFiles: ${errors.join(
        ", ",
      )}`,
    );
  }
}

/**
 * Removes one or more imported Sh1ffy themes (files under themes/)
 * and updates package.json "contributes.themes".
 */
async function handleRemoveThemes(
  context: vscode.ExtensionContext,
): Promise<void> {
  const extensionRoot = context.extensionUri.fsPath;
  const themesDir = path.join(extensionRoot, THEMES_DIR_RELATIVE);

  const themes = readImportedThemesFromDisk(extensionRoot);
  if (themes.length === 0) {
    await vscode.window.showInformationMessage(
      "Sh1ffy: No imported themes found.",
    );
    return;
  }

  const picks = await vscode.window.showQuickPick(
    themes.map(theme => ({
      label: theme.label,
      description: `${theme.typeLabel} – ${theme.id}`,
      detail: theme.path,
      theme,
    })),
    {
      canPickMany: true,
      placeHolder: "Select themes to remove",
      matchOnDescription: true,
    },
  );

  if (!picks || picks.length === 0) {
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Remove ${picks.length} theme(s) from Sh1ffy? This will delete their files from the extension folder and remove their Color Theme entries.`,
    { modal: true },
    "Remove",
  );

  if (confirmation !== "Remove") {
    return;
  }

  for (const pick of picks) {
    const absolutePath = path.join(extensionRoot, pick.theme.path);
    try {
      if (absolutePath.startsWith(themesDir) && fs.existsSync(absolutePath)) {
        fs.unlinkSync(absolutePath);
      }
    } catch (error) {
      console.error(
        `Sh1ffy: Failed to remove theme file "${absolutePath}":`,
        error,
      );
    }
  }

  await syncPackageJsonThemes(extensionRoot);

  await showReloadNotification(
    "Sh1ffy: Selected themes removed. Reload the window to update the Color Theme list.",
  );
}

/**
 * Lists all imported Sh1ffy themes in a read-only QuickPick, with:
 *  - type label (Dark/Light/High Contrast)
 *  - id
 *  - relative path
 */
async function handleListThemes(
  context: vscode.ExtensionContext,
): Promise<void> {
  const extensionRoot = context.extensionUri.fsPath;
  const themes = readImportedThemesFromDisk(extensionRoot);

  if (themes.length === 0) {
    await vscode.window.showInformationMessage(
      "Sh1ffy: No imported themes found.",
    );
    return;
  }

  await vscode.window.showQuickPick(
    themes.map(theme => ({
      label: theme.label,
      description: `${theme.typeLabel} – ${theme.id}`,
      detail: theme.path,
    })),
    {
      placeHolder: "Imported Sh1ffy themes (read-only)",
      canPickMany: false,
    },
  );
}

/**
 * Public action to repair theme contributions:
 *  - Re-scan themes/ folder.
 *  - Regenerate Sh1ffy-managed entries in package.json.
 */
async function handleRepairContributions(
  context: vscode.ExtensionContext,
): Promise<void> {
  const extensionRoot = context.extensionUri.fsPath;

  try {
    await syncPackageJsonThemes(extensionRoot);
    await showReloadNotification(
      "Sh1ffy: Theme contributions repaired. Reload the window to apply changes.",
    );
  } catch (error) {
    console.error("Sh1ffy: Failed to repair theme contributions:", error);
    await vscode.window.showErrorMessage(
      "Sh1ffy: Failed to repair theme contributions. See logs for details.",
    );
  }
}

/**
 * Restores package.json from the Sh1ffy backup file, if present.
 */
async function handleRestorePackageJsonBackup(
  context: vscode.ExtensionContext,
): Promise<void> {
  const extensionRoot = context.extensionUri.fsPath;
  const pkgPath = path.join(extensionRoot, "package.json");
  const backupPath = path.join(extensionRoot, PACKAGE_JSON_BACKUP);

  if (!fs.existsSync(backupPath)) {
    await vscode.window.showWarningMessage(
      "Sh1ffy: No package.json backup was found.",
    );
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    "Restore package.json from the Sh1ffy backup? This will overwrite the current package.json.",
    { modal: true },
    "Restore",
  );

  if (confirmation !== "Restore") {
    return;
  }

  try {
    const backupContents = fs.readFileSync(backupPath, "utf8");
    fs.writeFileSync(pkgPath, backupContents, "utf8");

    await showReloadNotification(
      "Sh1ffy: package.json restored from backup. Reload the window to apply changes.",
    );
  } catch (error) {
    console.error("Sh1ffy: Failed to restore package.json backup:", error);
    await vscode.window.showErrorMessage(
      "Sh1ffy: Failed to restore package.json backup. See logs for details.",
    );
  }
}

/* -------------------------------------------------------------------------- */
/*                       Theme file and contribution helpers                  */
/* -------------------------------------------------------------------------- */

/**
 * Normalizes a theme object to ensure it has at least:
 *  - name (label)
 *  - type / uiTheme
 *
 * Adds the "sh1ffy • " prefix to the name so that it appears branded
 * in the Color Theme list.
 */
function normalizeThemeObject(
  themeObject: any,
  fileName: string,
): any {
  const clone = { ...themeObject };

  const baseNameFromFile = fileName.replace(/\.[^.]+$/, "");

  const originalName: string =
    typeof clone.name === "string" && clone.name.trim().length > 0
      ? clone.name
      : baseNameFromFile;

  const prefixedName = originalName.startsWith(THEME_LABEL_PREFIX)
    ? originalName
    : `${THEME_LABEL_PREFIX}${originalName}`;

  clone.name = prefixedName;

  if (!clone.type && !clone.uiTheme) {
    clone.type = "dark";
  }

  return clone;
}

/**
 * Reads all imported Sh1ffy theme files from the themes directory and builds
 * contribution entries used by VS Code.
 */
function readImportedThemesFromDisk(extensionRoot: string): Sh1ffyThemeEntry[] {
  const themesDir = path.join(extensionRoot, THEMES_DIR_RELATIVE);

  if (!fs.existsSync(themesDir)) {
    return [];
  }

  const files = fs
    .readdirSync(themesDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
    .map(entry => entry.name);

  const results: Sh1ffyThemeEntry[] = [];

  for (const fileName of files) {
    const filePath = path.join(themesDir, fileName);
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const obj = JSON.parse(raw);

      const label: string =
        typeof obj.name === "string" && obj.name.trim().length > 0
          ? obj.name
          : fileName.replace(/\.[^.]+$/, "");

      const baseId = toSafeId(label);
      const id = `sh1ffy.${baseId}`;

      const type: string = obj.type ?? "dark";
      let uiTheme: string;
      let typeLabel: string;

      switch (type.toLowerCase()) {
        case "light":
        case "vs":
          uiTheme = "vs";
          typeLabel = "Light";
          break;
        case "hc":
        case "hc-black":
        case "high-contrast":
          uiTheme = "hc-black";
          typeLabel = "High Contrast";
          break;
        case "dark":
        default:
          uiTheme = "vs-dark";
          typeLabel = "Dark";
          break;
      }

      const relativePath = path.join(THEMES_DIR_RELATIVE, fileName);

      results.push({
        id,
        label,
        uiTheme,
        typeLabel,
        path: relativePath.replace(/\\/g, "/"),
      });
    } catch (error) {
      console.error("Sh1ffy: Failed to read theme file:", filePath, error);
    }
  }

  return results;
}

/**
 * Reads package.json from the extension root.
 */
function readPackageJson(extensionRoot: string): any {
  const pkgPath = path.join(extensionRoot, "package.json");
  const raw = fs.readFileSync(pkgPath, "utf8");
  return JSON.parse(raw);
}

/**
 * Writes a new package.json to the extension root.
 * Creates a backup the first time it is called.
 */
function writePackageJson(extensionRoot: string, pkg: any): void {
  const pkgPath = path.join(extensionRoot, "package.json");
  const backupPath = path.join(extensionRoot, PACKAGE_JSON_BACKUP);

  if (!fs.existsSync(backupPath) && fs.existsSync(pkgPath)) {
    // Create backup only once.
    fs.copyFileSync(pkgPath, backupPath);
  }

  const json = JSON.stringify(pkg, null, 2);
  fs.writeFileSync(pkgPath, json, "utf8");
}

/**
 * Synchronizes package.json's contributes.themes array with the themes
 * currently present in the themes directory.
 *
 * Strategy:
 *  - Remove previous Sh1ffy-managed entries (tagged with SH1FFY_THEME_TAG).
 *  - Add fresh entries for all JSON files in themes/.
 *  - Preserve any non-Sh1ffy theme contributions.
 */
async function syncPackageJsonThemes(extensionRoot: string): Promise<void> {
  const pkg = readPackageJson(extensionRoot);
  const themesOnDisk = readImportedThemesFromDisk(extensionRoot);

  if (!pkg.contributes) {
    pkg.contributes = {};
  }

  if (!Array.isArray(pkg.contributes.themes)) {
    pkg.contributes.themes = [];
  }

  const existing: any[] = pkg.contributes.themes;

  const filtered = existing.filter(
    entry => entry && entry._sh1ffyTag !== SH1FFY_THEME_TAG,
  );

  const sh1ffyEntries = themesOnDisk.map(theme => ({
    id: theme.id,
    label: theme.label,
    uiTheme: theme.uiTheme,
    path: `./${theme.path}`,
    _sh1ffyTag: SH1FFY_THEME_TAG,
  }));

  pkg.contributes.themes = [...filtered, ...sh1ffyEntries];

  writePackageJson(extensionRoot, pkg);
}

/* -------------------------------------------------------------------------- */
/*                               Utility helpers                              */
/* -------------------------------------------------------------------------- */

/**
 * Converts an arbitrary string into a safe, lowercase identifier.
 */
function toSafeId(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Naive but practical JSONC comment stripper:
 *  - Removes // line comments and /* block comments *\/
 *  - Preserves content inside string literals.
 */
function stripJsonComments(input: string): string {
  let output = "";
  let inString = false;
  let stringChar: '"' | "'" | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = i + 1 < input.length ? input[i + 1] : "";

    if (inLineComment) {
      if (ch === "\n" || ch === "\r") {
        inLineComment = false;
        output += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++; // skip '/'
      }
      continue;
    }

    if (!inString) {
      if (ch === "/" && next === "/") {
        inLineComment = true;
        i++; // skip second '/'
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        i++; // skip '*'
        continue;
      }
    }

    if (ch === '"' || ch === "'") {
      if (!inString) {
        inString = true;
        stringChar = ch as '"' | "'";
      } else if (stringChar === ch) {
        let backslashes = 0;
        let j = i - 1;
        while (j >= 0 && input[j] === "\\") {
          backslashes++;
          j--;
        }
        if (backslashes % 2 === 0) {
          inString = false;
          stringChar = null;
        }
      }
    }

    output += ch;
  }

  return output;
}

/**
 * Sets the current color theme by id using configuration.
 * Note: we pass the theme label here, which VS Code resolves as a theme id.
 */
async function setColorThemeById(themeId: string): Promise<void> {
  await vscode.workspace
    .getConfiguration("workbench")
    .update(
      "colorTheme",
      themeId,
      vscode.ConfigurationTarget.Global,
    );
}

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
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
}