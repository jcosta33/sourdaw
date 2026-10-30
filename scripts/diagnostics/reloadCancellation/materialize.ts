import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ORIGINAL_SPEC, PRIVATE_DIRECTORY, WRAPPER } from './identity.ts';
import { writeReceipt } from './journal.ts';

const RUNTIME_FILES = [
    'identity.ts',
    'journal.ts',
    'history.ts',
    'websocket.ts',
    'browserSignals.ts',
    'pageCollector.ts',
    'paths.ts',
    'listReporter.ts',
    'prelude.ts',
    'configure.ts',
    'diagnostic.config.ts',
    'linuxResources.ts',
    'nativeTrace.ts',
    'nativeBrowserWrapper.ts',
    'nativeControl.ts',
    'rendererIdentity.ts',
    'serverObserver.ts',
    'viteTransportProbe.ts',
    'original-history.json',
];

export function materializeHarness(root: string): {
    directory: string;
    wrapper: string;
    reporter: string;
    config: string;
} {
    const directory = resolve(root, PRIVATE_DIRECTORY);
    const wrapper = resolve(root, WRAPPER);
    if (existsSync(directory) || existsSync(wrapper)) {
        throw new Error('Refusing to replace an existing diagnostic harness or attempt');
    }
    mkdirSync(directory, { recursive: true });
    mkdirSync(dirname(wrapper), { recursive: true });
    const ownDirectory = fileURLToPath(new URL('.', import.meta.url));
    const copied = [];
    for (const name of RUNTIME_FILES) {
        const source = resolve(ownDirectory, name);
        if (!lstatSync(source).isFile() || lstatSync(source).isSymbolicLink()) {
            throw new Error(`Expected a physical diagnostic source file: ${name}`);
        }
        const destination = resolve(directory, name);
        copyFileSync(source, destination);
        const digest = createHash('sha256').update(readFileSync(source)).digest('hex');
        if (createHash('sha256').update(readFileSync(destination)).digest('hex') !== digest) {
            throw new Error(`Diagnostic copy changed: ${name}`);
        }
        copied.push({ name, sha256: digest });
    }
    writeReceipt(resolve(directory, 'materialized-files.json'), copied);
    const maintained = resolve(root, ORIGINAL_SPEC);
    if (lstatSync(maintained).isSymbolicLink()) {
        throw new Error('Maintained target spec must be a physical file');
    }
    // Only the imports and passive beforeEach are generated; the maintained module owns its ROOT and body.
    const source = [
        "import { test } from '@playwright/test';",
        `import { admitTargetAndObserve } from ${JSON.stringify(resolve(directory, 'prelude.ts'))};`,
        `import ${JSON.stringify(maintained)};`,
        'test.beforeEach(async ({page,context,browser},info)=>{await admitTargetAndObserve(page,context,browser,info);});',
        '',
    ].join('\n');
    writeFileSync(wrapper, source, { flag: 'wx' });
    if (readFileSync(wrapper, 'utf8') !== source) {
        throw new Error('Generated wrapper readback differs');
    }
    return {
        directory,
        wrapper,
        reporter: resolve(directory, 'listReporter.ts'),
        config: resolve(directory, 'diagnostic.config.ts'),
    };
}
