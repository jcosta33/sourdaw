/**
 * Guard: no spec mocks a contract barrel while omitting an export its own module
 * graph imports from that barrel.
 *
 * The defect this stops (#1393, landed in #1392): a `vi.mock` factory that lists
 * every export by hand resolves anything added to the barrel later to `undefined`.
 * A view resolved to `undefined` throws on render, so *every* test in the mocking
 * file reds — in a module the author's diff never touched. `TransportBar.spec.tsx`
 * lost all 13 of its tests to a change that only added `MissingMediaPanel` to
 * `Project/presentations/views`.
 *
 * Falsifiable per ADR 0015 on three independent axes:
 *
 *  1. **Planted broken fixtures.** The analyzer is run against in-memory graphs
 *     that are deliberately wrong — a direct omission, a transitive one, and a
 *     namespace import — so the real-tree verdict below can never be reached by an
 *     extraction that has stopped extracting.
 *  2. **Planted correct fixtures.** The same analyzer must stay silent on a spread
 *     factory and on a mocked-out consumer, so the check is not simply reporting
 *     everything.
 *  3. **Real-tree mutation.** Removing `MissingMediaPanel:` from the
 *     `#/modules/Project/presentations/views` factory in
 *     `src/modules/WorkspaceShell/presentations/views/__tests__/TransportBar.spec.tsx`
 *     (after dropping its `importOriginal` spread) makes the last case here red.
 */

import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { analyzeSpecs, readFileFacts, scanRepository, type FileFacts } from '../checkBarrelMockCoverage';

const repoRoot = join(import.meta.dirname, '../..');
const sourceRoot = join(repoRoot, 'src');

function buildFixture(files: Record<string, string>): {
    specPaths: string[];
    readFacts: (path: string) => FileFacts | null;
    fileExists: (path: string) => boolean;
} {
    const absolute = new Map<string, string>();
    for (const [relativePath, contents] of Object.entries(files)) {
        absolute.set(join(repoRoot, relativePath), contents);
    }
    return {
        specPaths: [...absolute.keys()].filter((path) => path.endsWith('.spec.tsx')),
        readFacts: (path) => {
            const contents = absolute.get(path);
            if (contents === undefined) {
                return null;
            }
            return readFileFacts(path, contents);
        },
        fileExists: (path) => absolute.has(path),
    };
}

const barrel = 'src/modules/Widgets/presentations/views/index.ts';
const barrelSpecifier = '#/modules/Widgets/presentations/views';

describe('checkBarrelMockCoverage — planted broken fixtures', () => {
    it('reports the export the consumer imports and the exhaustive factory omits', () => {
        const fixture = buildFixture({
            [barrel]: "export { Alpha } from './Alpha';\nexport { Beta } from './Beta';\n",
            'src/modules/Host/presentations/views/HostPanel.tsx': `import { Alpha, Beta } from '${barrelSpecifier}';\nexport const HostPanel = () => [Alpha, Beta];\n`,
            'src/modules/Host/presentations/views/__tests__/HostPanel.spec.tsx': `vi.mock('${barrelSpecifier}', () => ({ Alpha: () => null }));\nimport { HostPanel } from '../HostPanel';\n`,
        });

        const violations = analyzeSpecs(fixture);

        expect(
            violations.map((violation) => ({
                barrel: violation.barrel,
                line: violation.line,
                missing: violation.missing,
                usedBy: violation.usedBy,
            }))
        ).toEqual([
            {
                barrel: barrelSpecifier,
                line: 1,
                missing: ['Beta'],
                usedBy: join(repoRoot, 'src/modules/Host/presentations/views/HostPanel.tsx'),
            },
        ]);
    });

    it('follows the graph past the file under test — the import that breaks is rarely in the spec', () => {
        const fixture = buildFixture({
            [barrel]: "export { Alpha } from './Alpha';\nexport { Beta } from './Beta';\n",
            'src/modules/Host/presentations/views/DeepChild.tsx': `import { Beta } from '${barrelSpecifier}';\nexport const DeepChild = () => Beta;\n`,
            'src/modules/Host/presentations/views/HostPanel.tsx': `import { Alpha } from '${barrelSpecifier}';\nimport { DeepChild } from './DeepChild';\nexport const HostPanel = () => [Alpha, DeepChild];\n`,
            'src/modules/Host/presentations/views/__tests__/HostPanel.spec.tsx': `vi.mock('${barrelSpecifier}', () => ({ Alpha: () => null }));\nimport { HostPanel } from '../HostPanel';\n`,
        });

        const violations = analyzeSpecs(fixture);

        expect(violations.map((violation) => [violation.missing, violation.usedBy])).toEqual([
            [['Beta'], join(repoRoot, 'src/modules/Host/presentations/views/DeepChild.tsx')],
        ]);
    });

    it('treats a namespace import of a mocked barrel as requiring the whole surface', () => {
        const fixture = buildFixture({
            [barrel]: "export { Alpha } from './Alpha';\n",
            'src/modules/Host/presentations/views/HostPanel.tsx': `import * as views from '${barrelSpecifier}';\nexport const HostPanel = () => views;\n`,
            'src/modules/Host/presentations/views/__tests__/HostPanel.spec.tsx': `vi.mock('${barrelSpecifier}', () => ({ Alpha: () => null }));\nimport { HostPanel } from '../HostPanel';\n`,
        });

        expect(analyzeSpecs(fixture).map((violation) => violation.missing)).toEqual([['* (namespace import)']]);
    });

    it('sees the lazy-panel shape: import(barrel).then((m) => ({ default: m.View }))', () => {
        const fixture = buildFixture({
            [barrel]: "export { Alpha } from './Alpha';\nexport { Beta } from './Beta';\n",
            'src/modules/Host/presentations/views/HostPanel.tsx': `export const Lazy = () => import('${barrelSpecifier}').then((m) => ({ default: m.Beta }));\n`,
            'src/modules/Host/presentations/views/__tests__/HostPanel.spec.tsx': `vi.mock('${barrelSpecifier}', () => ({ Alpha: () => null }));\nimport { Lazy } from '../HostPanel';\n`,
        });

        expect(analyzeSpecs(fixture).map((violation) => violation.missing)).toEqual([['Beta']]);
    });
});

describe('checkBarrelMockCoverage — planted correct fixtures', () => {
    it('stays silent when the factory spreads importOriginal', () => {
        const fixture = buildFixture({
            [barrel]: "export { Alpha } from './Alpha';\nexport { Beta } from './Beta';\n",
            'src/modules/Host/presentations/views/HostPanel.tsx': `import { Alpha, Beta } from '${barrelSpecifier}';\nexport const HostPanel = () => [Alpha, Beta];\n`,
            'src/modules/Host/presentations/views/__tests__/HostPanel.spec.tsx': `vi.mock('${barrelSpecifier}', async (importOriginal) => ({ ...(await importOriginal()), Alpha: () => null }));\nimport { HostPanel } from '../HostPanel';\n`,
        });

        expect(analyzeSpecs(fixture)).toEqual([]);
    });

    it('stays silent when the only consumer of the omitted export is itself mocked out', () => {
        const fixture = buildFixture({
            [barrel]: "export { Alpha } from './Alpha';\nexport { Beta } from './Beta';\n",
            'src/modules/Host/presentations/views/DeepChild.tsx': `import { Beta } from '${barrelSpecifier}';\nexport const DeepChild = () => Beta;\n`,
            'src/modules/Host/presentations/views/HostPanel.tsx': `import { Alpha } from '${barrelSpecifier}';\nimport { DeepChild } from './DeepChild';\nexport const HostPanel = () => [Alpha, DeepChild];\n`,
            'src/modules/Host/presentations/views/__tests__/HostPanel.spec.tsx': `vi.mock('${barrelSpecifier}', () => ({ Alpha: () => null }));\nvi.mock('../DeepChild', () => ({ DeepChild: () => null }));\nimport { HostPanel } from '../HostPanel';\n`,
        });

        expect(analyzeSpecs(fixture)).toEqual([]);
    });

    it('ignores mocks of modules that are not contract barrels', () => {
        const fixture = buildFixture({
            'src/utils/Widgets/helpers.ts': 'export const alpha = () => 1;\nexport const beta = () => 2;\n',
            'src/modules/Host/presentations/views/HostPanel.tsx':
                "import { alpha, beta } from '#/utils/Widgets/helpers';\nexport const HostPanel = () => [alpha, beta];\n",
            'src/modules/Host/presentations/views/__tests__/HostPanel.spec.tsx':
                "vi.mock('#/utils/Widgets/helpers', () => ({ alpha: () => 1 }));\nimport { HostPanel } from '../HostPanel';\n",
        });

        expect(analyzeSpecs(fixture)).toEqual([]);
    });
});

describe('checkBarrelMockCoverage — the real tree', () => {
    it('has no presentations/views barrel mock that omits an export its graph imports', () => {
        const { specCount, violations } = scanRepository();

        expect(
            violations.map((violation) => `${violation.spec.replace(`${sourceRoot}/`, '')}: ${violation.barrel}`)
        ).toEqual([]);
        expect(specCount).toBeGreaterThan(1000);
    });
});
