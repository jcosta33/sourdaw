import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadTestSideGraph, selectTestSideSpecs, type TestSideGraph } from '../e2eTestSideGraph';

import type { SourceNode } from '../e2eAffectedGraph';

const SMOKE = 'tests/e2e/smoke.spec.ts';
const EXPORT_SPEC = 'tests/e2e/exportDialog.spec.ts';
const IMPORT_SPEC = 'tests/e2e/importDialog.spec.ts';
const MIXER_SPEC = 'tests/e2e/mixer.spec.ts';
const HELPER = 'tests/e2e/chosenProjectDirectory.ts';
const NESTED = 'tests/e2e/helpers/startupRecoveryEvidence.ts';
const SHARED = 'tests/e2e/sharedEvidence.ts';
const SETUP = 'tests/e2e/firstPaintWarmup.ts';
const FIXTURE = 'src/modules/AudioRendering/useCases/audioExport/__tests__/wavReportFixtures.ts';
const PRODUCT = 'src/modules/AudioRendering/useCases/audioExport/writeReport.ts';
const SPECS = [SMOKE, EXPORT_SPEC, IMPORT_SPEC, MIXER_SPEC];

function node(source: string, ...resolved: string[]): SourceNode {
    return { source, dependencies: resolved.map((target) => ({ resolved: target })) };
}

function graphOf(nodes: SourceNode[], references: { file: string; text: string }[] = []): TestSideGraph {
    return { kind: 'graph', graph: nodes, references };
}

const BASE: SourceNode[] = [
    node(SMOKE),
    node(EXPORT_SPEC, HELPER, NESTED),
    node(IMPORT_SPEC, HELPER),
    node(MIXER_SPEC, SHARED),
    node(HELPER),
    node(NESTED, SHARED),
    node(SHARED),
    node(PRODUCT),
];

describe('test-side module selection', () => {
    it('selects exactly the specs that import a helper', () => {
        expect(selectTestSideSpecs([HELPER], SPECS, graphOf(BASE))).toEqual([
            { path: HELPER, kind: 'specs', specs: [EXPORT_SPEC, IMPORT_SPEC] },
        ]);
    });

    it('follows transitive imports to every reaching spec', () => {
        expect(selectTestSideSpecs([SHARED], SPECS, graphOf(BASE))).toEqual([
            { path: SHARED, kind: 'specs', specs: [EXPORT_SPEC, MIXER_SPEC] },
        ]);
    });

    it('widens a helper no module imports', () => {
        const orphan = 'tests/e2e/orphan.ts';
        expect(selectTestSideSpecs([orphan], SPECS, graphOf([...BASE, node(orphan)]))).toEqual([
            { path: orphan, kind: 'full', reason: 'imported by no browser spec' },
        ]);
    });

    it('widens a helper a non-spec root such as the Playwright config loads', () => {
        const nodes = [...BASE, node('playwright.config.ts', HELPER)];
        expect(selectTestSideSpecs([HELPER], SPECS, graphOf(nodes))).toEqual([
            { path: HELPER, kind: 'full', reason: 'loaded outside browser specs: playwright.config.ts' },
        ]);
    });

    it('widens a helper that a page or config names by path', () => {
        const nodes = [...BASE, node(SETUP)];
        const references = [{ file: 'playwright.config.ts', text: './tests/e2e/firstPaintWarmup.ts' }];
        expect(selectTestSideSpecs([SETUP], SPECS, graphOf(nodes, references))).toEqual([
            { path: SETUP, kind: 'full', reason: 'loaded by path from playwright.config.ts' },
        ]);
        const page = [{ file: 'tests/e2e/probe.html', text: `<script src="/${FIXTURE}"></script>` }];
        const fixtureNodes = [...BASE, node(FIXTURE)];
        expect(selectTestSideSpecs([FIXTURE], SPECS, graphOf(fixtureNodes, page))).toEqual([
            { path: FIXTURE, kind: 'full', reason: 'loaded by path from tests/e2e/probe.html' },
        ]);
    });

    it('widens when a reaching spec is not collected', () => {
        const stale = 'tests/e2e/retired.spec.ts';
        const nodes = [...BASE, node(stale, HELPER)];
        expect(selectTestSideSpecs([HELPER], SPECS, graphOf(nodes))).toEqual([
            { path: HELPER, kind: 'full', reason: `reaching spec is not collected: ${stale}` },
        ]);
        const production = 'tests/production-e2e/export.e2e.spec.ts';
        expect(selectTestSideSpecs([HELPER], SPECS, graphOf([...BASE, node(production, HELPER)]))).toEqual([
            { path: HELPER, kind: 'full', reason: `loaded outside browser specs: ${production}` },
        ]);
    });

    it('selects the spec that reaches a src test fixture', () => {
        const nodes = [...BASE, node(FIXTURE, PRODUCT), node('tests/e2e/exportReport.ts', FIXTURE)];
        nodes[1] = node(EXPORT_SPEC, HELPER, NESTED, 'tests/e2e/exportReport.ts');
        expect(selectTestSideSpecs([FIXTURE], SPECS, graphOf(nodes))).toEqual([
            { path: FIXTURE, kind: 'specs', specs: [EXPORT_SPEC] },
        ]);
    });

    it('routes a src test fixture no browser spec reaches to no browser spec', () => {
        const sibling = 'src/modules/AudioRendering/useCases/audioExport/__tests__/toneSource.ts';
        const nodes = [...BASE, node(FIXTURE, sibling, PRODUCT), node(sibling)];
        expect(selectTestSideSpecs([FIXTURE, sibling], SPECS, graphOf(nodes))).toEqual([
            { path: FIXTURE, kind: 'specs', specs: [] },
            { path: sibling, kind: 'specs', specs: [] },
        ]);
    });

    it('leaves a test-side file that product code imports on its existing route', () => {
        const nodes = [...BASE, node(FIXTURE), node('src/app/bootstrap.ts', FIXTURE)];
        expect(selectTestSideSpecs([FIXTURE], SPECS, graphOf(nodes))).toEqual([]);
        const viaHelper = [...BASE.filter((entry) => entry.source !== PRODUCT), node(PRODUCT, NESTED)];
        expect(selectTestSideSpecs([SHARED], SPECS, graphOf(viaHelper))).toEqual([]);
    });

    it('ignores paths that are not test-side modules', () => {
        const paths = [
            'tests/e2e/fixtures/project.json',
            'tests/e2e/fixtures/kick.wav',
            EXPORT_SPEC,
            PRODUCT,
            'src/modules/AudioRendering/useCases/audioExport/__tests__/writeReport.spec.ts',
            'tests/e2e/types.d.ts',
        ];
        expect(selectTestSideSpecs(paths, SPECS, graphOf(BASE))).toEqual([]);
    });

    it('widens every test-side module when the graph fails or cannot be trusted', () => {
        expect(selectTestSideSpecs([HELPER, PRODUCT], SPECS, { kind: 'full', reason: 'graph failed' })).toEqual([
            { path: HELPER, kind: 'full', reason: 'graph failed' },
        ]);
        const unresolved: SourceNode[] = [
            ...BASE.slice(1),
            { source: SMOKE, dependencies: [{ resolved: './gone', module: './gone', couldNotResolve: true }] },
        ];
        expect(selectTestSideSpecs([HELPER], SPECS, graphOf(unresolved))).toEqual([
            { path: HELPER, kind: 'full', reason: `unresolved test-side import in ${SMOKE}` },
        ]);
        expect(selectTestSideSpecs([HELPER], SPECS, graphOf([...BASE, node(HELPER, SHARED)]))).toEqual([
            { path: HELPER, kind: 'full', reason: 'malformed test-side dependency graph' },
        ]);
        expect(selectTestSideSpecs(['tests/e2e/absent.ts'], SPECS, graphOf(BASE))).toEqual([
            { path: 'tests/e2e/absent.ts', kind: 'full', reason: 'absent from the test-side dependency graph' },
        ]);
    });
});

describe('test-side graph loader', () => {
    it('resolves aliases and relative imports from the test and product trees', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-test-side-'));
        const unitOnly = 'src/modules/AudioRendering/useCases/audioExport/__tests__/toneSource.ts';
        const unitSpec = 'src/modules/AudioRendering/useCases/audioExport/__tests__/writeReport.spec.ts';
        const files: Record<string, string> = {
            'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '#/*': ['./src/*'] } } }),
            'playwright.config.ts':
                "import { devServerOnly } from './tests/e2e/devServerOnly';\nexport default { globalSetup: './tests/e2e/firstPaintWarmup.ts', devServerOnly };\n",
            [PRODUCT]: 'export const writeReport = 1;\n',
            [FIXTURE]:
                "import { writeReport } from '#/modules/AudioRendering/useCases/audioExport/writeReport';\nexport const fixture = writeReport;\n",
            [unitOnly]: 'export const tone = 1;\n',
            [unitSpec]: "import { tone } from './toneSource';\nexport const used = tone;\n",
            [SMOKE]: "import { test } from '@playwright/test';\ntest('smoke', () => {});\n",
            [EXPORT_SPEC]:
                "import { chosen } from './chosenProjectDirectory';\nimport { fixture } from '../../src/modules/AudioRendering/useCases/audioExport/__tests__/wavReportFixtures';\nexport const used = [chosen, fixture];\n",
            [IMPORT_SPEC]: "import { chosen } from './chosenProjectDirectory';\nexport const used = chosen;\n",
            [MIXER_SPEC]:
                "import { evidence } from './helpers/startupRecoveryEvidence';\nexport const used = evidence;\n",
            [HELPER]: 'export const chosen = 1;\n',
            [NESTED]: "import { shared } from '../sharedEvidence';\nexport const evidence = shared;\n",
            [SHARED]: 'export const shared = 1;\n',
            [SETUP]: 'export default async function setup() {}\n',
            'tests/e2e/devServerOnly.ts': 'export const devServerOnly = [];\n',
            'tests/e2e/probe.html': '<script type="module" src="/tests/e2e/pageEntry.ts"></script>\n',
            'tests/e2e/pageEntry.ts': "import { shared } from './sharedEvidence';\nexport const entry = shared;\n",
        };
        try {
            for (const [path, content] of Object.entries(files)) {
                mkdirSync(dirname(join(root, path)), { recursive: true });
                writeFileSync(join(root, path), content);
            }
            const graph = await loadTestSideGraph(root);
            expect(graph.kind).toBe('graph');
            const changed = [HELPER, NESTED, FIXTURE, unitOnly, SETUP, 'tests/e2e/devServerOnly.ts', SHARED];
            expect(selectTestSideSpecs(changed, SPECS, graph)).toEqual([
                { path: HELPER, kind: 'specs', specs: [EXPORT_SPEC, IMPORT_SPEC] },
                { path: NESTED, kind: 'specs', specs: [MIXER_SPEC] },
                { path: FIXTURE, kind: 'specs', specs: [EXPORT_SPEC] },
                { path: unitOnly, kind: 'specs', specs: [] },
                { path: SETUP, kind: 'full', reason: 'loaded by path from playwright.config.ts' },
                {
                    path: 'tests/e2e/devServerOnly.ts',
                    kind: 'full',
                    reason: 'loaded outside browser specs: playwright.config.ts',
                },
                { path: SHARED, kind: 'full', reason: 'loaded outside browser specs: tests/e2e/pageEntry.ts' },
            ]);
            writeFileSync(join(root, PRODUCT), "import './__tests__/toneSource';\n");
            expect(selectTestSideSpecs([unitOnly], SPECS, await loadTestSideGraph(root))).toEqual([]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }, 30_000);

    it('fails closed when the test tree or its graph is unavailable', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-test-side-missing-'));
        try {
            expect(await loadTestSideGraph(root)).toEqual({ kind: 'full', reason: 'test tree is missing' });
            mkdirSync(join(root, 'tests/e2e'), { recursive: true });
            writeFileSync(join(root, 'tests/e2e/smoke.spec.ts'), 'export {};\n');
            writeFileSync(join(root, 'tsconfig.json'), '{ "extends": "./missing.json" }');
            expect(await loadTestSideGraph(root)).toMatchObject({ kind: 'full' });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }, 30_000);
});
