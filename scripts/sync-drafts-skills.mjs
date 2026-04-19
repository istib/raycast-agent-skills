import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_SKILLS_ROOT = path.join(os.homedir(), "Skills");
const DEFAULT_OUTPUT_DIR = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "raycast-agent-skills",
  "drafts-generated",
);
const DEFAULT_DRAFTS_TEMPLATES_DIR = path.join(
  os.homedir(),
  "Library",
  "Mobile Documents",
  "iCloud~com~agiletortoise~Drafts5",
  "Documents",
  "Library",
  "Templates",
  "agent-skills",
);
const DEFAULT_DRAFTS_SCRIPTS_DIR = path.join(
  os.homedir(),
  "Library",
  "Mobile Documents",
  "iCloud~com~agiletortoise~Drafts5",
  "Documents",
  "Library",
  "Scripts",
  "agent-skills",
);
const DEFAULT_MODEL = "claude-haiku-4-5";
const DEFAULT_MAX_TOKENS = 4096;

function parseArgs(argv) {
  const options = {
    skillsRoot: DEFAULT_SKILLS_ROOT,
    outputDir: DEFAULT_OUTPUT_DIR,
    draftsTemplatesDir: DEFAULT_DRAFTS_TEMPLATES_DIR,
    draftsScriptsDir: DEFAULT_DRAFTS_SCRIPTS_DIR,
    model: DEFAULT_MODEL,
    maxTokens: DEFAULT_MAX_TOKENS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--skills-root" && next) {
      options.skillsRoot = path.resolve(next);
      i += 1;
      continue;
    }

    if (arg === "--output-dir" && next) {
      options.outputDir = path.resolve(next);
      i += 1;
      continue;
    }

    if (arg === "--drafts-templates-dir" && next) {
      options.draftsTemplatesDir = path.resolve(next);
      i += 1;
      continue;
    }

    if (arg === "--drafts-scripts-dir" && next) {
      options.draftsScriptsDir = path.resolve(next);
      i += 1;
      continue;
    }

    if (arg === "--model" && next) {
      options.model = next.trim();
      i += 1;
      continue;
    }

    if (arg === "--max-tokens" && next) {
      options.maxTokens = Number.parseInt(next, 10);
      i += 1;
      continue;
    }

    if (arg === "--help") {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/sync-drafts-skills.mjs [options]

Options:
  --skills-root <path>           Source skills directory (default: ~/Skills)
  --output-dir <path>            Local output directory (default: ~/Library/Application Support/raycast-agent-skills/drafts-generated)
  --drafts-templates-dir <path>  Drafts iCloud template folder to update
  --drafts-scripts-dir <path>    Drafts iCloud scripts folder to update
  --model <name>                 Anthropic model alias for Drafts action
  --max-tokens <n>               max_tokens value for Anthropic quickPrompt
  --help                         Show this message
`);
}

function normalizeFrontmatterValue(value) {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: markdown };
  }

  const [, rawFrontmatter, body] = match;
  const frontmatter = {};

  for (const line of rawFrontmatter.split("\n")) {
    const keyValueMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyValueMatch) {
      continue;
    }

    const [, key, value] = keyValueMatch;
    frontmatter[key] = normalizeFrontmatterValue(value);
  }

  return { frontmatter, body };
}

async function findSkillFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const skillFiles = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);

    if (entry.isSymbolicLink()) {
      const stat = await fs.stat(entryPath);
      if (!stat.isDirectory()) {
        continue;
      }
    } else if (!entry.isDirectory()) {
      continue;
    }

    const skillFilePath = path.join(entryPath, "SKILL.md");
    try {
      await fs.access(skillFilePath);
      skillFiles.push(skillFilePath);
      continue;
    } catch {}

    skillFiles.push(...(await findSkillFiles(entryPath)));
  }

  return skillFiles;
}

async function loadSkills(skillsRoot) {
  const skillFiles = await findSkillFiles(skillsRoot);

  const skills = await Promise.all(
    skillFiles.map(async (filePath) => {
      const markdown = await fs.readFile(filePath, "utf8");
      const { frontmatter, body } = parseFrontmatter(markdown);
      const folderName = path.basename(path.dirname(filePath));
      const title = frontmatter.name?.trim() || folderName;
      const description = frontmatter.description?.trim() || "No description provided.";
      const key = buildSkillKey(filePath, folderName, title);

      return {
        key,
        title,
        folderName,
        description,
        instructions: body.trim(),
        instructionFile: `${key}.txt`,
      };
    }),
  );

  return skills.sort((a, b) => {
    const titleComparison = a.title.localeCompare(b.title);
    return titleComparison !== 0 ? titleComparison : a.folderName.localeCompare(b.folderName);
  });
}

function jsonForHtml(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "skill";
}

function buildSkillKey(filePath, folderName, title) {
  const base = slugify(folderName || title);
  const hash = crypto.createHash("sha1").update(filePath).digest("hex").slice(0, 8);
  return `${base}-${hash}`;
}

function escapeForTemplateLiteral(value) {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function buildPickerHtml(skills) {
  const pickerSkills = skills.map(({ key, title, folderName }) => ({
    key,
    title,
    folderName,
  }));
  const skillsJson = jsonForHtml(pickerSkills);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Apply Agent Skill</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #0f172a;
      --panel: rgba(15, 23, 42, 0.94);
      --line: rgba(148, 163, 184, 0.22);
      --text: #e2e8f0;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --accent-soft: rgba(56, 189, 248, 0.14);
    }

    @media (prefers-color-scheme: light) {
      :root {
        --bg: #e2e8f0;
        --panel: rgba(255, 255, 255, 0.96);
        --line: rgba(15, 23, 42, 0.08);
        --text: #0f172a;
        --muted: #475569;
        --accent: #0284c7;
        --accent-soft: rgba(2, 132, 199, 0.1);
      }
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font: 15px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
      color: var(--text);
      background: var(--bg);
      padding: 16px;
    }

    .shell {
      max-width: 680px;
      margin: 0 auto;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 18px;
    }

    label {
      display: block;
      margin-bottom: 8px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }

    input[type="text"] {
      width: 100%;
      padding: 14px 15px;
      border-radius: 12px;
      border: 1px solid var(--line);
      background: transparent;
      color: var(--text);
      font: inherit;
      outline: none;
    }

    input[type="text"]:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-soft);
    }

    .copy {
      margin: 0 0 12px;
      color: var(--muted);
    }

    .hint {
      margin-top: 8px;
      color: var(--muted);
      font-size: 13px;
    }

    .matches {
      margin-top: 14px;
      display: grid;
      gap: 8px;
      max-height: 280px;
      overflow: auto;
      padding-right: 2px;
    }

    .match {
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px 12px;
      cursor: pointer;
      transition: border-color 120ms ease, background 120ms ease;
    }

    .match:hover,
    .match.active {
      border-color: var(--accent);
      background: var(--accent-soft);
    }

    .match-title {
      font-weight: 700;
    }

    .match-meta {
      margin-top: 4px;
      color: var(--muted);
      font-size: 12px;
    }

    .free-prompt {
      border-style: dashed;
    }

    .keyhint {
      margin-top: 14px;
      color: var(--muted);
      font-size: 12px;
    }

    @media (max-width: 760px) {
      body { padding: 12px; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <p class="copy">Type a skill name or a free-form prompt. Exact matches use the synced skill; anything else is sent as-is.</p>
    <label for="query">Skill Or Prompt</label>
    <input id="query" type="text" placeholder="summarize, translate-to-french, rewrite this more sharply..." autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" autofocus />
    <div class="hint">If no text is selected, the action will use the whole draft.</div>
    <div id="matches" class="matches"></div>
    <div class="keyhint">Press Enter to choose the only remaining match, or use the free-form prompt when no skills match. Press Escape to cancel.</div>
  </div>

  <script id="skills-data" type="application/json">${skillsJson}</script>
  <script>
    const skills = JSON.parse(document.getElementById("skills-data").textContent);
    const input = document.getElementById("query");
    const matchesEl = document.getElementById("matches");
    let renderedChoices = [];
    let highlightedIndex = 0;

    const normalize = (value) => value.trim().toLowerCase();

    const scoreSkill = (skill, query) => {
      if (!query) {
        return 1;
      }

      const normalizedQuery = normalize(query);
      const fields = [skill.title, skill.folderName];
      let score = 0;

      for (const field of fields) {
        const value = normalize(field);
        if (value === normalizedQuery) {
          score = Math.max(score, 100);
        } else if (value.startsWith(normalizedQuery)) {
          score = Math.max(score, 75);
        } else if (value.includes(normalizedQuery)) {
          score = Math.max(score, 40);
        }
      }

      return score;
    };

    const findExactSkill = (query) => {
      const normalizedQuery = normalize(query);
      return skills.find((skill) => {
        return normalize(skill.title) === normalizedQuery || normalize(skill.folderName) === normalizedQuery;
      }) || null;
    };

    const getMatches = (query) => {
      return skills
        .map((skill) => ({ skill, score: scoreSkill(skill, query) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.skill.title.localeCompare(b.skill.title))
        .slice(0, 8)
        .map((entry) => entry.skill);
    };

    const freePromptChoice = (query) => ({
      type: "prompt",
      value: query.trim(),
      title: query.trim(),
      meta: "Use as free-form prompt",
    });

    const skillChoice = (skill) => ({
      type: "skill",
      value: skill.title,
      title: skill.title,
      meta: skill.folderName,
    });

    const activateChoice = (choice) => {
      if (!choice) {
        return;
      }

      Drafts.send("agentSkillInput", choice.value);
      Drafts.continue();
    };

    const renderMatches = () => {
      const query = input.value;
      const trimmedQuery = query.trim();
      const matches = getMatches(query).map(skillChoice);

      renderedChoices = matches;

      if (matches.length === 0) {
        renderedChoices = trimmedQuery ? [freePromptChoice(query)] : [];
      }

      if (renderedChoices.length === 0) {
        highlightedIndex = 0;
        matchesEl.innerHTML = "";
        return;
      }

      highlightedIndex = Math.max(0, Math.min(highlightedIndex, renderedChoices.length - 1));

      matchesEl.innerHTML = renderedChoices.map((choice, index) => {
        const classes = ["match"];
        if (index === highlightedIndex) {
          classes.push("active");
        }
        if (choice.type === "prompt") {
          classes.push("free-prompt");
        }

        return \`
          <div class="\${classes.join(" ")}" data-index="\${index}">
            <div class="match-title">\${choice.title}</div>
            <div class="match-meta">\${choice.meta}</div>
          </div>
        \`;
      }).join("");

      requestAnimationFrame(scrollActiveChoiceIntoView);
    };

    const moveHighlight = (delta) => {
      if (renderedChoices.length === 0) {
        return;
      }

      highlightedIndex = (highlightedIndex + delta + renderedChoices.length) % renderedChoices.length;
      renderMatches();
    };

    const scrollActiveChoiceIntoView = () => {
      const active = matchesEl.querySelector(".match.active");
      if (!active) {
        return;
      }

      active.scrollIntoView({
        block: "nearest",
      });
    };

    input.addEventListener("input", () => {
      highlightedIndex = 0;
      renderMatches();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveHighlight(1);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveHighlight(-1);
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        if (renderedChoices.length === 1) {
          activateChoice(renderedChoices[0]);
          return;
        }

        if (renderedChoices[highlightedIndex]) {
          activateChoice(renderedChoices[highlightedIndex]);
        }
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        Drafts.cancel();
      }
    });

    matchesEl.addEventListener("click", (event) => {
      const card = event.target.closest(".match");
      if (!card) {
        return;
      }

      const index = Number(card.dataset.index);
      const choice = renderedChoices[index];
      if (!choice) {
        return;
      }

      highlightedIndex = index;
      activateChoice(choice);
    });

    const focusInput = () => {
      input.focus({ preventScroll: true });
      input.click();
      input.setSelectionRange(input.value.length, input.value.length);
    };

    window.addEventListener("load", focusInput);
    window.addEventListener("pageshow", focusInput);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        focusInput();
      }
    });

    focusInput();
    requestAnimationFrame(focusInput);
    setTimeout(focusInput, 0);
    setTimeout(focusInput, 150);
    setTimeout(focusInput, 400);
    renderMatches();
  </script>
</body>
</html>
`;
}

function buildStepOneRuntimeScript() {
  return `const range = editor.getSelectedRange();
const locationInRange = Array.isArray(range) ? range[0] : 0;
const lengthInRange = Array.isArray(range) ? range[1] : 0;
let inputText = editor.getSelectedText();
let location = locationInRange;
let length = lengthInRange;

if (!inputText || length === 0) {
  inputText = editor.getText();
  location = 0;
  length = inputText.length;
}

if (!inputText || !inputText.trim()) {
  context.cancel("The current draft is empty.");
}

draft.setTemplateTag("agent_skill_selection_text", inputText);
draft.setTemplateTag("agent_skill_selection_location", String(location));
draft.setTemplateTag("agent_skill_selection_length", String(length));
`;
}

function buildStepThreeRuntimeScript({ model, maxTokens }) {
  return `const MODEL = "${escapeForTemplateLiteral(model)}";
const MAX_TOKENS = ${maxTokens};
const SKILLS_INDEX_PATH = "/Library/Templates/agent-skills/skills-index.json";
const SKILLS_DIR_PATH = "/Library/Templates/agent-skills/skills";

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function injectInput(instructions, input) {
  const outputRequirements = [
    "# FINAL OUTPUT REQUIREMENTS:",
    "",
    "- Return only the final transformed text.",
    "- Do not include headings, labels, or preamble text.",
    "- Do not write things like # OUTPUT, Output:, or explanatory notes.",
  ].join("\\n");

  if (/INPUT:\\s*$/.test(instructions)) {
    return \`\${instructions.replace(/INPUT:\\s*$/, \`INPUT:\\n\${input}\`)}\\n\\n\${outputRequirements}\`;
  }

  return \`\${instructions}\\n\\n# INPUT:\\n\\n\${input}\\n\\n\${outputRequirements}\`;
}

function buildFreeFormPrompt(request, input) {
  const instructions = [
    "You must apply the user's request to the text in INPUT.",
    "Do not answer the request abstractly.",
    "Do not describe what you would change.",
    "Return only a rewritten or transformed version of INPUT.",
    "If the request is ambiguous, make the smallest reasonable transformation that satisfies it.",
    "",
    "# USER REQUEST:",
    String(request || "").trim(),
    "",
    "Treat INPUT as the source text to edit.",
  ].join("\\n");

  return injectInput(instructions, input);
}

function loadSkillsIndex() {
  const fm = FileManager.createCloud();
  const raw = fm.readString(SKILLS_INDEX_PATH);

  if (!raw) {
    throw new Error(\`Could not read skills index at \${SKILLS_INDEX_PATH}.\`);
  }

  return JSON.parse(raw);
}

function loadSkillInstructions(instructionFile) {
  const fm = FileManager.createCloud();
  const skillPath = \`\${SKILLS_DIR_PATH}/\${instructionFile}\`;
  const raw = fm.readString(skillPath);

  if (!raw) {
    throw new Error(\`Could not read skill instructions at \${skillPath}.\`);
  }

  return raw;
}

function findSkill(skills, query) {
  const normalizedQuery = normalize(query);
  return skills.find((skill) => {
    return normalize(skill.title) === normalizedQuery || normalize(skill.folderName) === normalizedQuery;
  });
}

try {
  const selection = draft.getTemplateTag("agent_skill_selection_text") || "";
  const location = Number.parseInt(draft.getTemplateTag("agent_skill_selection_location") || "0", 10);
  const length = Number.parseInt(draft.getTemplateTag("agent_skill_selection_length") || "0", 10);
  const query = String(context.previewValues["agentSkillInput"] || "").trim();

  if (!selection.trim()) {
    context.cancel("Select some text first.");
  }

  if (!query) {
    context.cancel("No skill or prompt provided.");
  }

  const skills = loadSkillsIndex();
  const matchedSkill = findSkill(skills, query);
  const prompt = matchedSkill
    ? injectInput(loadSkillInstructions(matchedSkill.instructionFile), selection)
    : buildFreeFormPrompt(query, selection);

  const ai = new AnthropicAI();
  const result = ai.quickPrompt(prompt, {
    model: MODEL,
    max_tokens: MAX_TOKENS,
  });

  if (!result || !String(result).trim()) {
    throw new Error(ai.lastError || "Claude returned an empty response.");
  }

  editor.setTextInRange(location, length, result);
  editor.setSelectedRange(location, result.length);
  editor.activate();
} catch (error) {
  console.log(error && error.stack ? error.stack : error);
  context.fail(error instanceof Error ? error.message : String(error));
}
`;
}

function buildBootstrapScript(relativePath) {
  return `require("${relativePath}");
`;
}

function buildInstallGuide({ model }) {
  return `# Drafts Agent Skills Setup

The sync script generated the files below:

- \`drafts-agent-skill-step1.js\`
- \`drafts-agent-skill-step3.js\`
- \`agent-skills/agent-skill-step1-runtime.js\`
- \`agent-skills/agent-skill-step3-runtime.js\`
- \`agent-skills/skill-picker.html\`
- \`agent-skills/skills-index.json\`
- \`agent-skills/skills/*.txt\`

## What It Does

- Uses the current text selection in Drafts as input.
- Falls back to the full draft if no text is selected.
- Shows a simple HTML picker with filtered skill matches.
- Loads only the slim skill index up front; matched skill instructions are loaded on demand.
- Falls back to a free-form prompt when the typed text is not an exact skill match.
- Sends the prompt to Anthropic via Drafts' built-in \`AnthropicAI\` helper.
- Replaces the selected text, or the whole draft when nothing was selected, with the result.
- Uses Enter to choose the only remaining option and Escape to cancel.

## Create The Drafts Action

Create a new Drafts action with these three steps:

1. Script step
   Paste the contents of \`drafts-agent-skill-step1.js\`

2. HTML Preview step
   Template:
   \`[[template|agent-skills/skill-picker.html]]\`

   Hide interface:
   \`On\`

3. Script step
   Paste the contents of \`drafts-agent-skill-step3.js\`

After that one-time setup, future \`npm run sync:drafts\` runs update the real action code in Drafts' synced \`Library/Scripts/agent-skills/\` folder automatically. You should not need to re-paste the script steps unless you want to change the bootstrap itself.

## Notes

- The generated action defaults to model \`${model}\`.
- If you want the heavyweight model instead, edit the \`MODEL\` constant in step 3 to \`claude-opus-4-7\`.
- The HTML template, \`skills-index.json\`, and per-skill instruction files are copied into Drafts' iCloud templates folder, and the runtime scripts are copied into Drafts' iCloud scripts folder, so the same action can work on macOS and iOS once Drafts sync catches up.
- Drafts stores Anthropic credentials in its credentials system; the first run will prompt for an API key if needed.
`;
}

async function ensureDirectory(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function resetDirectory(dir) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

async function writeFile(targetPath, content) {
  await ensureDirectory(path.dirname(targetPath));
  await fs.writeFile(targetPath, content, "utf8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const skills = await loadSkills(options.skillsRoot);

  if (skills.length === 0) {
    throw new Error(`No SKILL.md files found under ${options.skillsRoot}`);
  }

  const repoTemplatesDir = path.join(options.outputDir, "agent-skills");
  const repoScriptsDir = path.join(options.outputDir, "agent-skills");
  const repoInstructionDir = path.join(repoTemplatesDir, "skills");
  const draftsInstructionDir = path.join(options.draftsTemplatesDir, "skills");
  const pickerHtml = buildPickerHtml(skills);
  const skillsIndex = skills.map(({ key, title, folderName, instructionFile }) => ({
    key,
    title,
    folderName,
    instructionFile,
  }));
  const skillsIndexJson = `${JSON.stringify(skillsIndex, null, 2)}\n`;
  const stepOneRuntimeScript = buildStepOneRuntimeScript();
  const stepThreeRuntimeScript = buildStepThreeRuntimeScript({
    model: options.model,
    maxTokens: options.maxTokens,
  });
  const stepOneBootstrapScript = buildBootstrapScript("agent-skills/agent-skill-step1-runtime.js");
  const stepThreeBootstrapScript = buildBootstrapScript("agent-skills/agent-skill-step3-runtime.js");
  const installGuide = buildInstallGuide({ model: options.model });

  await Promise.all([
    resetDirectory(repoInstructionDir),
    resetDirectory(draftsInstructionDir),
    fs.rm(path.join(repoTemplatesDir, "skills.json"), { force: true }),
    fs.rm(path.join(options.draftsTemplatesDir, "skills.json"), { force: true }),
  ]);

  await Promise.all([
    writeFile(path.join(repoTemplatesDir, "skill-picker.html"), pickerHtml),
    writeFile(path.join(repoTemplatesDir, "skills-index.json"), skillsIndexJson),
    writeFile(path.join(repoScriptsDir, "agent-skill-step1-runtime.js"), stepOneRuntimeScript),
    writeFile(path.join(repoScriptsDir, "agent-skill-step3-runtime.js"), stepThreeRuntimeScript),
    writeFile(path.join(options.outputDir, "drafts-agent-skill-step1.js"), stepOneBootstrapScript),
    writeFile(path.join(options.outputDir, "drafts-agent-skill-step3.js"), stepThreeBootstrapScript),
    writeFile(path.join(options.outputDir, "INSTALL_DRAFTS_ACTION.md"), installGuide),
    writeFile(path.join(options.draftsTemplatesDir, "skill-picker.html"), pickerHtml),
    writeFile(path.join(options.draftsTemplatesDir, "skills-index.json"), skillsIndexJson),
    writeFile(path.join(options.draftsScriptsDir, "agent-skill-step1-runtime.js"), stepOneRuntimeScript),
    writeFile(path.join(options.draftsScriptsDir, "agent-skill-step3-runtime.js"), stepThreeRuntimeScript),
    ...skills.flatMap((skill) => [
      {
        targetPath: path.join(repoInstructionDir, skill.instructionFile),
        content: `${skill.instructions}\n`,
      },
      {
        targetPath: path.join(draftsInstructionDir, skill.instructionFile),
        content: `${skill.instructions}\n`,
      },
    ]).map(({ targetPath, content }) => writeFile(targetPath, content)),
  ]);

  console.log(`Synced ${skills.length} skills from ${options.skillsRoot}`);
  console.log(`Generated Drafts assets in ${options.outputDir}`);
  console.log(`Updated Drafts templates in ${options.draftsTemplatesDir}`);
  console.log(`Updated Drafts scripts in ${options.draftsScriptsDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
