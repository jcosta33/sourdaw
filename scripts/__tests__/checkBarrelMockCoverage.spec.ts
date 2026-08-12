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
 * Falsifiable per ADR 0015 on four independent axes:
 *
 *  1. **Planted broken fixtures.** The analyzer is run against in-memory graphs
 *     that are deliberately wrong — a direct omission, a transitive one, a
 *     namespace import, the lazy `import().then()` shape, a factory whose
 *     parameter is *named* `importOriginal` but never spread — so the real-tree
 *     verdict below can never be reached by an extraction that has gone blind.
 *  2. **Planted correct fixtures.** The same analyzer must stay silent on a spread
 *     factory, on a spread through a local binding, on a mocked-out consumer and
 *     on a non-barrel module, so the check is not simply reporting everything.
 *  3. **Zero-derivation cases.** A resolver that resolves nothing and a reader that
 *     reads nothing both produce zero violations; the counts assert that this is
 *     distinguishable from a clean tree, which is the difference between failing
 *     closed and failing open.
 *  4. **Real-tree mutation.** Dropping the `...(await importOriginal())` line from
 *     the `#/modules/Project/presentations/views` factory in
 *     `src/modules/WorkspaceShell/presentations/views/__tests__/TransportBar.spec.tsx`
 *     — keeping the `async (importOriginal) =>` signature, which is the shape a
 *     textual check cannot tell from a real spread — makes the real-tree case red.
 */

import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    allBarrelKinds,
    analyzeSpecs,
    readFileFacts,
    scanRepository,
    type FileFacts,
} from '../checkBarrelMockCoverage';

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

type Fixture = ReturnType<typeof buildFixture>;

function violationsOf(fixture: Fixture): ReturnType<typeof analyzeSpecs>['violations'] {
    return analyzeSpecs(fixture).violations;
}

const barrel = 'src/modules/Widgets/presentations/views/index.ts';
const barrelSpecifier = '#/modules/Widgets/presentations/views';
const secondBarrel = 'src/modules/Gadgets/presentations/views/index.ts';
const secondBarrelSpecifier = '#/modules/Gadgets/presentations/views';

describe('checkBarrelMockCoverage — planted broken fixtures', () => {
    it('reports the export the consumer imports and the exhaustive factory omits', () => {
        const fixture = buildFixture({
            [barrel]: "export { Alpha } from './Alpha';\nexport { Beta } from './Beta';\n",
            'src/modules/Host/presentations/views/HostPanel.tsx': `import { Alpha, Beta } from '${barrelSpecifier}';\nexport const HostPanel = () => [Alpha, Beta];\n`,
            'src/modules/Host/presentations/views/__tests__/HostPanel.spec.tsx': `vi.mock('${barrelSpecifier}', () => ({ Alpha: () => null }));\nimport { HostPanel } from '../HostPanel';\n`,
        });

        const violations = violationsOf(fixture);

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

        const violations = violationsOf(fixture);

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

        expect(violationsOf(fixture).map((violation) => violation.missing)).toEqual([['* (namespace import)']]);
    });

    it('sees the lazy-panel shape: import(barrel).then((m) => ({ default: m.View }))', () => {
        const fixture = buildFixture({
            [barrel]: "export { Alpha } from './Alpha';\nexport { Beta } from './Beta';\n",
            'src/modules/Host/presentations/views/HostPanel.tsx': `export const Lazy = () => import('${barrelSpecifier}').then((m) => ({ default: m.Beta }));\n`,
            'src/modules/Host/presentations/views/__tests__/HostPanel.spec.tsx': `vi.mock('${barrelSpecifier}', () => ({ Alpha: () => null }));\nimport { Lazy } from '../HostPanel';\n`,
        });

        expect(violationsOf(fixture).map((violation) => violation.missing)).toEqual([['Beta']]);
    });
});

describe('checkBarrelMockCoverage — planted correct fixtures', () => {
    it('stays silent when the factory spreads importOriginal', () => {
        const fixture = buildFixture({
            [barrel]: "export { Alpha } from './Alpha';\nexport { Beta } from './Beta';\n",
            'src/modules/Host/presentations/views/HostPanel.tsx': `import { Alpha, Beta } from '${barrelSpecifier}';\nexport const HostPanel = () => [Alpha, Beta];\n`,
            'src/modules/Host/presentations/views/__tests__/HostPanel.spec.tsx': `vi.mock('${barrelSpecifier}', async (importOriginal) => ({ ...(await importOriginal()), Alpha: () => null }));\nimport { HostPanel } from '../HostPanel';\n`,
        });

        expect(violationsOf(fixture)).toEqual([]);
    });

    it('stays silent when the only consumer of the omitted export is itself mocked out', () => {
        const fixture = buildFixture({
            [barrel]: "export { Alpha } from './Alpha';\nexport { Beta } from './Beta';\n",
            'src/modules/Host/presentations/views/DeepChild.tsx': `import { Beta } from '${barrelSpecifier}';\nexport const DeepChild = () => Beta;\n`,
            'src/modules/Host/presentations/views/HostPanel.tsx': `import { Alpha } from '${barrelSpecifier}';\nimport { DeepChild } from './DeepChild';\nexport const HostPanel = () => [Alpha, DeepChild];\n`,
            'src/modules/Host/presentations/views/__tests__/HostPanel.spec.tsx': `vi.mock('${barrelSpecifier}', () => ({ Alpha: () => null }));\nvi.mock('../DeepChild', () => ({ DeepChild: () => null }));\nimport { HostPanel } from '../HostPanel';\n`,
        });

        expect(violationsOf(fixture)).toEqual([]);
    });

    it('ignores mocks of modules that are not contract barrels', () => {
        const fixture = buildFixture({
            'src/utils/Widgets/helpers.ts': 'export const alpha = () => 1;\nexport const beta = () => 2;\n',
            'src/modules/Host/presentations/views/HostPanel.tsx':
                "import { alpha, beta } from '#/utils/Widgets/helpers';\nexport const HostPanel = () => [alpha, beta];\n",
            'src/modules/Host/presentations/views/__tests__/HostPanel.spec.tsx':
                "vi.mock('#/utils/Widgets/helpers', () => ({ alpha: () => 1 }));\nimport { HostPanel } from '../HostPanel';\n",
        });

        expect(violationsOf(fixture)).toEqual([]);
    });
});

describe('checkBarrelMockCoverage — a spread mock does not hide the rest of the file', () => {
    // The inversion this file exists to prevent: a spread factory *loads* the real
    // module, so its imports run. Cutting spread-mocked modules out of the graph
    // made applying the repair to one barrel shrink the gate's view of every other
    // barrel in the same spec — the more of the fix you applied, the less it saw.
    const twoBarrelFixture = buildFixture({
        [barrel]: "export { Alpha } from './Alpha';\n",
        [secondBarrel]: "export { Gamma } from './Gamma';\nexport { Delta } from './Delta';\n",
        'src/modules/Widgets/presentations/views/Alpha.tsx': `import { Delta } from '${secondBarrelSpecifier}';\nexport const Alpha = () => Delta;\n`,
        'src/modules/Host/presentations/views/HostPanel.tsx': `import { Alpha } from '${barrelSpecifier}';\nexport const HostPanel = () => Alpha;\n`,
        'src/modules/Host/presentations/views/__tests__/HostPanel.spec.tsx': [
            `vi.mock('${barrelSpecifier}', async (importOriginal) => ({ ...(await importOriginal()), Alpha: () => null }));`,
            `vi.mock('${secondBarrelSpecifier}', () => ({ Gamma: () => null }));`,
            "import { HostPanel } from '../HostPanel';",
            '',
        ].join('\n'),
    });

    it('reaches a second barrel only through the spread-mocked one', () => {
        expect(violationsOf(twoBarrelFixture).map((violation) => [violation.barrel, violation.missing])).toEqual([
            [secondBarrelSpecifier, ['Delta']],
        ]);
    });

    it('walks the spread-mocked module itself rather than treating it as absent', () => {
        expect(analyzeSpecs(twoBarrelFixture).graphNodeCount).toBeGreaterThan(2);
    });
});

describe('checkBarrelMockCoverage — spread detection is structural, not textual', () => {
    function factoryFixture(factorySource: string): Fixture {
        return buildFixture({
            [barrel]: "export { Alpha } from './Alpha';\nexport { Beta } from './Beta';\n",
            'src/modules/Host/presentations/views/HostPanel.tsx': `import { Alpha, Beta } from '${barrelSpecifier}';\nexport const HostPanel = () => [Alpha, Beta];\n`,
            'src/modules/Host/presentations/views/__tests__/HostPanel.spec.tsx': `vi.mock('${barrelSpecifier}', ${factorySource});\nimport { HostPanel } from '../HostPanel';\n`,
        });
    }

    it('rejects a parameter named importOriginal that is never spread', () => {
        // The whole corrected signature minus the one line that does the work.
        expect(violationsOf(factoryFixture('async (importOriginal) => ({ Alpha: () => null })')).length).toBe(1);
    });

    it('rejects the word importOriginal in a comment', () => {
        expect(violationsOf(factoryFixture('() => ({ /* importOriginal */ Alpha: () => null })')).length).toBe(1);
    });

    it('accepts the original spread through a local binding', () => {
        expect(
            violationsOf(
                factoryFixture(
                    'async (importOriginal) => { const actual = await importOriginal(); return { ...actual, Alpha: () => null }; }'
                )
            )
        ).toEqual([]);
    });
});

describe('checkBarrelMockCoverage — the forms vitest itself accepts', () => {
    function mockCallFixture(mockCall: string): Fixture {
        return buildFixture({
            [barrel]: "export { Alpha } from './Alpha';\nexport { Beta } from './Beta';\n",
            'src/modules/Host/presentations/views/HostPanel.tsx': `import { Alpha, Beta } from '${barrelSpecifier}';\nexport const HostPanel = () => [Alpha, Beta];\n`,
            'src/modules/Host/presentations/views/__tests__/HostPanel.spec.tsx': `${mockCall}\nimport { HostPanel } from '../HostPanel';\n`,
        });
    }

    it('sees vi.mock(import(barrel), factory) — the form the runtime error recommends', () => {
        expect(
            violationsOf(mockCallFixture(`vi.mock(import('${barrelSpecifier}'), () => ({ Alpha: () => null }));`)).map(
                (violation) => violation.missing
            )
        ).toEqual([['Beta']]);
    });

    it('sees vi.doMock', () => {
        expect(
            violationsOf(mockCallFixture(`vi.doMock('${barrelSpecifier}', () => ({ Alpha: () => null }));`)).map(
                (violation) => violation.missing
            )
        ).toEqual([['Beta']]);
    });
});

describe('checkBarrelMockCoverage — the analysis cannot pass by deriving nothing', () => {
    const workingFixture = buildFixture({
        [barrel]: "export { Alpha } from './Alpha';\nexport { Beta } from './Beta';\n",
        'src/modules/Host/presentations/views/HostPanel.tsx': `import { Alpha, Beta } from '${barrelSpecifier}';\nexport const HostPanel = () => [Alpha, Beta];\n`,
        'src/modules/Host/presentations/views/__tests__/HostPanel.spec.tsx': `vi.mock('${barrelSpecifier}', () => ({ Alpha: () => null }));\nimport { HostPanel } from '../HostPanel';\n`,
    });

    it('a resolver that resolves nothing reports zero violations and zero derivation', () => {
        const blind = analyzeSpecs({ ...workingFixture, fileExists: () => false });

        expect({ violations: blind.violations.length, resolved: blind.resolvedMockCount }).toEqual({
            violations: 0,
            resolved: 0,
        });
        expect(analyzeSpecs(workingFixture).resolvedMockCount).toBe(1);
    });

    it('a reader that reads nothing reports zero violations and zero analysed specs', () => {
        const blind = analyzeSpecs({ ...workingFixture, readFacts: () => null });

        expect({ violations: blind.violations.length, analyzed: blind.analyzedSpecCount }).toEqual({
            violations: 0,
            analyzed: 0,
        });
        expect(analyzeSpecs(workingFixture).analyzedSpecCount).toBe(1);
    });

    it('a spec whose mocks the parser cannot see is reported, not silently skipped', () => {
        // An unclosed JSX element swallows everything after it as JSX text, so the
        // parser returns a tree with zero mock calls and never throws. This is the
        // shape that hid 9 of 12 mock calls in `persistCrdtProject.spec.ts` while
        // the file was being parsed as TSX; the scanner is what disagreed.
        const brokenFixture = buildFixture({
            [barrel]: "export { Alpha } from './Alpha';\n",
            'src/modules/Host/presentations/views/__tests__/HostPanel.spec.tsx': `const broken = <div>\nvi.mock('${barrelSpecifier}', () => ({ Alpha: () => null }));\n`,
        });
        const brokenPath = join(repoRoot, 'src/modules/Host/presentations/views/__tests__/HostPanel.spec.tsx');

        expect(analyzeSpecs(brokenFixture).extractionFailures).toEqual([brokenPath]);
        expect(
            readFileFacts(brokenPath, `vi.mock('${barrelSpecifier}', () => ({ Alpha: () => null }));\n`).mocks
        ).toHaveLength(1);
    });
});

describe('checkBarrelMockCoverage — the real tree', () => {
    it('has no presentations/views barrel mock that omits an export its graph imports', () => {
        const result = scanRepository();

        expect(
            result.violations.map((violation) => `${violation.spec.replace(`${sourceRoot}/`, '')}: ${violation.barrel}`)
        ).toEqual([]);
    });

    it('derived enough to have a verdict — no spec parses, resolves or walks to nothing', () => {
        const result = scanRepository();

        expect(result.extractionFailures).toEqual([]);
        // Floors, not pins: they separate "clean" from "measured nothing". Break
        // `fileExists`, `readFacts`, the parser or the glob and one of these is 0.
        expect(result.analyzedSpecCount).toBeGreaterThanOrEqual(5);
        expect(result.resolvedMockCount).toBeGreaterThanOrEqual(50);
        expect(result.graphNodeCount).toBeGreaterThanOrEqual(500);
    });

    /**
     * The ratchet over the three barrel kinds the gate does not block.
     *
     * A per-row baseline was refused, and that refusal was about a table whose only
     * content is "pre-existing" — 109 rows nobody reads, each needing exemption
     * semantics. It said nothing about a scalar, and without one nothing holds the
     * number at all: `--all` is invoked by no script, and the gate itself only ever
     * scans `presentations/views`. So the 109 could become 130 unnoticed.
     *
     * One assertion, no table: pair 110 reds, and every pair repaid is a free
     * ratchet down (lower the number in the same commit). The unit is the (spec,
     * barrel) pair, not the violation, because one pair is counted once per
     * consuming module and the pair is what a person actually fixes.
     */
    it('does not grow the ungated barrel-mock debt beyond its measured 127 pairs', () => {
        const result = scanRepository(allBarrelKinds);
        const pairs = new Set(result.violations.map((violation) => `${violation.spec} ${violation.barrel}`));

        expect(pairs.size).toBeLessThanOrEqual(127);
    });
});
