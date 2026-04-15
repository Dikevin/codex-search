import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface CodexSearchConfig {
  version: 1;
  history: {
    enabled: boolean;
  };
}

const CONFIG_DIR = "codex-search";
const CONFIG_NAME = "config.json";

const DEFAULT_CONFIG: CodexSearchConfig = {
  version: 1,
  history: {
    enabled: true,
  },
};

export function getConfigPath(codexHomeDir: string | null | undefined): string {
  return join(codexHomeDir ?? join(homedir(), ".codex"), CONFIG_DIR, CONFIG_NAME);
}

export async function readConfig(
  codexHomeDir: string | null | undefined,
): Promise<CodexSearchConfig> {
  const configPath = getConfigPath(codexHomeDir);

  try {
    const raw = await readFile(configPath, "utf8");
    return normalizeConfig(JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export async function writeConfig(
  codexHomeDir: string | null | undefined,
  config: CodexSearchConfig,
): Promise<void> {
  const configPath = getConfigPath(codexHomeDir);
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(normalizeConfig(config), null, 2)}\n`, "utf8");
}

function normalizeConfig(value: unknown): CodexSearchConfig {
  const config = value as Partial<CodexSearchConfig> | null;
  return {
    version: 1,
    history: {
      enabled: config?.history?.enabled ?? DEFAULT_CONFIG.history.enabled,
    },
  };
}
