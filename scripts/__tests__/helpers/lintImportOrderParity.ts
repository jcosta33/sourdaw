import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { withStockLintAlternatives } from './lintStockAlternatives.ts';

const imports =
    [
        "import type { Value } from './type';",
        "import index from './index';",
        "import zoo from './Zoo';",
        "import alpha from './alpha';",
        "import parent from '../parent';",
        "import unknown from '#/lint-parity-unknown';",
        "import internal from '#/utils/base64';",
        "import React from 'react';",
        "import grouped from 'src/parity-unresolved';",
        "import { join } from 'node:path';",
        "import { readFileSync } from 'fs';",
        "import { z } from 'zod';",
        "import conditional from 'lint-parity-conditional';",
        "import fallback from 'lint-parity-fallback';",
        'export const value = [index, zoo, alpha, parent, unknown, internal, React, grouped, join, readFileSync, z, conditional, fallback];',
    ].join('\n') + '\n';

function prepare(fixture: string) {
    const directory = dirname(fixture);
    for (const name of ['index', 'Zoo', 'alpha', 'type']) {
        writeFileSync(join(directory, `${name}.ts`), `export type Value = string; export default '${name}';\n`);
    }
    const conditional = join(directory, 'node_modules/lint-parity-conditional');
    mkdirSync(conditional, { recursive: true });
    writeFileSync(
        join(conditional, 'package.json'),
        JSON.stringify({
            name: 'lint-parity-conditional',
            exports: { '.': { types: './value.d.ts', import: './value.mjs', require: './value.cjs' } },
        })
    );
    for (const name of ['value.d.ts', 'value.mjs', 'value.cjs']) {
        writeFileSync(join(conditional, name), 'export default 1;\n');
    }
    const fallback = join(directory, 'fallback-internal');
    mkdirSync(fallback);
    writeFileSync(
        join(fallback, 'package.json'),
        JSON.stringify({
            name: 'lint-parity-fallback',
            exports: { '.': { types: './missing.d.ts', import: './runtime.node' } },
        })
    );
    // Resolution only: no native module is executed. The missing types branch
    // forces the Node fallback; resolving the symlink ranks it as internal.
    writeFileSync(join(fallback, 'runtime.node'), '');
    symlinkSync(fallback, join(directory, 'node_modules/lint-parity-fallback'), 'dir');
}

export function lintImportOrderParity(filename: string) {
    const input =
        filename.endsWith('.js') || filename.endsWith('.jsx')
            ? imports.replace("import type { Value } from './type';\n", '')
            : imports;
    return withStockLintAlternatives(
        input,
        (probe) => {
            const check = { subject: 'imports', fix: false } as const;
            const fix = { subject: 'imports', fix: true } as const;
            const baselineCheck = probe.eslint(check);
            const jsonCheck = probe.eslint({ ...check, jsonResolver: true });
            const canonicalCheck = probe.eslint({ ...check, canonicalAlias: true });
            const oxlintCheck = probe.oxlint({ ...check, prettier: false });
            const productionCheck = probe.oxlint({ ...check, production: true });
            const baselineFix = probe.eslint(fix);
            probe.reset();
            const jsonFix = probe.eslint({ ...fix, jsonResolver: true });
            probe.reset();
            const canonicalFix = probe.eslint({ ...fix, canonicalAlias: true });
            const repeated = probe.eslint({ ...fix, canonicalAlias: true });
            const finalCheck = probe.eslint({ ...check, canonicalAlias: true });
            const finalOxlint = probe.oxlint(check);
            const finalProduction = probe.oxlint({ ...check, production: true });
            probe.reset();
            const noNodeFix = probe.eslint({ ...fix, jsonResolver: true, typescriptOnly: true });
            return {
                baselineCheck,
                jsonCheck,
                canonicalCheck,
                oxlintCheck,
                productionCheck,
                baselineFix,
                jsonFix,
                canonicalFix,
                repeated,
                finalCheck,
                finalOxlint,
                finalProduction,
                noNodeFix,
            };
        },
        { filename, prepare: filename.startsWith('server/') ? undefined : prepare }
    );
}
