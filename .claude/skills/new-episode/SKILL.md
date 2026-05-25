---
description: Generate a full DFIR Chronicles episode from a YAML scenario file (Technical Writer → Scriptwriter → Comic Artist)
---

# Skill: new-episode

Automates the full production pipeline for a new **DFIR Chronicles** episode:
1. YAML scenario file → English technical notes (Technical Writer, Claude)
2. Technical notes → comic script (Scriptwriter, Claude)
3. Script pages → black-and-white illustrations (Comic Artist, OpenAI GPT-4o)

---

## Invocation
 
```
/new-episode path/to/scenario.yaml
/new-episode --title "Override Title" path/to/scenario.yaml
```

- The YAML scenario file path is **required**.
- `--title "Override Title"` is optional. If omitted, the episode title is derived from the YAML `title` field, auto-translated from Italian to English.

---

## Execution — Follow These Steps in Order

### Step 0: Parse inputs, read YAML, and slugify

1. Parse the skill arguments:
   - If the first argument is `--title`, consume the next quoted argument as `TITLE_OVERRIDE` and treat the remaining argument as `YAML_PATH`.
   - Otherwise, the sole argument is `YAML_PATH`.
2. Verify `YAML_PATH` exists and is a `.yaml` or `.yml` file. If the file does not exist, stop immediately and tell the user.
3. Read the YAML file in full. Extract these top-level fields into working variables:
   - `yaml_title` ← `title`
   - `narrative_intro` ← `narrative_intro`
   - `design_notes` ← `design_notes`
   - `timeline` ← `timeline` (list)
   - `mentor_intro` ← `mentor.intro`
   - `mentor_steps` ← `mentor.steps` (list)
   - `mentor_pre_solve_recap` ← `mentor.pre_solve_recap`
   - `expected_resolution` ← `expected_resolution` (object)
   - `iocs` ← `iocs` (list)
   - `markers` ← `markers` (dict)
   - `victim_system` ← `victim_system` (object)
   - `attack_vector` ← `attack_vector`
   - `category` ← `category`
   - `difficulty` ← `difficulty`
   - `tags` ← `tags` (list)
4. Determine the episode title:
   - If `TITLE_OVERRIDE` is set, use it as the episode title verbatim (already in English).
   - Otherwise, translate `yaml_title` from Italian to English. Produce a short, evocative title suitable for a noir comic episode (e.g., "Apache 2.4 — Webshell PHP via upload non sanitizzato" → "The Unsanitized Upload"). Keep the dramatic tone.
5. Slug = episode title with spaces replaced by underscores (e.g., `The_Unsanitized_Upload`).
6. Episode root = `episodes/<Slug>/`

---

### Step 1: Create directory structure

Use Bash to create the episode directory layout:

```bash
mkdir -p episodes/<Slug>/pages
mkdir -p episodes/<Slug>/artifacts
```

---

### Step 2: Stage 1 — Technical Writer (Claude sub-agent)

Spawn a Claude sub-agent (Agent tool) with:

- **Prompt**: Paste the full content of `agents/technical_writer.md`, then append `\n\n# input\n\n` followed by the structured scenario extraction described below.
- **Task for sub-agent**: Generate the English technical documentation as specified in the prompt. Return the full Markdown output only — no commentary.

#### Building the structured extraction

Format the extracted YAML fields into the following text block and append it after `# input`:

```
## Episode metadata
- Title: <episode title (English, as determined in Step 0)>
- Category: <category>
- Difficulty: <difficulty>
- Tags: <comma-separated tags>
- Attack vector: <attack_vector string>
- MITRE ATT&CK: <extract any T-codes from tags, e.g. t1505-003 → T1505.003>

## Victim system
- Hostname: <victim_system.hostname>
- Distro: <victim_system.distro>
- Kernel: <victim_system.kernel>
- Role: <victim_system.role>
- Primary user: <victim_system.primary_user>

## Markers to resolve
<Paste the full `markers` dict as-is from the YAML, preserving its YAML structure.
The Technical Writer agent will replace each {{MARKER}} with a plausible concrete value.>

## Narrative introduction (Italian — translate and adapt)
<narrative_intro block verbatim>

## Design notes (Italian — use for technical context, do not reproduce verbatim)
<design_notes block verbatim>

## Attack timeline
<For each timeline entry, format as:>
- [<timestamp>] <actor>: <action>
  Evidence: <artifact_evidence list, or "none">

## Investigation flow (from mentor)
### Mentor introduction
<mentor.intro verbatim>

<For each mentor.step, in order:>
### Step <order>: <goal>
Suggested actions:
<suggested_action verbatim>
Rationale:
<rationale verbatim>

### Pre-solve recap
<mentor.pre_solve_recap verbatim>

## Expected resolution
### Root cause
<expected_resolution.root_cause>

### Attacker actions
<bulleted list from expected_resolution.attacker_actions>

### Persistence mechanism
<expected_resolution.persistence_mechanism>

### Affected assets
<bulleted list from expected_resolution.affected_assets>

### Recommended remediation
<bulleted list from expected_resolution.recommended_remediation>

### IoCs summary
<bulleted list from expected_resolution.iocs_summary>

## Key IoCs
<For each ioc in iocs list, format as:>
- [<type>] <value> — <note>
```

Write the sub-agent output to `episodes/<Slug>/README.md`.

---

### Step 3: Stage 2 — Scriptwriter (Claude sub-agent)

Read the content of `agents/scriptwriter.md`. Replace the `{technical_guide}` placeholder with the content of `episodes/<Slug>/README.md` just created.

Spawn a Claude sub-agent with:

- **Prompt**: The modified scriptwriter prompt.
- **Task for sub-agent**: Generate the comic script (max 15 pages, noir style). Return only the script — no commentary.

Write the sub-agent output to `episodes/<Slug>/script.txt`.

---

### Step 4: Stage 3 — Comic Artist (OpenAI GPT-4o image generation)

#### 4a. Read and prepare the system prompt

Read `agents/comic_artist.md`. Extract everything **from the beginning up to (but not including) the line `# Scene or Episode Description`** — this is the artist system prompt (`ARTIST_SYSTEM`).

#### 4b. Parse script pages

Read `episodes/<Slug>/script.txt`. Split it into individual page blocks by detecting lines that start with a digit followed by a period (e.g. `1.`, `2.`, ... `15.`). Each block runs from its heading line to just before the next heading line. Store these as an ordered list of page scripts.

#### 4c. Generate each page image

For each page (N = 1, 2, ... up to 15), call the OpenAI Images API using a Python script via Bash. Use the following approach for each page:

Write a temporary Python script to a file (e.g. `/tmp/gen_image.py`) that:
1. Reads the artist system prompt and the page script as variables
2. Builds the full prompt by concatenating the artist system prompt + `\n\n` + the page script
3. Calls the OpenAI Images Generations API:
   - endpoint: `https://api.openai.com/v1/images/generations`
   - model: `gpt-image-2`
   - `prompt`: the combined artist system prompt + page script
   - `n`: `1`
   - `size`: `"1024x1536"` (portrait — comic page format)
   - `quality`: `"high"`
   - `output_format`: `"png"`
   - `response_format`: `"b64_json"`
4. Base64-decodes the `b64_json` field from `response.data[0]` and writes it as a PNG file to `episodes/<Slug>/pages/<N>.png`

Then execute it:
```bash
OPENAI_API_KEY="$OPENAI_API_KEY" python3 /tmp/gen_image.py
```

**Fallback**: If `$OPENAI_API_KEY` is not set or the API call fails (non-200 response or missing data), append the page script to `episodes/<Slug>/pages/image_prompts.txt` with a `--- Page N ---` header, and continue to the next page. Do not abort the whole pipeline.

Report progress after each image: `[Page N/total] Image saved → pages/N.png`

#### 4d. Generate the cover image

After all pages are done, create the cover. Build the cover prompt using the format specified in `comic_artist.md`:

```
Episode title: <title>
Episode description: <first 3–4 lines of the script, summarizing the story>
```

Use the same API call as above but with `size: "1024x1536"` and save the result to `episodes/<Slug>/pages/cover.png`.

---

### Step 5: Update root README.md

Read `/home/antonio/GitHub/DFIR-Chronicles/README.md`. Find the `## Episodes` section. Before the `More episodes coming soon...` placeholder line (or at the end of the Episodes section if the placeholder is absent), insert a new episode entry following the same format as existing episodes:

```markdown
### Episode XX — <Title>

<2–3 sentence summary drawn from the first paragraph of episodes/<Slug>/README.md>
```

Write the updated content back to `README.md`.

---

### Step 6: Final report

Print a summary:
- Episode folder created: `episodes/<Slug>/`
- README.md: ✓
- script.txt: ✓ (N pages)
- Pages generated: M/N (note any that fell back to image_prompts.txt)
- Cover: ✓ / ✗
- Root README.md: updated ✓

---

## Important Notes

- **Never skip a stage** because the output of each feeds the next.
- **Do not hallucinate** technical content — the Technical Writer sub-agent must use the real agent prompt.
- **Preserve the episode title** exactly as determined in Step 0 in all output files.
- If the YAML file path does not exist or cannot be parsed as valid YAML, stop and tell the user immediately.
- The YAML scenario may contain `{{MARKER}}` placeholders throughout. These are **not** resolved by the skill — they are passed through to the Technical Writer agent, which is responsible for replacing them with realistic concrete values.
- The `OPENAI_API_KEY` environment variable must be available. If it is not set, warn the user before reaching Step 4 and offer to continue with prompt export only.
