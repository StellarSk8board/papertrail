// Bundled skills — imported as raw strings via Vite's ?raw suffix
import gmailRaw from "../basic-skills/gmail/SKILL.md?raw";
import googleCalendarRaw from "../basic-skills/google-calendar/SKILL.md?raw";
import browserRaw from "../basic-skills/browser/SKILL.md?raw";
import slackRaw from "../basic-skills/slack/SKILL.md?raw";
import googleSheetsRaw from "../basic-skills/google-sheets/SKILL.md?raw";
import googleDriveRaw from "../basic-skills/google-drive/SKILL.md?raw";
import notionRaw from "../basic-skills/notion/SKILL.md?raw";
import schedulerRaw from "../basic-skills/scheduler/SKILL.md?raw";

import { AgentSkill } from "./types";
import { parseSkill } from "./skill-parser";

const BUNDLED_RAW: Record<string, string> = {
  gmail: gmailRaw,
  "google-calendar": googleCalendarRaw,
  browser: browserRaw,
  slack: slackRaw,
  "google-sheets": googleSheetsRaw,
  "google-drive": googleDriveRaw,
  notion: notionRaw,
  scheduler: schedulerRaw,
};

let _cache: AgentSkill[] | null = null;

/**
 * Return all bundled skills, parsed from their SKILL.md files.
 * Results are cached after first call.
 */
export function getBundledSkills(): AgentSkill[] {
  if (_cache) return _cache;

  _cache = Object.entries(BUNDLED_RAW).map(([slug, raw]) => {
    const skill = parseSkill(raw);
    // Use a deterministic ID so bundled skills stay stable across reloads
    skill.id = `bundled:${slug}`;
    return skill;
  });

  return _cache;
}

/**
 * Get a single bundled skill by its slug (e.g. "gmail"). Returns undefined if not found.
 */
export function getBundledSkill(slug: string): AgentSkill | undefined {
  return getBundledSkills().find((s) => s.id === `bundled:${slug}`);
}

/**
 * List available bundled skill slugs.
 */
export function listBundledSlugs(): string[] {
  return Object.keys(BUNDLED_RAW);
}
