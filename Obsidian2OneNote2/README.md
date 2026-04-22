# Obsidian2OneNote2

Local preview tool for turning Obsidian notes into a richer OneNote paste.

## What it does

- Shows a live Markdown preview in the browser
- Copies both `text/html` and `text/plain` for OneNote paste
- Resolves Obsidian-style embeds such as `![[image.png]]` after a vault is selected
- Opens a note from the selected vault so relative image paths can resolve
- Converts common Obsidian-specific markup such as wikilinks, callouts, highlights, and task lists

## Start

```powershell
python server.py
```

If the browser does not open automatically:

```powershell
python server.py --no-browser
```

Then open the printed URL in a browser.

## Recommended workflow

1. Click `Select Vault` and enter the vault folder path
2. Click `Open Vault Note` and enter the note path relative to that vault
3. Check the preview on the right
4. Click `Copy for OneNote`
5. Paste into OneNote

## Fallback workflow

If you only need text and do not need local image resolution:

1. Open the app
2. Paste Markdown into the left pane or use `Open .md`
3. Click `Copy for OneNote`

## Notes

- Local image embeds are resolved through the selected vault
- Images are converted to data URLs before copy so the pasted HTML can carry the image content
- Relative paths work best when the note is loaded through `Open Vault Note`
- `Select Vault` and `Open Vault Note` now use path prompts instead of native file dialogs
- Mermaid and MathJax are not rendered yet
- The rich clipboard path works best in Chromium-based browsers
