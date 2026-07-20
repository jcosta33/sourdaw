import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    collectLayoutOccurrences,
    compareLayoutCensuses,
    createLayoutCensus,
    renderLayoutCensusMarkdown,
    validateLayoutCensus,
    type LayoutCensus,
} from '../layoutPrimitivesCensus';

const fixtureRoots: string[] = [];

function createFixture(files: Record<string, string>): string {
    const repositoryRoot = mkdtempSync(join(tmpdir(), 'layout-census-'));
    fixtureRoots.push(repositoryRoot);

    for (const [file, contents] of Object.entries(files)) {
        const absolutePath = join(repositoryRoot, file);
        mkdirSync(dirname(absolutePath), { recursive: true });
        writeFileSync(absolutePath, contents);
    }

    return repositoryRoot;
}

function writeFixture(repositoryRoot: string, file: string, contents: string): void {
    const absolutePath = join(repositoryRoot, file);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, contents);
}

function cloneCensus(census: LayoutCensus): LayoutCensus {
    return structuredClone(census);
}

afterEach(() => {
    for (const fixtureRoot of fixtureRoots.splice(0)) {
        rmSync(fixtureRoot, { force: true, recursive: true });
    }
});

describe('collectLayoutOccurrences', () => {
    it('should count JSX layout attributes without counting comments or arbitrary strings', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': `
                const example = '<div className="flex flex-col">';
                export function App({ active }: { active: boolean }) {
                    return (
                        <>
                            {/* <div className="grid grid-cols-2" /> */}
                            <div className="relative flex flex-col gap-2 p-4" />
                            <div className={active ? 'flex' : 'grid'} />
                        </>
                    );
                }
            `,
        });

        const occurrences = collectLayoutOccurrences({ repositoryRoot });

        expect(occurrences).toHaveLength(2);
        expect(occurrences[0]).toMatchObject({
            currentPattern: 'relative flex flex-col gap-2 p-4',
            disposition: 'eligible',
            patternFamily: 'flex',
            proposedPrimitive: 'Stack',
        });
        expect(occurrences[1]).toMatchObject({
            disposition: 'responsive-or-dynamic',
            proposedPrimitive: null,
            riskFlags: { hasDynamicClassName: true },
        });
    });

    it('should exclude tests, snapshots, generated files, transient output, and nested worktrees', () => {
        const rawLayout = 'export const Item = () => <div className="flex" />;\n';
        const repositoryRoot = createFixture({
            '.agents/worktrees/other/src/Nested.tsx': rawLayout,
            'coverage/Coverage.tsx': rawLayout,
            'dist/Bundled.tsx': rawLayout,
            'src/Included.tsx': rawLayout,
            'src/__snapshots__/Included.snap.tsx': rawLayout,
            'src/__tests__/Included.spec.tsx': rawLayout,
            'src/generated/Bindings.tsx': rawLayout,
            'src/Generated.generated.tsx': rawLayout,
            'src/Included.test.tsx': rawLayout,
        });

        const occurrences = collectLayoutOccurrences({ repositoryRoot });

        expect(occurrences.map((occurrence) => occurrence.file)).toEqual(['src/Included.tsx']);
    });

    it('should classify primitives, wrappers, renderers, responsive forms, complex grids, and one-offs', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': `
                import { Row } from '#/components/layout';
                export function App() {
                    return (
                        <>
                            <Row gap={2} onClick={() => undefined} />
                            <section className="flex items-center gap-2" />
                            <button className="flex gap-1" onClick={() => undefined} />
                            <div className="absolute flex overflow-auto [&>*]:min-w-0" />
                            <div className="flex" aria-label="Toolbar" style={{ minWidth: 0 }} />
                        </>
                    );
                }
            `,
            'src/components/daw/DawRail.tsx': `
                export function DawRail() {
                    return <aside className="flex flex-col gap-2" aria-label="Tools" />;
                }
            `,
            'src/modules/Arrangement/presentations/CanvasRenderer.tsx': `
                export function CanvasRenderer() {
                    return <div className="flex"><canvas /></div>;
                }
            `,
            'src/modules/Arrangement/presentations/ComplexGrid.tsx': `
                export function ComplexGrid() {
                    return <div className="grid grid-cols-[auto_1fr] gap-2" />;
                }
            `,
            'src/modules/Arrangement/presentations/Responsive.tsx': `
                export function Responsive() {
                    return <div className="flex flex-col md:flex-row" />;
                }
            `,
            'src/modules/Arrangement/presentations/ContainerResponsive.tsx': `
                export function ContainerResponsive() {
                    return <div className="grid grid-cols-1 @md:grid-cols-2" />;
                }
            `,
        });

        const occurrences = collectLayoutOccurrences({ repositoryRoot });
        const byFile = new Map(occurrences.map((occurrence) => [`${occurrence.file}:${occurrence.line}`, occurrence]));
        const appRows = occurrences.filter((occurrence) => occurrence.file === 'src/App.tsx');

        expect(appRows[0]).toMatchObject({
            disposition: 'already-migrated',
            nativeElement: 'div',
            proposedPrimitive: 'Row',
            riskTier: 'high',
        });
        expect(appRows[1]).toMatchObject({ disposition: 'eligible', proposedPrimitive: 'Row' });
        expect(appRows[2]).toMatchObject({
            disposition: 'one-off',
            proposedPrimitive: null,
            riskFlags: { hasHandlers: true, hasSemanticElement: true },
            riskTier: 'high',
        });
        expect(appRows[3]).toMatchObject({
            disposition: 'one-off',
            proposedPrimitive: null,
            riskFlags: { hasChildSelectors: true, hasOverflow: true, hasPositioning: true },
            riskTier: 'high',
        });
        expect(appRows[4]).toMatchObject({
            disposition: 'one-off',
            proposedPrimitive: null,
            riskFlags: { hasInlineStyle: true, hasSemanticElement: true },
            riskTier: 'high',
        });
        expect(byFile.get('src/components/daw/DawRail.tsx:3')).toMatchObject({
            disposition: 'semantic-wrapper',
            wrapperOwner: 'DawRail',
        });
        expect(byFile.get('src/modules/Arrangement/presentations/CanvasRenderer.tsx:3')).toMatchObject({
            disposition: 'renderer',
        });
        expect(byFile.get('src/modules/Arrangement/presentations/ComplexGrid.tsx:3')).toMatchObject({
            disposition: 'complex-grid',
        });
        expect(byFile.get('src/modules/Arrangement/presentations/Responsive.tsx:3')).toMatchObject({
            disposition: 'responsive-or-dynamic',
        });
        expect(byFile.get('src/modules/Arrangement/presentations/ContainerResponsive.tsx:3')).toMatchObject({
            disposition: 'responsive-or-dynamic',
        });
    });

    it('should not mark custom component geometry or conditional space children eligible', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': `
                export function App({ visible }: { visible: boolean }) {
                    return (
                        <>
                            <CustomPanel className="flex flex-col gap-2" />
                            <div className="space-y-2">
                                {visible ? <span>Visible</span> : null}
                                <span>Always</span>
                            </div>
                            <div className="space-y-3">
                                <div className="hidden">Hidden</div>
                                <div>Visible</div>
                            </div>
                            <div className="space-y-4">
                                <>
                                    <span>First</span>
                                    <span>Second</span>
                                </>
                            </div>
                            <div className="space-y-5">
                                <CustomChild />
                                <span>Native child</span>
                            </div>
                            <div className="space-y-6">
                                <div className="mt-2">Own margin</div>
                                <div>Plain child</div>
                            </div>
                        </>
                    );
                }
            `,
        });

        const occurrences = collectLayoutOccurrences({ repositoryRoot });

        expect(occurrences[0]).toMatchObject({
            disposition: 'one-off',
            nativeElement: null,
            proposedPrimitive: null,
            riskFlags: { hasSemanticElement: true },
        });
        expect(occurrences[1]).toMatchObject({
            disposition: 'responsive-or-dynamic',
            proposedPrimitive: null,
            riskFlags: { hasConditionalChildren: true },
        });
        expect(occurrences[2]).toMatchObject({
            disposition: 'responsive-or-dynamic',
            proposedPrimitive: null,
            riskFlags: { hasConditionalChildren: true },
        });
        expect(occurrences[3]).toMatchObject({
            disposition: 'responsive-or-dynamic',
            proposedPrimitive: null,
            riskFlags: { hasConditionalChildren: true },
        });
        expect(occurrences[4]).toMatchObject({
            disposition: 'responsive-or-dynamic',
            proposedPrimitive: null,
            riskFlags: { hasConditionalChildren: true },
        });
        expect(occurrences[5]).toMatchObject({
            disposition: 'responsive-or-dynamic',
            proposedPrimitive: null,
            riskFlags: { hasConditionalChildren: true },
        });
    });
});

describe('compareLayoutCensuses', () => {
    it('should report added and removed source occurrences', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': 'export const App = () => <div className="flex" />;\n',
        });
        const baseline = createLayoutCensus({ repositoryRoot });

        writeFixture(
            repositoryRoot,
            'src/App.tsx',
            'export const App = () => <><div className="flex" /><div className="grid" /></>;\n'
        );
        const withAddition = createLayoutCensus({ repositoryRoot, previousCensus: baseline });
        const additionDrift = compareLayoutCensuses({ actual: withAddition, expected: baseline });

        expect(additionDrift.added).toHaveLength(1);
        expect(additionDrift.removed).toHaveLength(0);

        writeFixture(repositoryRoot, 'src/App.tsx', 'export const App = () => <span />;\n');
        const withRemoval = createLayoutCensus({ repositoryRoot, previousCensus: baseline });
        const removalDrift = compareLayoutCensuses({ actual: withRemoval, expected: baseline });

        expect(removalDrift.added).toHaveLength(0);
        expect(removalDrift.removed).toHaveLength(1);
    });

    it('should give a moved occurrence a new stable identity', () => {
        const repositoryRoot = createFixture({
            'src/Before.tsx': 'export const Item = () => <div className="flex" />;\n',
        });
        const baseline = createLayoutCensus({ repositoryRoot });

        writeFixture(repositoryRoot, 'src/Before.tsx', 'export const Item = () => <span />;\n');
        writeFixture(repositoryRoot, 'src/After.tsx', 'export const Item = () => <div className="flex" />;\n');
        const moved = createLayoutCensus({ repositoryRoot, previousCensus: baseline });
        const drift = compareLayoutCensuses({ actual: moved, expected: baseline });

        expect(drift.added).toHaveLength(1);
        expect(drift.removed).toHaveLength(1);
        expect(drift.added[0].id).not.toBe(drift.removed[0].id);
    });

    it('should report fingerprint changes without inheriting reviewed dispositions', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': 'export const App = () => <div className="flex gap-1" />;\n',
        });
        const baseline = createLayoutCensus({ repositoryRoot });
        baseline.occurrences[0].disposition = 'one-off';
        baseline.occurrences[0].rationale = 'Reviewed exception.';
        baseline.occurrences[0].reviewed = true;

        const unchanged = createLayoutCensus({ repositoryRoot, previousCensus: baseline });
        expect(unchanged.occurrences[0]).toMatchObject({
            disposition: 'one-off',
            rationale: 'Reviewed exception.',
            reviewed: true,
        });

        writeFixture(repositoryRoot, 'src/App.tsx', 'export const App = () => <div className="flex gap-2" />;\n');
        const changed = createLayoutCensus({ repositoryRoot, previousCensus: baseline });
        const drift = compareLayoutCensuses({ actual: changed, expected: baseline });

        expect(changed.occurrences[0].id).toBe(baseline.occurrences[0].id);
        expect(changed.occurrences[0].reviewed).toBe(false);
        expect(changed.occurrences[0].rationale).not.toBe('Reviewed exception.');
        expect(drift.changed).toHaveLength(1);
    });

    it('should fingerprint space-layout child structure before preserving review', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': `
                export const App = () => (
                    <div className="space-y-2">
                        <span>First</span>
                        <span>Second</span>
                    </div>
                );
            `,
        });
        const baseline = createLayoutCensus({ repositoryRoot });
        baseline.occurrences[0].reviewed = true;

        writeFixture(
            repositoryRoot,
            'src/App.tsx',
            `
                export const App = () => (
                    <div className="space-y-2">
                        <CustomChild />
                        <span>Second</span>
                    </div>
                );
            `
        );
        const changed = createLayoutCensus({ repositoryRoot, previousCensus: baseline });

        expect(changed.occurrences[0].id).toBe(baseline.occurrences[0].id);
        expect(changed.occurrences[0].sourceFingerprint).not.toBe(baseline.occurrences[0].sourceFingerprint);
        expect(changed.occurrences[0]).toMatchObject({
            disposition: 'responsive-or-dynamic',
            reviewed: false,
        });
    });
});

describe('layout census artifacts', () => {
    it('should generate deterministic sorted content with declared roots, exclusions, and summaries', () => {
        const repositoryRoot = createFixture({
            'src/Zed.tsx': 'export const Zed = () => <div className="grid grid-cols-2" />;\n',
            'src/Alpha.tsx': 'export const Alpha = () => <div className="flex flex-col gap-2" />;\n',
        });

        const first = createLayoutCensus({ repositoryRoot });
        const second = createLayoutCensus({ repositoryRoot, previousCensus: first });
        const serialized = JSON.stringify(first);

        expect(second).toEqual(first);
        expect(first.productionRoots).toEqual(['src']);
        expect(first.exclusions).toContain('**/__tests__/**');
        expect(first.occurrences.map((occurrence) => occurrence.file)).toEqual(['src/Alpha.tsx', 'src/Zed.tsx']);
        expect(first.summary).toMatchObject({
            occurrenceCount: 2,
            commonPatternClassCounts: {
                'flex-column': 1,
                'grid-columns': 1,
            },
        });
        expect(serialized).not.toContain(repositoryRoot);
        expect(serialized).not.toMatch(/generatedAt|timestamp/i);
    });

    it('should reject duplicate IDs, missing rationales, invalid dispositions, and generated drift', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': 'export const App = () => <><div className="flex" /><div className="grid" /></>;\n',
        });
        const census = createLayoutCensus({ repositoryRoot });
        const invalid = cloneCensus(census);
        invalid.occurrences[1].id = invalid.occurrences[0].id;
        invalid.occurrences[0].rationale = '';
        Reflect.set(invalid.occurrences[1], 'disposition', 'unsafe-guess');
        invalid.summary.occurrenceCount = 99;

        const errors = validateLayoutCensus(invalid);

        expect(errors).toEqual(
            expect.arrayContaining([
                expect.stringContaining('duplicate occurrence ID'),
                expect.stringContaining('missing rationale'),
                expect.stringContaining('invalid disposition'),
                expect.stringContaining('summary drift'),
            ])
        );
    });

    it('should render a stable human disposition ledger', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': 'export const App = () => <div className="flex flex-col gap-2" />;\n',
        });
        const census = createLayoutCensus({ repositoryRoot });

        const markdown = renderLayoutCensusMarkdown(census);

        expect(markdown).toContain('# Layout primitives census');
        expect(markdown).toContain('Production roots: `src`');
        expect(markdown).toContain(
            '| Stable ID | File:line | Pattern | Primitive | Disposition | Reviewed | Rationale |'
        );
        expect(markdown).toContain('flex flex-col gap-2');
    });
});
