import { Action, ActionPanel, Detail, Icon, Toast, environment, open, showToast } from "@raycast/api";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { useEffect, useState } from "react";

const execFileAsync = promisify(execFile);

const DRAFTS_TEMPLATES_DIR = path.join(
  os.homedir(),
  "Library",
  "Mobile Documents",
  "iCloud~com~agiletortoise~Drafts5",
  "Documents",
  "Library",
  "Templates",
  "agent-skills",
);

const DRAFTS_SCRIPTS_DIR = path.join(
  os.homedir(),
  "Library",
  "Mobile Documents",
  "iCloud~com~agiletortoise~Drafts5",
  "Documents",
  "Library",
  "Scripts",
  "agent-skills",
);

const GENERATED_DIR = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "raycast-agent-skills",
  "drafts-generated",
);

type SyncState =
  | { status: "running" }
  | { status: "success"; output: string; scriptPath: string; generatedDir: string }
  | { status: "failure"; output: string; scriptPath?: string; generatedDir?: string };

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

async function resolveScriptPath() {
  const candidates = [
    path.join(process.cwd(), "scripts", "sync-drafts-skills.mjs"),
    path.resolve(environment.assetsPath, "..", "scripts", "sync-drafts-skills.mjs"),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }

  throw new Error(`Could not find sync-drafts-skills.mjs. Checked:\n${candidates.join("\n")}`);
}

function buildMarkdown(state: SyncState) {
  if (state.status === "running") {
    return [
      "# Syncing Drafts Skills",
      "",
      "Refreshing the synced Drafts templates and runtime scripts from `~/Skills`.",
    ].join("\n");
  }

  if (state.status === "success") {
    return [
      "# Drafts Skills Synced",
      "",
      `Script: \`${state.scriptPath}\``,
      `Generated: \`${state.generatedDir}\``,
      "",
      "```text",
      state.output.trim() || "Sync completed successfully.",
      "```",
    ].join("\n");
  }

  return [
    "# Sync Failed",
    "",
    state.scriptPath ? `Script: \`${state.scriptPath}\`` : "The sync script could not be located or executed.",
    state.generatedDir ? `Generated: \`${state.generatedDir}\`` : "",
    "",
    "```text",
    state.output.trim() || "No additional output.",
    "```",
  ].join("\n");
}

export default function SyncDraftsSkills() {
  const [state, setState] = useState<SyncState>({ status: "running" });
  const generatedDir = state.status !== "running" ? state.generatedDir : undefined;

  async function runSync() {
    setState({ status: "running" });
    let scriptPath: string | undefined;
    let generatedDir: string | undefined;

    try {
      scriptPath = await resolveScriptPath();
      generatedDir = GENERATED_DIR;
      const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath], {
        cwd: path.resolve(path.dirname(scriptPath), ".."),
      });
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();

      setState({
        status: "success",
        output,
        scriptPath,
        generatedDir,
      });

      await showToast({
        style: Toast.Style.Success,
        title: "Drafts skills synced",
      });
    } catch (error) {
      const detail = error instanceof Error ? error.stack || error.message : getErrorMessage(error);

      setState({
        status: "failure",
        output: detail,
        scriptPath,
        generatedDir,
      });

      await showToast({
        style: Toast.Style.Failure,
        title: "Drafts sync failed",
        message: getErrorMessage(error),
      });
    }
  }

  useEffect(() => {
    runSync();
  }, []);

  return (
    <Detail
      isLoading={state.status === "running"}
      navigationTitle="Sync Drafts Skills"
      markdown={buildMarkdown(state)}
      actions={
        <ActionPanel>
          <Action title="Run Sync Again" icon={Icon.ArrowClockwise} onAction={runSync} />
          {generatedDir ? (
            <Action title="Open Generated Files" onAction={() => open(generatedDir)} shortcut={{ modifiers: ["cmd"], key: "g" }} />
          ) : null}
          <Action title="Open Drafts Templates" onAction={() => open(DRAFTS_TEMPLATES_DIR)} shortcut={{ modifiers: ["cmd"], key: "t" }} />
          <Action title="Open Drafts Scripts" onAction={() => open(DRAFTS_SCRIPTS_DIR)} shortcut={{ modifiers: ["cmd"], key: "s" }} />
        </ActionPanel>
      }
    />
  );
}
