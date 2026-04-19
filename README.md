# Agent Skills for Raycast

Search your local agent skills or type a free-form prompt, then apply it to the text currently in your clipboard from [Raycast](https://raycast.com), the macOS productivity app.

This extension scans `~/.agents/skills` for `SKILL.md` files, lets you fuzzy-search them in Raycast, shows the selected skill's description, and runs either the chosen skill or your current search text against clipboard text using Raycast AI.

## Features

- Recursively discovers local skills from `~/.agents/skills`
- Fuzzy-searches skills by name, folder, and description
- Shows the selected skill's description in a side panel
- Runs the selected skill against your clipboard contents
- Falls back to running your search text as a free-form prompt when no skill matches
- Copies the generated result back to the clipboard
- Supports per-skill model selection via `SKILL.md` frontmatter

## Requirements

- [Raycast](https://raycast.com) for macOS with AI access enabled
- A local skills directory at `~/.agents/skills`
- Skills stored as folders containing a `SKILL.md` file

## Skill Format

The extension reads simple frontmatter from each `SKILL.md` file:

```yaml path=null start=null
---
name: summarize
description: Summarize the input into the key points
model: OpenAI_GPT-5.4_mini
---
```

Supported frontmatter fields:

- `name`: display name in Raycast
- `description`: short description shown in the detail pane
- `model`: optional Raycast AI model enum key or model value passed to `AI.ask`

The rest of the file is treated as the skill instructions. The extension appends the clipboard content under an `INPUT:` section before sending the prompt to Raycast AI.

## Development

Install dependencies:

```bash path=null start=null
npm install
```

Run the extension in development mode:

```bash path=null start=null
npm run dev
```

Build the extension:

```bash path=null start=null
npm run build
```

## Drafts Integration

This repo also includes a Drafts sync script that turns your `~/Skills` directory into a Drafts-friendly skill picker for macOS and iOS.

Run:

```bash path=null start=null
npm run sync:drafts
```

Or run the `Sync Drafts Skills` command in Raycast to trigger the same sync without leaving Raycast.

That script:

- Reads every `SKILL.md` under `~/Skills`
- Generates a searchable HTML picker with autocomplete-like suggestions
- Writes a slim skill index and per-skill instruction files into Drafts' iCloud templates folder
- Writes the action runtime scripts into Drafts' iCloud scripts folder
- Generates the one-time bootstrap script-step files you need to assemble the action

Generated files are written to a local-only folder at `~/Library/Application Support/raycast-agent-skills/drafts-generated`, including `INSTALL_DRAFTS_ACTION.md` with the exact 3-step Drafts action setup. They are not committed to the repo.

The Drafts action uses the current text selection in the editor, falls back to free-form prompts if the typed value is not an exact skill match, and sends the request through Drafts' built-in `AnthropicAI` helper.
If no text is selected, it applies to the whole draft and replaces the full note body with the result.
After the initial Drafts action setup, re-running `npm run sync:drafts` updates the synced runtime scripts automatically, so you should not need to paste the action JavaScript again.

## Notes

- If a skill does not specify `model`, Raycast uses its default model selection for `AI.ask`
- If the clipboard is empty, the command will refuse to run
- If Raycast AI access is unavailable, the command shows an error toast instead of executing
- When no skill matches your search, press Enter to run the search text itself as a prompt on the clipboard text

## License

MIT
