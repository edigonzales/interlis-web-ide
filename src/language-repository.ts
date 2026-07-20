import type {
  ModelCatalogEntry,
  ModelRepository,
  RepositorySchemaLanguage,
  ResolvedRepositoryModel,
} from "@ilic/language-service";
import { BrowserCache } from "@ilic/tools/browser";
import { RepositoryManager } from "@ilic/tools";

export const repositorySettingsKey = "interlis-web-ide.model-repositories";
export const defaultRepositorySetting = "%ILI_DIR;https://models.interlis.ch";

export function readRepositorySetting(): string {
  return (
    localStorage.getItem(repositorySettingsKey) ?? defaultRepositorySetting
  );
}

const configuredUrls = (value: string): string[] =>
  value
    .split(/[;,]/u)
    .map((entry) => entry.trim())
    .filter((entry) => /^https?:\/\//iu.test(entry));

export function browserRepositoryUrls(value: string): string[] {
  const result: string[] = [];
  const add = (url: string): void => {
    const normalized = url.replace(/\/$/u, "");
    if (!result.includes(normalized)) result.push(normalized);
  };
  for (const repository of configuredUrls(value)) {
    const normalized = repository.replace(/\/$/u, "");
    if (/^https?:\/\/models\.interlis\.ch$/iu.test(normalized)) {
      add("https://geo.so.ch/models/mirror/interlis.ch");
      add("https://geo.so.ch/models/mirror/geoadmin");
    } else if (/^https?:\/\/models\.geo\.admin\.ch$/iu.test(normalized)) {
      add("https://geo.so.ch/models/mirror/geoadmin");
    } else add(normalized);
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
