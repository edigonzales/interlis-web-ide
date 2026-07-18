export {
  FileSystemAccessWorkspace,
  PrefixWorkspaceFileSystem,
} from "./file-system-access.js";
export { DirectoryHandleStore, LocalFolderWorkspace } from "./local-folder.js";
export type { LocalFolderState } from "./local-folder.js";
export { WorkspaceManager } from "./manager.js";
export type { WorkspaceDescriptor } from "./manager.js";
export { MemoryWorkspaceFileSystem } from "./memory.js";
export { openOpfsRoot, openOpfsWorkspace } from "./opfs.js";
export { BufferRecoveryStore } from "./recovery.js";
export type { RecoveredBuffer } from "./recovery.js";
export { RepositoryModelCache, repositoryDirectories } from "./repository.js";
export type {
  Disposable,
  FileChange,
  FileStat,
  FileType,
  WorkspaceFileSystem,
} from "./types.js";
export { baseName, normalizePath, parentPath, pathSegments } from "./types.js";
export {
  downloadBytes,
  exportWorkspaceZip,
  fileText,
  importWorkspaceZip,
  textFile,
} from "./zip.js";
