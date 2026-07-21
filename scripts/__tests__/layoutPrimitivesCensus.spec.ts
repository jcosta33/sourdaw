import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import * as layoutCensusModule from '../layoutPrimitivesCensus';
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

    it('should recognize structural and text semantic intrinsic elements', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': `
                export const App = () => (
                    <>
                        <aside className="flex" />
                        <dl className="flex" />
                        <footer className="flex" />
                        <header className="flex" />
                        <kbd className="flex" />
                        <nav className="flex" />
                        <section className="flex" />
                    </>
                );
            `,
        });

        const occurrences = collectLayoutOccurrences({ repositoryRoot });

        expect(occurrences).toHaveLength(7);
        expect(occurrences.map((occurrence) => occurrence.nativeElement)).toEqual([
            'aside',
            'dl',
            'footer',
            'header',
            'kbd',
            'nav',
            'section',
        ]);
        expect(
            occurrences.every((occurrence) => occurrence.riskFlags.hasSemanticElement && occurrence.riskTier === 'high')
        ).toBe(true);
    });

    it('should recognize every semantic intrinsic family used by layout candidates', () => {
        const semanticTags = [
            'a',
            'abbr',
            'address',
            'area',
            'article',
            'aside',
            'audio',
            'b',
            'base',
            'bdi',
            'bdo',
            'blockquote',
            'body',
            'br',
            'button',
            'canvas',
            'caption',
            'cite',
            'code',
            'col',
            'colgroup',
            'data',
            'datalist',
            'dd',
            'del',
            'details',
            'dfn',
            'dialog',
            'dl',
            'dt',
            'em',
            'embed',
            'fieldset',
            'figcaption',
            'figure',
            'footer',
            'form',
            'h1',
            'h2',
            'h3',
            'h4',
            'h5',
            'h6',
            'head',
            'header',
            'hgroup',
            'hr',
            'html',
            'i',
            'iframe',
            'img',
            'input',
            'ins',
            'kbd',
            'label',
            'legend',
            'li',
            'link',
            'main',
            'map',
            'mark',
            'math',
            'menu',
            'meta',
            'meter',
            'nav',
            'noscript',
            'object',
            'ol',
            'optgroup',
            'option',
            'output',
            'p',
            'param',
            'picture',
            'pre',
            'progress',
            'q',
            'rp',
            'rt',
            'ruby',
            's',
            'samp',
            'script',
            'search',
            'section',
            'select',
            'slot',
            'small',
            'source',
            'strong',
            'style',
            'sub',
            'summary',
            'sup',
            'svg',
            'table',
            'tbody',
            'td',
            'template',
            'textarea',
            'tfoot',
            'th',
            'thead',
            'time',
            'title',
            'tr',
            'track',
            'u',
            'ul',
            'var',
            'video',
            'wbr',
        ];
        const semanticElements = semanticTags.map((tag) => `<${tag} className="flex" />`).join('\n');
        const repositoryRoot = createFixture({
            'src/App.tsx': `
                export const App = () => (
                    <>
                        ${semanticElements}
                    </>
                );
            `,
        });

        const occurrences = collectLayoutOccurrences({ repositoryRoot });

        expect(occurrences.map((occurrence) => occurrence.nativeElement)).toEqual(semanticTags);
        expect(
            occurrences.every((occurrence) => occurrence.riskFlags.hasSemanticElement && occurrence.riskTier === 'high')
        ).toBe(true);
    });

    it('should resolve same-file class-name bindings into layout evidence', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': `
                const rootClassName = 'flex flex-col gap-2';
                export const App = () => <section className={rootClassName} />;
            `,
        });

        const occurrences = collectLayoutOccurrences({ repositoryRoot });

        expect(occurrences).toHaveLength(1);
        expect(occurrences[0]).toMatchObject({
            disposition: 'eligible',
            proposedPrimitive: 'Stack',
            riskFlags: { hasDynamicClassName: false, hasSemanticElement: true },
            riskTier: 'high',
        });
        expect(occurrences[0].currentPattern).toContain('flex flex-col gap-2');
    });

    it('should resolve imported class constants into layout evidence', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': `
                import { ROOT_CLASS_NAME } from './layoutClasses';
                export const App = () => <div className={ROOT_CLASS_NAME} />;
            `,
            'src/layoutClasses.ts': `
                export const ROOT_CLASS_NAME = 'grid grid-cols-2 gap-2';
            `,
        });

        const occurrences = collectLayoutOccurrences({ repositoryRoot });

        expect(occurrences).toHaveLength(1);
        expect(occurrences[0]).toMatchObject({
            disposition: 'eligible',
            proposedPrimitive: 'Grid',
            riskFlags: { hasDynamicClassName: false },
        });
        expect(occurrences[0].currentPattern).toContain('grid grid-cols-2 gap-2');
    });

    it('should treat lexically shadowed immutable bindings as unresolved', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': `
                const ROOT = 'flex flex-col';
                export function App(ROOT: string) {
                    return <div className={ROOT} />;
                }
            `,
        });

        const occurrences = collectLayoutOccurrences({ repositoryRoot });

        expect(occurrences).toHaveLength(1);
        expect(occurrences[0]).toMatchObject({
            currentPattern: '{ROOT}',
            disposition: 'responsive-or-dynamic',
            proposedPrimitive: null,
            riskFlags: { hasDynamicClassName: true },
        });
    });

    it('should conservatively stop at non-const and destructured lexical shadows', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': `
                import { ROOT } from './classes';
                export function Parameter({ ROOT }: { ROOT: string }) {
                    return <div className={ROOT} />;
                }
                export function Local() {
                    let ROOT = 'flex flex-col';
                    return <div className={ROOT} />;
                }
                export function FunctionShadow() {
                    function ROOT() {}
                    return <div className={ROOT} />;
                }
            `,
            'src/classes.ts': `export const ROOT = 'grid grid-cols-2';`,
        });

        const occurrences = collectLayoutOccurrences({ repositoryRoot });

        expect(occurrences).toHaveLength(3);
        expect(
            occurrences.every(
                (occurrence) =>
                    occurrence.currentPattern === '{ROOT}' &&
                    occurrence.disposition === 'responsive-or-dynamic' &&
                    occurrence.proposedPrimitive === null &&
                    occurrence.riskFlags.hasDynamicClassName
            )
        ).toBe(true);
    });

    it('should stop imported lookup at switch and named class-expression shadows', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': `
                import { ROOT } from './classes';
                export const ClassOwner = class ROOT {
                    render() {
                        return <div className={ROOT} />;
                    }
                };
                export function SwitchOwner(value: string) {
                    switch (value) {
                        case 'layout':
                            const ROOT = value;
                            return <div className={ROOT} />;
                        default:
                            return null;
                    }
                }
            `,
            'src/classes.ts': `export const ROOT = 'grid grid-cols-2';`,
        });

        const occurrences = collectLayoutOccurrences({ repositoryRoot });

        expect(occurrences).toHaveLength(2);
        expect(
            occurrences.every(
                (occurrence) =>
                    occurrence.currentPattern === '{ROOT}' &&
                    occurrence.disposition === 'responsive-or-dynamic' &&
                    occurrence.proposedPrimitive === null &&
                    occurrence.riskFlags.hasDynamicClassName
            )
        ).toBe(true);
    });

    it('should apply imported primitive and wrapper provenance only to active lexical bindings', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': `
                import { Row, Stack as Column } from '#/components/layout';
                import * as Layout from '#/components/layout';
                import { DawPanelSurface as Surface } from '#/components/daw';

                export function ParameterOwner(Row: unknown) {
                    return <Row className="flex" />;
                }

                export function BlockOwner() {
                    {
                        const Column = () => null;
                        return <Column className="flex flex-col" />;
                    }
                }

                export function SwitchOwner(value: string) {
                    switch (value) {
                        case 'layout':
                            const Layout = { Grid: () => null };
                            return <Layout.Grid className="grid" />;
                        default:
                            return null;
                    }
                }

                export const ClassOwner = class Surface {
                    render() {
                        return <Surface className="flex" />;
                    }
                };
            `,
        });

        const occurrences = collectLayoutOccurrences({ repositoryRoot });

        expect(
            occurrences.map(({ disposition, nativeElement, proposedPrimitive, wrapperOwner }) => ({
                disposition,
                nativeElement,
                proposedPrimitive,
                wrapperOwner,
            }))
        ).toEqual([
            {
                disposition: 'semantic-wrapper',
                nativeElement: null,
                proposedPrimitive: null,
                wrapperOwner: 'Row',
            },
            {
                disposition: 'semantic-wrapper',
                nativeElement: null,
                proposedPrimitive: null,
                wrapperOwner: 'Column',
            },
            {
                disposition: 'semantic-wrapper',
                nativeElement: null,
                proposedPrimitive: null,
                wrapperOwner: 'Layout.Grid',
            },
            {
                disposition: 'semantic-wrapper',
                nativeElement: null,
                proposedPrimitive: null,
                wrapperOwner: 'Surface',
            },
        ]);
    });

    it('should omit inactive default and namespace imports from custom tag fingerprints', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': `
                import Panel from './PanelA';
                import * as Panels from './PanelsA';

                export function DefaultShadow(Panel: unknown) {
                    return <Panel className="flex" />;
                }

                export function NamespaceShadow() {
                    const Panels = { Shell: () => null };
                    return <Panels.Shell className="flex" />;
                }
            `,
        });
        const baseline = createLayoutCensus({ repositoryRoot });
        for (const occurrence of baseline.occurrences) {
            occurrence.reviewed = true;
        }

        writeFixture(
            repositoryRoot,
            'src/App.tsx',
            `
                import Panel from './PanelB';
                import * as Panels from './PanelsB';

                export function DefaultShadow(Panel: unknown) {
                    return <Panel className="flex" />;
                }

                export function NamespaceShadow() {
                    const Panels = { Shell: () => null };
                    return <Panels.Shell className="flex" />;
                }
            `
        );
        const changed = createLayoutCensus({ repositoryRoot, previousCensus: baseline });
        const drift = compareLayoutCensuses({ actual: changed, expected: baseline });

        expect(changed.occurrences.map((occurrence) => occurrence.sourceFingerprint)).toEqual(
            baseline.occurrences.map((occurrence) => occurrence.sourceFingerprint)
        );
        expect(changed.occurrences.every((occurrence) => occurrence.reviewed)).toBe(true);
        expect(drift.changed).toHaveLength(0);
    });

    it('should reject imported bindings reached through a symlinked repository ancestor', () => {
        const externalRoot = createFixture({
            'classes.ts': `export const ROOT = 'grid grid-cols-2';`,
        });
        const repositoryRoot = createFixture({
            'src/App.tsx': `
                import { ROOT } from './linked/classes';
                export const App = () => <div className={ROOT} />;
            `,
        });
        symlinkSync(externalRoot, join(repositoryRoot, 'src/linked'), 'dir');

        const occurrences = collectLayoutOccurrences({ repositoryRoot });

        expect(occurrences).toHaveLength(1);
        expect(occurrences[0]).toMatchObject({
            currentPattern: '{ROOT}',
            disposition: 'responsive-or-dynamic',
            proposedPrimitive: null,
            riskFlags: { hasDynamicClassName: true },
        });
    });

    it('should record unresolved class-name bindings without inventing layout tokens', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': `
                export function App({ className }: { className: string }) {
                    return <div className={className} />;
                }
            `,
        });

        const occurrences = collectLayoutOccurrences({ repositoryRoot });

        expect(occurrences).toHaveLength(1);
        expect(occurrences[0]).toMatchObject({
            currentPattern: '{className}',
            disposition: 'responsive-or-dynamic',
            patternFamily: 'alignment',
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
                            <div className="gap-1" />
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
            disposition: 'eligible',
            proposedPrimitive: 'Row',
            riskFlags: { hasHandlers: true, hasSemanticElement: true },
            riskTier: 'high',
        });
        expect(appRows[3]).toMatchObject({
            disposition: 'eligible',
            proposedPrimitive: 'Row',
            riskFlags: { hasChildSelectors: true, hasOverflow: true, hasPositioning: true },
            riskTier: 'high',
        });
        expect(appRows[4]).toMatchObject({
            disposition: 'eligible',
            proposedPrimitive: 'Row',
            riskFlags: { hasInlineStyle: true, hasSemanticElement: true },
            riskTier: 'high',
        });
        expect(appRows[5]).toMatchObject({
            disposition: 'one-off',
            proposedPrimitive: null,
            riskTier: 'high',
        });
        expect(appRows[5].rationale).toBe(
            'This bespoke layout has no supported flex, stack, or grid primitive mapping.'
        );
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

    it.each(['hover:flex', 'focus:grid', 'dark:flex-col', 'motion-reduce:grid', 'supports-[display:grid]:grid'])(
        'should classify modifier-bearing layout token %s as responsive or dynamic',
        (className) => {
            const repositoryRoot = createFixture({
                'src/App.tsx': `export const App = () => <div className="${className}" />;\n`,
            });

            const occurrences = collectLayoutOccurrences({ repositoryRoot });

            expect(occurrences).toHaveLength(1);
            expect(occurrences[0]).toMatchObject({
                disposition: 'responsive-or-dynamic',
                proposedPrimitive: null,
                riskFlags: { hasResponsiveClasses: true },
            });
        }
    );

    it('should trust static as only on audited polymorphic primitives and keep bound as unknown', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': `
                import { Row, Spacer } from '#/components/layout';
                const STATIC_TAG = 'section';
                export function App({ tag }: { tag: 'div' | 'section' }) {
                    return (
                        <>
                            <CustomPanel as="section" className="flex" />
                            <Row as="section" className="flex" />
                            <Spacer as="section" className="flex" />
                            <Row as={tag} className="flex" />
                            <Row as={STATIC_TAG} className="flex" />
                        </>
                    );
                }
            `,
        });

        const occurrences = collectLayoutOccurrences({ repositoryRoot });

        expect(occurrences).toHaveLength(5);
        expect(occurrences[0]).toMatchObject({
            disposition: 'semantic-wrapper',
            nativeElement: null,
            wrapperOwner: 'CustomPanel',
            riskFlags: { hasDynamicElement: false },
        });
        expect(occurrences[1]).toMatchObject({
            disposition: 'already-migrated',
            nativeElement: 'section',
            proposedPrimitive: 'Row',
            riskFlags: { hasDynamicElement: false },
        });
        for (const occurrence of occurrences.slice(2)) {
            expect(occurrence).toMatchObject({
                disposition: 'responsive-or-dynamic',
                nativeElement: null,
                proposedPrimitive: null,
                riskFlags: { hasDynamicElement: true },
            });
        }
    });

    it('should keep a static scrollable semantic rail eligible for Stack migration', () => {
        const repositoryRoot = createFixture({
            'src/Rail.tsx': `
                export function Rail() {
                    return <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1" />;
                }
            `,
        });

        const occurrences = collectLayoutOccurrences({ repositoryRoot });

        expect(occurrences).toHaveLength(1);
        expect(occurrences[0]).toMatchObject({
            disposition: 'eligible',
            nativeElement: 'aside',
            proposedPrimitive: 'Stack',
            riskFlags: {
                hasOverflow: true,
            },
            riskTier: 'high',
        });
        expect(occurrences[0].rationale).toContain('Stack');
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
            disposition: 'semantic-wrapper',
            nativeElement: null,
            proposedPrimitive: null,
            riskFlags: { hasSemanticElement: true },
            wrapperOwner: 'CustomPanel',
        });
        expect(occurrences[0].rationale).toBe(
            'Preserve the CustomPanel component contract and review its geometry through that owner.'
        );
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

    it('should scope canvas renderer ownership without classifying neighboring owners', () => {
        const repositoryRoot = createFixture({
            'src/Surfaces.tsx': `
                export function CanvasSurface() {
                    return <div className="flex"><canvas /></div>;
                }

                export function Toolbar() {
                    return <div className="flex" />;
                }
            `,
        });

        const occurrences = collectLayoutOccurrences({ repositoryRoot });

        expect(occurrences).toHaveLength(2);
        expect(occurrences[0]).toMatchObject({ disposition: 'renderer', proposedPrimitive: null });
        expect(occurrences[1]).toMatchObject({ disposition: 'eligible', proposedPrimitive: 'Row' });
    });

    it('should detect layout tokens used as dynamic class-helper object keys', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': `
                import { clsx } from 'clsx';
                export const App = ({ active }: { active: boolean }) => (
                    <div className={clsx({ flex: active, grid: !active })} />
                );
            `,
        });

        const baseline = createLayoutCensus({ repositoryRoot });

        expect(baseline.occurrences).toHaveLength(1);
        expect(baseline.occurrences[0]).toMatchObject({
            disposition: 'responsive-or-dynamic',
            proposedPrimitive: null,
            reviewed: false,
            riskFlags: { hasDynamicClassName: true },
        });
    });

    it('should keep conditional display variants and prefixed child visibility non-eligible', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': `
                export function App() {
                    return (
                        <>
                            <div className="hidden group-hover:flex" />
                            <div className="space-y-2">
                                <div className="md:hidden">Conditional</div>
                                <div>Always</div>
                            </div>
                        </>
                    );
                }
            `,
        });

        const occurrences = collectLayoutOccurrences({ repositoryRoot });

        expect(occurrences).toHaveLength(2);
        expect(occurrences[0]).toMatchObject({
            disposition: 'responsive-or-dynamic',
            proposedPrimitive: null,
            riskFlags: { hasResponsiveClasses: true },
        });
        expect(occurrences[1]).toMatchObject({
            disposition: 'responsive-or-dynamic',
            proposedPrimitive: null,
            riskFlags: { hasConditionalChildren: true },
        });
    });

    it('should preserve semantic risk for custom member tags and dynamic role attributes', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': `
                export function App({ role }: { role: string }) {
                    return (
                        <>
                            <motion.div className="flex" />
                            <div className="flex" role={role} />
                        </>
                    );
                }
            `,
        });

        const occurrences = collectLayoutOccurrences({ repositoryRoot });

        expect(occurrences).toHaveLength(2);
        expect(occurrences[0]).toMatchObject({
            disposition: 'semantic-wrapper',
            nativeElement: null,
            proposedPrimitive: null,
            riskFlags: { hasSemanticElement: true },
            wrapperOwner: 'motion.div',
        });
        expect(occurrences[0].rationale).toContain('motion.div');
        expect(occurrences[1]).toMatchObject({
            disposition: 'one-off',
            nativeElement: 'div',
            proposedPrimitive: null,
            role: null,
            riskFlags: { hasSemanticElement: true },
        });
        expect(occurrences[1].rationale).toBe(
            'Runtime role semantics require owner-specific characterization before primitive migration.'
        );
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

    it('should invalidate review when a primitive as binding changes', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': `
                import { Row } from '#/components/layout';
                const TAG = 'section';
                export const App = () => <Row as={TAG} />;
            `,
        });
        const baseline = createLayoutCensus({ repositoryRoot });
        baseline.occurrences[0].reviewed = true;

        writeFixture(
            repositoryRoot,
            'src/App.tsx',
            `
                import { Row } from '#/components/layout';
                const TAG = 'article';
                export const App = () => <Row as={TAG} />;
            `
        );
        const changed = createLayoutCensus({ repositoryRoot, previousCensus: baseline });

        expect(changed.occurrences[0].id).toBe(baseline.occurrences[0].id);
        expect(changed.occurrences[0].sourceFingerprint).not.toBe(baseline.occurrences[0].sourceFingerprint);
        expect(changed.occurrences[0]).toMatchObject({
            disposition: 'responsive-or-dynamic',
            nativeElement: null,
            reviewed: false,
            riskFlags: { hasDynamicElement: true },
        });
    });

    it('should invalidate review when semantic ancestor context changes', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': 'export const App = () => <section><div><span className="flex" /></div></section>;\n',
        });
        const baseline = createLayoutCensus({ repositoryRoot });
        baseline.occurrences[0].reviewed = true;

        writeFixture(
            repositoryRoot,
            'src/App.tsx',
            'export const App = () => <nav><div><span className="flex" /></div></nav>;\n'
        );
        const changed = createLayoutCensus({ repositoryRoot, previousCensus: baseline });
        const drift = compareLayoutCensuses({ actual: changed, expected: baseline });

        expect(changed.occurrences[0].id).toBe(baseline.occurrences[0].id);
        expect(changed.occurrences[0].sourceFingerprint).not.toBe(baseline.occurrences[0].sourceFingerprint);
        expect(changed.occurrences[0].reviewed).toBe(false);
        expect(drift.changed).toHaveLength(1);
    });

    it.each([
        ['ARIA', 'aria-live="polite"', 'aria-live="assertive"'],
        ['focus', 'tabIndex={0}', 'tabIndex={-1}'],
        ['editability', 'contentEditable={false}', 'contentEditable'],
        ['drag', 'draggable={false}', 'draggable'],
        ['link', 'href="/before"', 'href="/after"'],
        ['label', 'htmlFor="before"', 'htmlFor="after"'],
        ['role', 'role="status"', 'role="alert"'],
    ])('should invalidate review when a generic ancestor changes %s semantics', (_name, before, after) => {
        const repositoryRoot = createFixture({
            'src/App.tsx': `export const App = () => <div ${before}><span className="flex" /></div>;\n`,
        });
        const baseline = createLayoutCensus({ repositoryRoot });
        baseline.occurrences[0].reviewed = true;

        writeFixture(
            repositoryRoot,
            'src/App.tsx',
            `export const App = () => <div ${after}><span className="flex" /></div>;\n`
        );
        const changed = createLayoutCensus({ repositoryRoot, previousCensus: baseline });
        const drift = compareLayoutCensuses({ actual: changed, expected: baseline });

        expect(changed.occurrences[0].id).toBe(baseline.occurrences[0].id);
        expect(changed.occurrences[0].sourceFingerprint).not.toBe(baseline.occurrences[0].sourceFingerprint);
        expect(changed.occurrences[0].reviewed).toBe(false);
        expect(drift.changed).toHaveLength(1);
    });

    it.each([
        ['ARIA', 'aria-live', "'polite'", "'assertive'"],
        ['focus', 'tabIndex', '0', '-1'],
        ['editability', 'contentEditable', 'false', 'true'],
        ['drag', 'draggable', 'false', 'true'],
        ['link', 'href', "'/before'", "'/after'"],
        ['label', 'htmlFor', "'before'", "'after'"],
        ['role', 'role', "'status'", "'alert'"],
    ])(
        'should invalidate review when a bound generic ancestor changes %s semantics',
        (_name, attribute, before, after) => {
            const repositoryRoot = createFixture({
                'src/App.tsx': `
                    const semanticValue = ${before};
                    export const App = () => (
                        <div ${attribute}={semanticValue}><span className="flex" /></div>
                    );
                `,
            });
            const baseline = createLayoutCensus({ repositoryRoot });
            baseline.occurrences[0].reviewed = true;

            writeFixture(
                repositoryRoot,
                'src/App.tsx',
                `
                    const semanticValue = ${after};
                    export const App = () => (
                        <div ${attribute}={semanticValue}><span className="flex" /></div>
                    );
                `
            );
            const changed = createLayoutCensus({ repositoryRoot, previousCensus: baseline });

            expect(changed.occurrences[0].id).toBe(baseline.occurrences[0].id);
            expect(changed.occurrences[0].sourceFingerprint).not.toBe(baseline.occurrences[0].sourceFingerprint);
            expect(changed.occurrences[0].reviewed).toBe(false);
        }
    );

    it('should fingerprint imported semantic spreads before preserving review', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': `
                import { SEMANTICS } from './semantics';
                export const App = () => <div {...SEMANTICS}><span className="flex" /></div>;
            `,
            'src/semantics.ts': `export const SEMANTICS = { role: 'status' };`,
        });
        const baseline = createLayoutCensus({ repositoryRoot });
        baseline.occurrences[0].reviewed = true;

        writeFixture(repositoryRoot, 'src/semantics.ts', `export const SEMANTICS = { role: 'alert' };`);
        const changed = createLayoutCensus({ repositoryRoot, previousCensus: baseline });

        expect(changed.occurrences[0].id).toBe(baseline.occurrences[0].id);
        expect(changed.occurrences[0].sourceFingerprint).not.toBe(baseline.occurrences[0].sourceFingerprint);
        expect(changed.occurrences[0].reviewed).toBe(false);
    });

    it.each([
        [
            'spread',
            'export function App(semantics: object) { return <div {...semantics}><span className="flex" /></div>; }',
        ],
        [
            'bound value',
            'export function App(role: string) { return <div role={role}><span className="flex" /></div>; }',
        ],
    ])('should never preserve review through unresolved ancestor %s evidence', (_name, source) => {
        const repositoryRoot = createFixture({ 'src/App.tsx': source });
        const baseline = createLayoutCensus({ repositoryRoot });
        baseline.occurrences[0].reviewed = true;

        const unchanged = createLayoutCensus({ repositoryRoot, previousCensus: baseline });

        expect(unchanged.occurrences[0]).toMatchObject({
            reviewed: false,
            riskFlags: { hasUnresolvedSemanticAncestor: true },
        });
    });

    it('should invalidate review when an aliased custom ancestor import changes', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': `
                import { Panel as Shell } from './PanelA';
                export const App = () => <Shell><span className="flex" /></Shell>;
            `,
        });
        const baseline = createLayoutCensus({ repositoryRoot });
        baseline.occurrences[0].reviewed = true;

        writeFixture(
            repositoryRoot,
            'src/App.tsx',
            `
                import { Panel as Shell } from './PanelB';
                export const App = () => <Shell><span className="flex" /></Shell>;
            `
        );
        const changed = createLayoutCensus({ repositoryRoot, previousCensus: baseline });
        const drift = compareLayoutCensuses({ actual: changed, expected: baseline });

        expect(changed.occurrences[0].id).toBe(baseline.occurrences[0].id);
        expect(changed.occurrences[0].sourceFingerprint).not.toBe(baseline.occurrences[0].sourceFingerprint);
        expect(changed.occurrences[0].reviewed).toBe(false);
        expect(drift.changed).toHaveLength(1);
    });

    it('should invalidate review when a namespaced custom ancestor import changes', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': `
                import * as Panels from './PanelsA';
                export const App = () => <Panels.Shell><span className="flex" /></Panels.Shell>;
            `,
        });
        const baseline = createLayoutCensus({ repositoryRoot });
        baseline.occurrences[0].reviewed = true;

        writeFixture(
            repositoryRoot,
            'src/App.tsx',
            `
                import * as Panels from './PanelsB';
                export const App = () => <Panels.Shell><span className="flex" /></Panels.Shell>;
            `
        );
        const changed = createLayoutCensus({ repositoryRoot, previousCensus: baseline });
        const drift = compareLayoutCensuses({ actual: changed, expected: baseline });

        expect(changed.occurrences[0].id).toBe(baseline.occurrences[0].id);
        expect(changed.occurrences[0].sourceFingerprint).not.toBe(baseline.occurrences[0].sourceFingerprint);
        expect(changed.occurrences[0].reviewed).toBe(false);
        expect(drift.changed).toHaveLength(1);
    });

    it('should not preserve the obsolete catch-all one-off review', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': 'export const App = () => <div className="flex" />;\n',
        });
        const baseline = createLayoutCensus({ repositoryRoot });
        baseline.occurrences[0].disposition = 'one-off';
        baseline.occurrences[0].rationale =
            'Native semantics, refs, handlers, positioning, overflow, child selectors, inline styles, spread attributes, or unsupported geometry require owner-specific proof.';
        baseline.occurrences[0].reviewed = true;

        const changed = createLayoutCensus({ repositoryRoot, previousCensus: baseline });

        expect(changed.occurrences[0]).toMatchObject({
            disposition: 'eligible',
            proposedPrimitive: 'Row',
            reviewed: false,
        });
        expect(changed.occurrences[0].rationale).toContain('Row');
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

    it('should not transfer reviewed identity when an identical sibling is inserted first', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': 'export const App = () => <><div className="flex" /></>;\n',
        });
        const baseline = createLayoutCensus({ repositoryRoot });
        baseline.occurrences[0].disposition = 'one-off';
        baseline.occurrences[0].rationale = 'Reviewed original occurrence.';
        baseline.occurrences[0].reviewed = true;

        writeFixture(
            repositoryRoot,
            'src/App.tsx',
            'export const App = () => <><div className="flex" /><div className="flex" /></>;\n'
        );
        const changed = createLayoutCensus({ repositoryRoot, previousCensus: baseline });
        const drift = compareLayoutCensuses({ actual: changed, expected: baseline });

        expect(changed.occurrences).toHaveLength(2);
        expect(changed.occurrences.every((occurrence) => !occurrence.reviewed)).toBe(true);
        expect(
            changed.occurrences.every((occurrence) => occurrence.rationale !== 'Reviewed original occurrence.')
        ).toBe(true);
        expect(drift.added).toHaveLength(1);
        expect(drift.changed).toHaveLength(1);
    });

    it('should invalidate review when an import changes the canonical tag semantics', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': `
                import { Box } from './Box';
                export const App = () => <Box className="flex" />;
            `,
        });
        const baseline = createLayoutCensus({ repositoryRoot });
        baseline.occurrences[0].rationale = 'Reviewed custom component.';
        baseline.occurrences[0].reviewed = true;

        writeFixture(
            repositoryRoot,
            'src/App.tsx',
            `
                import { Row as Box } from '#/components/layout';
                export const App = () => <Box className="flex" />;
            `
        );
        const changed = createLayoutCensus({ repositoryRoot, previousCensus: baseline });

        expect(changed.occurrences[0].id).toBe(baseline.occurrences[0].id);
        expect(changed.occurrences[0].sourceFingerprint).not.toBe(baseline.occurrences[0].sourceFingerprint);
        expect(changed.occurrences[0]).toMatchObject({
            disposition: 'already-migrated',
            proposedPrimitive: 'Row',
            reviewed: false,
        });
        expect(changed.occurrences[0].rationale).not.toBe('Reviewed custom component.');
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

    it('should record enclosing owners and explicit module-decomposition move evidence', () => {
        const repositoryRoot = createFixture({
            'src/modules/AiRuntime/presentations/views/VoiceCommandOverlay.tsx':
                'export const VoiceCommandOverlay = () => <div className="flex" />;\n',
            'src/modules/AiRuntime/presentations/views/MixAnalysisPanel.tsx':
                'export const MixAnalysisPanel = () => <div className="grid" />;\n',
            'src/modules/Automation/presentations/views/ModulationMatrix.tsx':
                'export const ModulationMatrix = () => <div className="flex" />;\n',
            'src/modules/AudioEngine/presentations/views/AudioDevicePicker.tsx':
                'export const AudioDevicePicker = () => <div className="flex" />;\n',
            'src/modules/Arrangement/presentations/views/TrackList.tsx':
                'export const TrackList = () => <div className="flex" />;\n',
        });

        const occurrences = collectLayoutOccurrences({ repositoryRoot });
        const byFile = new Map(occurrences.map((occurrence) => [occurrence.file, occurrence]));

        expect(byFile.get('src/modules/AiRuntime/presentations/views/VoiceCommandOverlay.tsx')).toMatchObject({
            enclosingOwner: 'VoiceCommandOverlay',
            decompositionMove: {
                plan: 'CHANGE-module-decomposition',
                status: 'move-conflict',
                currentOwner: 'AiRuntime',
                targetOwner: 'Voice',
            },
        });
        expect(byFile.get('src/modules/AiRuntime/presentations/views/MixAnalysisPanel.tsx')).toMatchObject({
            enclosingOwner: 'MixAnalysisPanel',
            decompositionMove: {
                status: 'move-conflict',
                currentOwner: 'AiRuntime',
                targetOwner: 'MixAdvisor',
            },
        });
        expect(byFile.get('src/modules/Automation/presentations/views/ModulationMatrix.tsx')).toMatchObject({
            decompositionMove: {
                status: 'move-conflict',
                currentOwner: 'Automation',
                targetOwner: 'Modulation',
            },
        });
        expect(byFile.get('src/modules/AudioEngine/presentations/views/AudioDevicePicker.tsx')).toMatchObject({
            decompositionMove: {
                status: 'move-conflict',
                currentOwner: 'AudioEngine',
                targetOwner: 'AudioEngineCore',
            },
        });
        expect(byFile.get('src/modules/Arrangement/presentations/views/TrackList.tsx')).toMatchObject({
            enclosingOwner: 'TrackList',
            decompositionMove: {
                plan: 'CHANGE-module-decomposition',
                status: 'checked-no-conflict',
                currentOwner: 'Arrangement',
                targetOwner: null,
            },
        });
    });

    it('should reject duplicate IDs, missing evidence, invalid dispositions, and generated drift', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': 'export const App = () => <><div className="flex" /><div className="grid" /></>;\n',
        });
        const census = createLayoutCensus({ repositoryRoot });
        const invalid = cloneCensus(census);
        invalid.occurrences[1].id = invalid.occurrences[0].id;
        invalid.occurrences[0].rationale = '';
        Reflect.set(invalid.occurrences[1], 'disposition', 'unsafe-guess');
        Reflect.set(invalid.occurrences[0], 'enclosingOwner', '');
        Reflect.set(invalid.occurrences[1], 'decompositionMove', {
            plan: 'CHANGE-module-decomposition',
            status: 'checked-no-conflict',
            currentOwner: '',
            targetOwner: 'Voice',
        });
        invalid.summary.occurrenceCount = 99;

        const errors = validateLayoutCensus(invalid);

        expect(errors).toEqual(
            expect.arrayContaining([
                expect.stringContaining('duplicate occurrence ID'),
                expect.stringContaining('missing rationale'),
                expect.stringContaining('invalid disposition'),
                expect.stringContaining('missing enclosing owner'),
                expect.stringContaining('invalid module-decomposition evidence'),
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
            '| Stable ID | File:line | Owner | Module decomposition | Pattern | Primitive | Disposition | Reviewed | Rationale |'
        );
        expect(markdown).toContain('App');
        expect(markdown).toContain('checked-no-conflict:src');
        expect(markdown).toContain('flex flex-col gap-2');
    });

    it('should make check mode reject malformed TSX with a relative file and line', () => {
        const repositoryRoot = createFixture({
            'src/App.tsx': 'export const App = () => <div className="flex" />;\n',
        });
        const censusPath = join(repositoryRoot, 'docs/layout-census.json');
        const ledgerPath = join(repositoryRoot, 'docs/layout-census.md');
        const baseline = createLayoutCensus({ repositoryRoot });
        writeFixture(repositoryRoot, 'docs/layout-census.json', JSON.stringify(baseline));
        writeFixture(repositoryRoot, 'docs/layout-census.md', renderLayoutCensusMarkdown(baseline));
        writeFixture(repositoryRoot, 'src/App.tsx', 'export const App = () => <div className="flex";\n');
        const checkArtifacts = Reflect.get(layoutCensusModule, 'checkLayoutCensusArtifacts');

        expect(checkArtifacts).toBeTypeOf('function');
        if (typeof checkArtifacts !== 'function') {
            throw new TypeError('checkLayoutCensusArtifacts must be exported for check-mode verification');
        }
        expect(() => checkArtifacts({ censusPath, ledgerPath, repositoryRoot })).toThrow(/src\/App\.tsx:1/);
    });
});
