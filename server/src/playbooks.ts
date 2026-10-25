import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

export interface Playbook {
  id: string;
  name: string;
  end_phrases: string[];
  silence_seconds?: number;
  keyterms: string[];
  live_lines: string;
  brief: string;
  followup: string;
  voice_samples: string[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const PLAYBOOK_DIR = path.resolve(here, "../../playbooks");

export function loadPlaybooks(): Map<string, Playbook> {
  const playbooks = new Map<string, Playbook>();
  for (const file of fs.readdirSync(PLAYBOOK_DIR)) {
    if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
    const pb = yaml.load(fs.readFileSync(path.join(PLAYBOOK_DIR, file), "utf8")) as Playbook;
    playbooks.set(pb.id, { ...pb, keyterms: pb.keyterms ?? [], voice_samples: pb.voice_samples ?? [] });
  }
  return playbooks;
}
