import { WASI } from 'node:wasi';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const [wasmPath, filter] = process.argv.slice(2);
if (!wasmPath || !filter) throw new Error('usage: run-wasi.mjs <wasm> <exact-test-filter>');
const bytes = await readFile(wasmPath);
const module = await WebAssembly.compile(bytes);
const imports = WebAssembly.Module.imports(module);
if (imports.some(({ module }) => module !== 'wasi_snapshot_preview1')) {
  throw new Error(`unexpected non-Preview1 imports: ${JSON.stringify(imports)}`);
}
console.log(JSON.stringify({ node: process.version, wasm: wasmPath, sha256: createHash('sha256').update(bytes).digest('hex'), filter, imports }));
const wasi = new WASI({ version: 'preview1', returnOnExit: true,
  args: [wasmPath, filter, '--exact', '--nocapture', '--test-threads=1'], preopens: {} });
const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
const exitCode = wasi.start(instance);
console.log(`WASI.start exit=${exitCode}`);
process.exitCode = exitCode;
