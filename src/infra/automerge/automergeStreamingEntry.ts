/**
 * The app bundle's `@automerge/automerge` entry. The package's base64 entry
 * decodes and compiles its 3.6 MB wasm synchronously on the main thread at
 * import; fetching the emitted file by URL lets the browser stream-compile it
 * off the main thread. The top-level await keeps the package contract that the
 * API is ready once the import resolves.
 */
import { initializeWasm } from '@automerge/automerge/slim';
import automergeWasmUrl from '@automerge/automerge/automerge.wasm?url';

await initializeWasm(automergeWasmUrl);

export * from '@automerge/automerge/slim';
