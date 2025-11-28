# Sh1ffy – Workbench Font & Theme Toolkit for VS Code

Sh1ffy is a VS Code extension that lets you:

- Use a custom font for the **workbench UI** (title bar, side bar, settings, extensions view, etc.).
- Import your own **color themes** directly from JSON / JSONC files, without publishing them anywhere.
- Manage Sh1ffy themes and fonts via simple menu commands.

It is designed to be lightweight, explicit, and fully under your control.

![Sh1ffy UI screenshot](./assets/screenshot.png)

---

## Important Notes

- **Sh1ffy does not change the editor text font.**  
  Your editor font (code font) remains controlled by VS Code’s normal setting:
  - `Editor: Font Family` → `editor.fontFamily`

- **Sh1ffy only affects the workbench UI font** via:
  - `sh1ffy.workbenchFont` (global setting), and
  - A small CSS snippet injected into VS Code’s `workbench.html`.

- **Sh1ffy does not upload or publish your themes.**  
  It simply:
  - Reads your local `.json` / `.jsonc` theme files,
  - Writes cleaned `.json` files into the extension’s `themes/` folder,
  - Updates `package.json` so VS Code treats them as first-class color themes.

You can keep fully private themes on your machine without pushing them to marketplaces or sites like [themes.vscode.one](https://themes.vscode.one/).

---

## Features Overview

### 1. Workbench Font Manager

Command: **`[ Sh1ffy ] → Workbench Font Actions`**

Actions:

- **Set WorkBench Font**  
  Prompt for a font family name (e.g. `JetBrains Mono`, `Cascadia Code`) and store it in:
  - `sh1ffy.workbenchFont`

- **Enable WorkBench Font**  
  Injects a `<style id="sh1ffy-tweaks">…</style>` block into `workbench.html` so the workbench UI uses your configured font.  
  Prompts to **Reload Window**.

- **Disable WorkBench Font**  
  Removes Sh1ffy’s style block from `workbench.html`.  
  Prompts to **Reload Window**.

- **Reload Font Configuration**  
  Rebuilds the Sh1ffy style block from the current `sh1ffy.workbenchFont` and writes it to `workbench.html`, then prompts to **Reload Window**.

- **Reset to Defaults**  
  Clears `sh1ffy.workbenchFont` and removes the Sh1ffy `<style>` block from `workbench.html`, restoring the default UI font (after reload).

> Sh1ffy **never** writes to the editor font setting. Use the normal VS Code Settings UI for `editor.fontFamily`.

---

### 2. Dynamic Theme Manager

Command: **`[ Sh1ffy ] → Color Theme Actions`**

Actions:

- **Import Theme(s)**  
  - Accepts one or more `.json` or `.jsonc` theme files.
  - Strips comments from `.jsonc`, validates as JSON, and normalizes:
    - Ensures a `name` field exists.
    - Prefixes the name with `sh1ffy • `, so you see it clearly in the Color Theme picker.
  - Writes `.json` theme files into the extension’s `themes/` folder:
    - `.json` → copied as-is (after normalization).
    - `.jsonc` → stored as `.json` with the same basename.
  - Updates `package.json` → `contributes.themes`:
    - Adds/updates Sh1ffy-managed theme entries.
    - Tags them internally with `_sh1ffyTag: "sh1ffy-managed"` so they can be safely replaced.
  - If a theme with the same Sh1ffy label already exists, you’ll be asked to **Overwrite** or **Skip**.
  - For a single import, you’ll be offered:
    - **Apply now** → set that theme as `workbench.colorTheme` and then reload.
    - **Reload Window** → reload so the theme becomes selectable.

- **Remove Theme(s)**  
  - Lists imported Sh1ffy themes (label, id, type, relative path).
  - Lets you select and delete themes from the `themes/` folder.
  - Regenerates `contributes.themes` accordingly.
  - Prompts to **Reload Window** to refresh the Color Theme list.

- **List Themes**  
  - Read-only QuickPick of Sh1ffy themes, showing:
    - Label (with `sh1ffy •` prefix),
    - Type: `Dark`, `Light`, or `High Contrast`,
    - Internal id (`sh1ffy.some-theme`),
    - Relative path under `themes/`.

- **Repair Theme Contributions**  
  - Re-scans the `themes/` folder.
  - Regenerates only Sh1ffy-managed entries in `package.json`:
    - Removes stale `_sh1ffyTag: "sh1ffy-managed"` entries.
    - Recreates them from the current disk state.
  - Prompts to **Reload Window**.

- **Restore package.json Backup**  
  - When Sh1ffy first modifies `package.json`, it creates a one-time backup:
    - `package.json.sh1ffy.bak`
  - This action restores that backup and prompts to **Reload Window**.

> Sh1ffy’s theme manager is meant for personal, local workflows:
> - Import and experiment with themes instantly.
> - No publishing, no uploads, no external services.

---

## How to Use

1. **Install Sh1ffy** from the VS Code marketplace (or load it from your local `.vsix`).
2. Open the **Command Palette** (`Ctrl+Shift+P` / `Cmd+Shift+P`).
3. Run one of the Sh1ffy entry commands:
   - `[ Sh1ffy ] → Workbench Font Actions`
   - `[ Sh1ffy ] → Color Theme Actions`

From there, follow the on-screen QuickPick menus and dialogs.

---

## Known Limitations & Safety

- **Editing `workbench.html` and `package.json`** is powerful but low-level:
  - Sh1ffy keeps changes scoped and reversible.
  - The font manager has a **Reset to Defaults** option.
  - The theme manager can **Repair Theme Contributions** and **Restore package.json Backup**.

- **Read-only / sandboxed installations**:  
  If VS Code is installed in a location where the extension cannot modify `workbench.html` or `package.json`, some actions may fail. In that case, Sh1ffy will:
  - Show errors in notifications.
  - Log details to the extension host log.

- **Editor themes vs. workbench fonts**:  
  Color themes apply to the entire editor UI, but the **code editor font** remains managed by `editor.fontFamily`. Sh1ffy intentionally does not override that setting.

---

## Why Sh1ffy?

- You want a **custom workbench font** without editing internal files by hand.
- You maintain your own **private themes** as JSON/JSONC files and:
  - Don’t want to publish them.
  - Don’t want to depend on external generators or upload tools.
- You prefer explicit, menu-driven control over:
  - When fonts are applied.
  - Which themes are available.
  - How contributions are repaired or reset.

Sh1ffy aims to be a small, focused toolkit that gives you tight control over workbench fonts and themes, without taking over your entire VS Code configuration.