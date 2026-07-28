import type {
  CompilerWorkerFactory,
  CompilerWorkerPort,
  CompilerWorkerRequest,
  CompilerWorkerResponse,
} from "@ilic/language-service";
import InterlisCompilerWorker from "./interlis-compiler.worker.ts?worker";

export function createBrowserCompilerWorkerFactory(): CompilerWorkerFactory {
  let workerNumber = 0;
  return (): CompilerWorkerPort => {
    const worker = new InterlisCompilerWorker({
      name: `interlis-language-worker-${++workerNumber}`,
    });
    return {
      postMessage(message: CompilerWorkerRequest) {
        worker.postMessage(message);
      },
      onMessage(listener: (message: CompilerWorkerResponse) => void) {
        const handle = (event: MessageEvent<CompilerWorkerResponse>) =>
          listener(event.data);
        worker.addEventListener("message", handle);
        return {
          dispose: () => worker.removeEventListener("message", handle),
        };
      },
      onError(listener: (error: unknown) => void) {
        const handle = (event: ErrorEvent) =>
          listener(event.error ?? new Error(event.message));
        worker.addEventListener("error", handle);
        return {
          dispose: () => worker.removeEventListener("error", handle),
        };
      },
      terminate() {
        worker.terminate();
      },
    };
  };
}
