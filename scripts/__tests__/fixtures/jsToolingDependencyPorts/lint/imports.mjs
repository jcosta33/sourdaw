import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import plugin from 'eslint-plugin-import-x';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
const root = mkdtempSync(join(tmpdir(), 'lint-import-proof-'));
try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'actual.js'), 'export default 1;');
    writeFileSync(
        join(root, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@fixture/*': ['src/*'] } } })
    );
    const eslint = new ESLint({
        cwd: root,
        overrideConfigFile: true,
        overrideConfig: [
            {
                settings: {
                    'import-x/resolver-next': [
                        createTypeScriptImportResolver({ project: join(root, 'tsconfig.json') }),
                    ],
                },
                plugins: { 'import-x': plugin },
                rules: {
                    'import-x/order': ['error', { alphabetize: { order: 'asc' } }],
                    'import-x/no-unresolved': 'error',
                },
            },
        ],
    });
    const [result] = await eslint.lintText(
        "import z from '@fixture/actual';\nimport a from '@fixture/missing';\nvoid z; void a;",
        { filePath: join(root, 'probe.js') }
    );
    const missing = result.messages.filter((m) => m.ruleId === 'import-x/no-unresolved');
    assert.equal(missing.length, 1);
    assert.equal(missing[0].line, 2);
    assert.match(missing[0].message, /missing/);
    assert(result.messages.some((m) => m.ruleId === 'import-x/order'));
    console.log(JSON.stringify({ case: 'import-order-resolver', complete: true }));
} finally {
    rmSync(root, { recursive: true, force: true });
}
