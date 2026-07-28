import type {
  ModelCatalogEntry,
  ModelRepository,
  RepositorySchemaLanguage,
  ResolvedRepositoryModel,
} from "@ilic/language-service";
import { BrowserCache } from "@ilic/tools/browser";
import { RepositoryManager } from "@ilic/tools";

export const repositorySettingsKey = "interlis-web-ide.model-repositories";
export const interlisMirrorRepository =
  "https://geo.so.ch/models/mirror/interlis.ch";
export const geoadminMirrorRepository =
  "https://geo.so.ch/models/mirror/geoadmin";
export const masterRepository = "https://geo.so.ch/models";
export const defaultRepositorySetting = [
  "%ILI_DIR",
  interlisMirrorRepository,
  geoadminMirrorRepository,
  masterRepository,
].join(";");

const legacyDefaultRepositorySetting = "%ILI_DIR;https://models.interlis.ch";

export function readRepositorySetting(): string {
  const stored = localStorage.getItem(repositorySettingsKey);
  return stored === legacyDefaultRepositorySetting
    ? defaultRepositorySetting
    : (stored ?? defaultRepositorySetting);
}

const configuredEntries = (value: string): string[] =>
  value
    .split(/[;,]/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry === "%ILI_DIR" || /^https?:\/\//iu.test(entry));

const normalizeUrl = (url: string): string => url.replace(/\/$/u, "");

function addUnique(result: string[], value: string): void {
  if (!result.includes(value)) result.push(value);
}

export function repositorySettingEntries(value: string): string[] {
  const result: string[] = [];
  addUnique(result, "%ILI_DIR");
  for (const entry of configuredEntries(value)) {
    if (entry === "%ILI_DIR") continue;
    const normalized = normalizeUrl(entry);
    if (/^https?:\/\/models\.interlis\.ch$/iu.test(normalized)) {
      addUnique(result, interlisMirrorRepository);
      addUnique(result, geoadminMirrorRepository);
    } else if (/^https?:\/\/models\.geo\.admin\.ch$/iu.test(normalized)) {
      addUnique(result, geoadminMirrorRepository);
    } else addUnique(result, normalized);
  }
  return result;
}

export function serializeRepositorySetting(entries: readonly string[]): string {
  const result = entries
    .map((entry) => entry.trim())
    .filter((entry) => entry === "%ILI_DIR" || /^https?:\/\//iu.test(entry))
    .map((entry) => (entry === "%ILI_DIR" ? entry : normalizeUrl(entry)));
  return result.length > 0
    ? [...new Set(result)].join(";")
    : defaultRepositorySetting;
}

export function repositoryEntryLabel(entry: string): string {
  const normalized = normalizeUrl(entry);
  if (normalized === "%ILI_DIR") return "Workspace";
  if (normalized === interlisMirrorRepository) return "INTERLIS mirror";
  if (normalized === geoadminMirrorRepository) return "geo.admin.ch mirror";
  if (normalized === masterRepository) return "Master repository";
  return "Additional repository";
}

export function browserRepositoryUrls(value: string): string[] {
  const result: string[] = [];
  for (const repository of configuredEntries(value)) {
    if (repository === "%ILI_DIR") continue;
    const normalized = normalizeUrl(repository);
    if (/^https?:\/\/models\.interlis\.ch$/iu.test(normalized)) {
      addUnique(result, interlisMirrorRepository);
      addUnique(result, geoadminMirrorRepository);
    } else if (/^https?:\/\/models\.geo\.admin\.ch$/iu.test(normalized)) {
      addUnique(result, geoadminMirrorRepository);
    } else addUnique(result, normalized);
  }
  return result;
}

const base64Url = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

export function createBrowserModelRepository(
  setting: string,
  onWarning?: (message: string) => void,
): ModelRepository {
  const manager = new RepositoryManager({
    repositories: browserRepositoryUrls(setting),
    cache: new BrowserCache("interlis-web-ide-repositories-v1"),
    allowStaleOnError: true,
    followSiteLinks: false,
    onWarning: (warning) => onWarning?.(`${warning.uri}: ${warning.message}`),
  });
  let catalog: Awaited<ReturnType<typeof manager.listModels>> | null = null;
  return {
    async listModels(): Promise<readonly ModelCatalogEntry[]> {
      catalog ??= await manager.listModels();
      return catalog
        .filter(
          (model) =>
            model.schemaLanguage === "ili2_3" ||
            model.schemaLanguage === "ili2_4",
        )
        .map((model) => ({
          name: model.name,
          schemaLanguage: model.schemaLanguage as RepositorySchemaLanguage,
          version: model.version,
          repository: model.repository,
          browseOnly: model.browseOnly,
        }));
    },
    async resolveModels(models, schemaLanguage) {
      const workspace = await manager.resolveWorkspace(
        [...models],
        schemaLanguage,
      );
      return workspace.models.map((model): ResolvedRepositoryModel => ({
        model: model.metadata.name,
        uri: `interlis-repository:/${schemaLanguage}/${encodeURIComponent(model.metadata.name)}/${base64Url(model.uri)}.ili`,
        originUri: model.uri,
        source: model.source,
        schemaLanguage,
        version: model.metadata.version,
        fromCache: model.fromCache,
        readOnly: true,
      }));
    },
  };
}
