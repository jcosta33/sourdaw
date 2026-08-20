import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    canonicalizeCensus,
    checkUiRestatementCensus,
    diffCensus,
    scanUiRestatements,
    type UiRestatementRow,
} from '../uiRestatementCensus';

const fixtures: string[] = [];

afterEach(() => {
    for (const dir of fixtures.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function tree(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'ui-census-'));
    fixtures.push(dir);
    for (const [relativePath, contents] of Object.entries(files)) {
        const absolute = join(dir, relativePath);
        mkdirSync(dirname(absolute), { recursive: true });
        writeFileSync(absolute, contents);
    }
    return dir;
}

describe('scanUiRestatements', () => {
    it('emits a stable layout row for an inline flex-col container', () => {
        const root = tree({
            'src/modules/Demo/presentations/views/Panel.tsx': `export const Panel = () => (
  <div className="flex flex-col gap-2">hello</div>
);
`,
        });
        const rows = scanUiRestatements(root);
        expect(rows).toEqual([
            expect.objectContaining({
                file: 'src/modules/Demo/presentations/views/Panel.tsx',
                line: 2,
                kind: 'layout',
                mapping: 'Stack',
                disposition: 'eligible',
                fingerprint: 'div\tflex flex-col gap-2',
            }),
        ]);
        expect(rows[0]?.id).toMatch(/^ui-[a-f0-9]{16}$/);
    });

    it('maps a horizontal flex row to Row', () => {
        const root = tree({
            'src/modules/Demo/presentations/views/Toolbar.tsx': `export const Toolbar = () => <div className="flex items-center gap-2" />;
`,
        });
        expect(scanUiRestatements(root)[0]).toEqual(
            expect.objectContaining({ mapping: 'Row', disposition: 'eligible', kind: 'layout' })
        );
    });

    it('maps grid-cols to Grid and complex templates to complex-grid', () => {
        const root = tree({
            'src/modules/Demo/presentations/views/SimpleGrid.tsx': `export const SimpleGrid = () => <div className="grid grid-cols-2 gap-2" />;
`,
            'src/modules/Demo/presentations/views/Shell.tsx': `export const Shell = () => <div className="grid grid-cols-[15rem_minmax(0,1fr)]" />;
`,
        });
        const byFile = Object.fromEntries(scanUiRestatements(root).map((row) => [row.file, row]));
        expect(byFile['src/modules/Demo/presentations/views/SimpleGrid.tsx']).toEqual(
            expect.objectContaining({ mapping: 'Grid', disposition: 'eligible' })
        );
        expect(byFile['src/modules/Demo/presentations/views/Shell.tsx']).toEqual(
            expect.objectContaining({ mapping: 'Grid', disposition: 'complex-grid' })
        );
    });

    it('marks layout primitives as already-migrated', () => {
        const root = tree({
            'src/modules/Demo/presentations/views/Migrated.tsx': `import { Stack } from '#/components/layout';
export const Migrated = () => <Stack gap={2}>ok</Stack>;
`,
        });
        expect(scanUiRestatements(root)[0]).toEqual(
            expect.objectContaining({
                kind: 'layout',
                mapping: 'Stack',
                disposition: 'already-migrated',
            })
        );
    });

    it('marks Daw chrome tags as semantic wrappers', () => {
        const root = tree({
            'src/modules/Demo/presentations/views/Empty.tsx': `import { DawEmptyState } from '#/components/daw/DawEmptyState';
export const Empty = () => <DawEmptyState title="None" />;
`,
        });
        expect(scanUiRestatements(root)[0]).toEqual(
            expect.objectContaining({
                kind: 'daw-chrome',
                mapping: 'DawEmptyState',
                disposition: 'semantic-wrapper',
            })
        );
    });

    it('marks a raw button as an eligible generic control', () => {
        const root = tree({
            'src/modules/Demo/presentations/views/Actions.tsx': `export const Actions = () => <button type="button">Go</button>;
`,
        });
        expect(scanUiRestatements(root)[0]).toEqual(
            expect.objectContaining({
                kind: 'generic-control',
                mapping: 'Button',
                disposition: 'eligible',
            })
        );
    });

    it('does not emit rows for comments or ordinary strings', () => {
        const root = tree({
            'src/modules/Demo/presentations/views/Notes.tsx': `const hint = "flex flex-col gap-2";
// <div className="flex items-center gap-2" />
export const Notes = () => <span>{hint}</span>;
`,
        });
        expect(scanUiRestatements(root)).toEqual([]);
    });

    it('does not scan tests, snapshots, generated files, or nested worktrees', () => {
        const root = tree({
            'src/modules/Demo/presentations/views/__tests__/Panel.spec.tsx': `export const T = () => <div className="flex flex-col gap-2" />;
`,
            'src/modules/Demo/presentations/views/Panel.spec.tsx': `export const T = () => <div className="flex flex-col gap-2" />;
`,
            'src/modules/Demo/presentations/views/__snapshots__/Panel.tsx': `export const T = () => <div className="flex flex-col gap-2" />;
`,
            'src/modules/Demo/generated/Panel.tsx': `export const T = () => <div className="flex flex-col gap-2" />;
`,
            'src/.agents/worktrees/other/Panel.tsx': `export const T = () => <div className="flex flex-col gap-2" />;
`,
        });
        expect(scanUiRestatements(root)).toEqual([]);
    });

    it('does not treat flex-grow tokens as a layout restatement', () => {
        const root = tree({
            'src/modules/Demo/presentations/views/Grow.tsx': `export const Grow = () => <div className="flex-1 min-h-0" />;
`,
        });
        expect(scanUiRestatements(root)).toEqual([]);
    });

    it('marks visualizer files as renderer', () => {
        const root = tree({
            'src/components/daw/visualizers/Curve.tsx': `export const Curve = () => <div className="flex flex-col gap-2" />;
`,
        });
        expect(scanUiRestatements(root)[0]?.disposition).toBe('renderer');
    });

    it('marks className constructions with template slots as responsive-or-dynamic', () => {
        const root = tree({
            'src/modules/Demo/presentations/views/Dynamic.tsx': `export const Dynamic = ({ extra }: { extra: string }) => (
  <div className={\`flex flex-col \${extra}\`} />
);
`,
        });
        expect(scanUiRestatements(root)[0]?.disposition).toBe('responsive-or-dynamic');
    });
});

describe('canonicalizeCensus', () => {
    it('is byte-identical across two scans of the same tree', () => {
        const root = tree({
            'src/modules/Demo/presentations/views/Panel.tsx': `export const Panel = () => <div className="flex flex-col gap-2" />;
`,
            'src/modules/Demo/presentations/views/Actions.tsx': `export const Actions = () => <button type="button">Go</button>;
`,
        });
        const first = canonicalizeCensus(scanUiRestatements(root));
        const second = canonicalizeCensus(scanUiRestatements(root));
        expect(first).toBe(second);
        expect(first.endsWith('\n')).toBe(true);
    });
});

describe('diffCensus', () => {
    it('fails check until a new restatement is recorded in the ledger', () => {
        const actual: UiRestatementRow[] = [
            {
                id: 'ui-aaaaaaaaaaaaaaaa',
                file: 'src/a.tsx',
                line: 1,
                fingerprint: 'div\tflex flex-col',
                kind: 'layout',
                mapping: 'Stack',
                disposition: 'eligible',
            },
        ];
        expect(diffCensus(actual, []).missing).toEqual(actual);
        expect(diffCensus(actual, actual).missing).toEqual([]);
        expect(diffCensus(actual, actual).stale).toEqual([]);
    });

    it('fails a ledger row whose file, line, or fingerprint no longer exists', () => {
        const ledger: UiRestatementRow[] = [
            {
                id: 'ui-bbbbbbbbbbbbbbbb',
                file: 'src/gone.tsx',
                line: 4,
                fingerprint: 'div\tflex flex-col',
                kind: 'layout',
                mapping: 'Stack',
                disposition: 'eligible',
            },
        ];
        expect(diffCensus([], ledger).stale).toEqual(ledger);
    });
});

describe('checkUiRestatementCensus', () => {
    it('fails until the ledger records a new restatement', () => {
        const root = tree({
            'src/modules/Demo/presentations/views/Panel.tsx': `export const Panel = () => <div className="flex flex-col gap-2" />;
`,
            'scripts/ui-restatement-census.json': '[]\n',
        });
        const errors = checkUiRestatementCensus(root);
        expect(errors.some((error) => error.includes('missing ledger row'))).toBe(true);
    });

    it('fails a stale ledger row', () => {
        const root = tree({
            'src/modules/Demo/presentations/views/Panel.tsx': `export const Panel = () => <span>ok</span>;
`,
            'scripts/ui-restatement-census.json': `${JSON.stringify(
                [
                    {
                        id: 'ui-bbbbbbbbbbbbbbbb',
                        file: 'src/gone.tsx',
                        line: 4,
                        fingerprint: 'div\tflex flex-col',
                        kind: 'layout',
                        mapping: 'Stack',
                        disposition: 'eligible',
                    },
                ],
                null,
                2
            )}\n`,
        });
        const errors = checkUiRestatementCensus(root);
        expect(errors.some((error) => error.includes('stale ledger row'))).toBe(true);
    });
});
