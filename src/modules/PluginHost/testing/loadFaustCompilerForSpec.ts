import { copyFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The package's "main" CJS bundle exposes no runtime exports under Node SSR
// resolution; the ESM build (what Vite serves the app) does.
import {
    FaustCompiler,
    instantiateFaustModuleFromFile,
    LibFaust,
    type IFaustCompiler,
} from '@grame/faustwasm/dist/esm/index.js';

const FAUST_ASSETS_DIR = './public/faust';

let copyCounter = 0;

/**
 * Instantiate the libfaust compiler for a spec, race-free.
 *
 * `instantiateFaustModuleFromFile` writes a temp ES module next to its
 * `jsFile` argument (`<jsFile>` with the extension swapped to `.mjs`) and
 * unlinks it after import — so two spec workers loading the compiler from the
 * same `./public/faust/libfaust-wasm.js` collide on that shared temp path
 * (ENOENT on unlink). The loader derives the temp name from `jsFile` and takes
 * the heavy `.data`/`.wasm` artifacts as separate arguments, so giving each
 * process its own small `.js` copy is sufficient: the temp module name is
 * unique per process and call, while the read-only artifacts stay shared.
 *
 * Use this from every Faust-compiling spec.
 */
export async function loadFaustCompilerForSpec(): Promise<IFaustCompiler> {
    copyCounter += 1;
    const jsCopy = join(tmpdir(), `libfaust-wasm-spec-${process.pid}-${copyCounter}.js`);
    copyFileSync(join(FAUST_ASSETS_DIR, 'libfaust-wasm.js'), jsCopy);
    try {
        const faustModule = await instantiateFaustModuleFromFile(
            jsCopy,
            join(FAUST_ASSETS_DIR, 'libfaust-wasm.data'),
            join(FAUST_ASSETS_DIR, 'libfaust-wasm.wasm')
        );
        return new FaustCompiler(new LibFaust(faustModule));
    } finally {
        // The loader has already imported (and unlinked) the temp module
        // derived from the copy; the copy itself is no longer needed.
        unlinkSync(jsCopy);
    }
}
