import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { measureShadow, parseChangedRecords } from '../e2eSelectionShadow';
import certificate from '../e2eSelectionShadowCertificate.json' with { type: 'json' };
import { selectValidationPlan, SMOKE_SPEC } from '../prValidationScope';

const candidate = certificate.candidatePath;
const baseText = readFileSync(candidate, 'utf8');
const certificateSha256 = createHash('sha256')
    .update(readFileSync('scripts/e2eSelectionShadowCertificate.json'))
    .digest('hex');
const sha = 'a'.repeat(40);
const head = 'b'.repeat(40);
const inventory = [
    ...certificate.rows.map((row) => ({ path: row.path, gitBlob: row.gitBlob, sha256: row.sha256, mode: '100644' })),
    { path: SMOKE_SPEC, gitBlob: 'c'.repeat(40), sha256: 'd'.repeat(64), mode: '100644' },
];

function fixture(overrides: Record<string, unknown> = {}) {
    const rawDiff = Buffer.from(`M\0${candidate}\0`);
    return {
        base: sha,
        head,
        rawDiff,
        certificateSha256,
        records: [{ status: 'M', oldPath: candidate, newPath: candidate, oldMode: '100644', newMode: '100644' }],
        inventory,
        sourceHashes: { ...certificate.sourceHashes, '.github/workflows/health-gates.yml': 'e'.repeat(64) },
        sourceModes: Object.fromEntries(
            [
                ...Object.keys(certificate.sourceHashes),
                '.github/workflows/health-gates.yml',
                'scripts/e2eSelectionShadow.ts',
            ].map((path) => [path, '100644'])
        ),
        healthRequiredPolicySha256: certificate.healthRequiredPolicySha256,
        candidateBase: baseText,
        candidateHead: baseText.replace('Scoring', 'Pitch display'),
        livePlan: selectValidationPlan(
            [candidate],
            inventory.map((row) => row.path)
        ),
        ...overrides,
    };
}

describe('E2E selection shadow', () => {
    it('retains NUL diff actions and both rename paths', () => {
        expect(parseChangedRecords(`R100\0old.ts\0new.ts\0`)).toEqual([
            { status: 'R100', oldPath: 'old.ts', newPath: 'new.ts' },
        ]);
        expect(() => parseChangedRecords('M\0bad.ts')).toThrow('NUL terminated');
    });

    it.each([
        ['existing JSX text', baseText.replace('Scoring', 'Pitch display'), 'JSXText'],
        ['existing class', baseText.replace('className="', 'className="shadow-'), 'JSXAttribute[className]'],
        [
            'existing label',
            baseText.replace('aria-label="Needle tuner display"', 'aria-label="Pitch needle"'),
            'JSXAttribute[aria-label]',
        ],
        ['comment trivia', `/* shadow note */\n${baseText}`, 'trivia'],
    ])('records the two source witnesses for %s while comparing with the broad live plan', (_name, changed, route) => {
        const report = measureShadow(fixture({ candidateHead: changed }));
        expect(report.shadowOnly).toBe(true);
        expect(report.measurementStatus).toBe('complete');
        expect(report.candidateSpecs).toEqual(['tests/e2e/tuner.spec.ts', 'tests/e2e/tunerReferenceHomeEnd.spec.ts']);
        expect(report.liveSelectedSpecs).toHaveLength(313);
        expect(report.obligationDispositions).toHaveLength(313);
        expect(report.astRoutes.join(' ')).toContain(route);
    });

    it.each([
        ['top-level effect', `${baseText}\nthrow new Error('startup');`],
        ['global listener', `${baseText}\nwindow.addEventListener('click', () => {});`],
        [
            'import reorder',
            baseText.replace(
                "import { DawPluginLed } from '#/components/daw/DawPluginLed';\nimport { DawPluginMetricTile } from '#/components/daw/DawPluginMetricTile';",
                "import { DawPluginMetricTile } from '#/components/daw/DawPluginMetricTile';\nimport { DawPluginLed } from '#/components/daw/DawPluginLed';"
            ),
        ],
        [
            'component effect',
            baseText.replace(
                'const announced = useDebouncedAnnouncement(liveMessage);',
                "const announced = useDebouncedAnnouncement(liveMessage);\n    useEffect(() => { window.addEventListener('click', () => {}); }, []);"
            ),
        ],
        ['A4 handler', baseText.replace('setA4Reference(deviceId, hz, true)', 'setA4Reference(deviceId, 440, true)')],
        ['numeric value', baseText.replace('ANNOUNCE_DEBOUNCE_MS = 750', 'ANNOUNCE_DEBOUNCE_MS = 751')],
        ['JSX expression', baseText.replace('>Scoring</div>', '>{window.location.href}</div>')],
        [
            'JSX element',
            baseText.replace(
                '<div className="text-[18px] font-semibold text-white/92">Scoring</div>',
                '<span className="text-[18px] font-semibold text-white/92">Scoring</span>'
            ),
        ],
    ])('falls back for executable %s', (_name, changed) => {
        const report = measureShadow(fixture({ candidateHead: changed }));
        expect(report.candidateSpecs).toHaveLength(313);
        expect(report.fallbackReasons).toContain('candidate-ast-not-presentation-only');
        expect(report.astRoutes.some((route) => route.startsWith('rejected:'))).toBe(true);
    });

    it.each(['A', 'D', 'R100', 'C100', 'T', 'U'])('falls back for %s action', (status) => {
        const rawDiff = Buffer.from(`${status}\0${candidate}\0${/^[RC]/.test(status) ? `${candidate}.moved\0` : ''}`);
        const records = parseChangedRecords(rawDiff.toString()).map((record) => ({
            ...record,
            oldMode: '100644',
            newMode: '100644',
        }));
        const paths = [
            ...new Set(
                records
                    .flatMap((record) => [record.oldPath, record.newPath])
                    .filter((path): path is string => path !== null)
            ),
        ].sort();
        const report = measureShadow(
            fixture({
                rawDiff,
                records,
                livePlan: selectValidationPlan(
                    paths,
                    inventory.map((row) => row.path)
                ),
            })
        );
        expect(report.candidateSpecs).toHaveLength(313);
        expect(report.fallbackReasons).toContain('changed-path-or-status-not-qualified');
    });

    it.each([
        'playwright.config.ts',
        'tests/e2e/tuner.spec.ts',
        'src/modules/WorkspaceShell/presentations/views/AppShell.tsx',
    ])('falls back for a mixed %s change', (path) => {
        const rawDiff = Buffer.from(`M\0${candidate}\0M\0${path}\0`);
        const records = parseChangedRecords(rawDiff.toString()).map((record) => ({
            ...record,
            oldMode: '100644',
            newMode: '100644',
        }));
        const report = measureShadow(
            fixture({
                rawDiff,
                records,
                livePlan: selectValidationPlan(
                    [candidate, path].sort(),
                    inventory.map((row) => row.path)
                ),
            })
        );
        expect(report.candidateSpecs).toHaveLength(313);
        expect(report.fallbackReasons).toContain('changed-path-or-status-not-qualified');
    });

    it('falls back for a symlink or missing mode', () => {
        for (const mode of ['120000', null]) {
            const report = measureShadow(
                fixture({
                    records: [{ status: 'M', oldPath: candidate, newPath: candidate, oldMode: mode, newMode: mode }],
                })
            );
            expect(report.fallbackReasons).toContain('candidate-mode-not-regular');
        }
    });

    it('falls back for an altered row, source route, collector, selector, or workflow policy', () => {
        const changed = [...inventory];
        changed[0] = { ...changed[0]!, sha256: '0'.repeat(64) };
        expect(measureShadow(fixture({ inventory: changed })).fallbackReasons[0]).toMatch(
            'inventory-certificate-drift'
        );
        for (const path of [
            'src/modules/WorkspaceShell/presentations/views/AppShell.tsx',
            'scripts/vitestCollectionPatterns.ts',
            'scripts/prValidationScope.ts',
            'playwright.config.ts',
            'tests/e2e/smoke.spec.ts',
            '.github/workflows/heavy-gates.yml',
        ]) {
            const sourceHashes = { ...certificate.sourceHashes, [path]: '0'.repeat(64) };
            expect(measureShadow(fixture({ sourceHashes })).fallbackReasons).toContain(
                `route-certificate-drift: ${path}`
            );
        }
        const sourceModes = Object.fromEntries(Object.keys(certificate.sourceHashes).map((path) => [path, '100644']));
        sourceModes['playwright.config.ts'] = '120000';
        expect(measureShadow(fixture({ sourceModes })).fallbackReasons).toContain(
            'route-certificate-drift: playwright.config.ts'
        );
        expect(measureShadow(fixture({ healthRequiredPolicySha256: '0'.repeat(64) })).fallbackReasons).toContain(
            'workflow-certificate-drift: health required policy'
        );
        expect(measureShadow(fixture({ certificateSha256: '0'.repeat(64) })).fallbackReasons).toContain(
            'source-map-certificate-drift'
        );
    });

    it('falls back when Playwright begins collecting a new default .test.ts file', () => {
        const newPath = 'tests/e2e/new-default.test.ts';
        const changed = [
            ...inventory,
            { path: newPath, gitBlob: 'f'.repeat(40), sha256: 'f'.repeat(64), mode: '100644' },
        ];
        const report = measureShadow(
            fixture({
                inventory: changed,
                livePlan: selectValidationPlan(
                    [candidate],
                    changed.map((row) => row.path)
                ),
            })
        );
        expect(report.candidateSpecs).toHaveLength(314);
        expect(report.fallbackReasons).toContain('inventory-certificate-drift: paths');
    });

    it('rejects a missing or mismatched authoritative scope artifact', () => {
        expect(() =>
            measureShadow(
                fixture({
                    livePlan: selectValidationPlan(
                        ['README.md'],
                        inventory.map((row) => row.path)
                    ),
                })
            )
        ).toThrow('Authoritative scope artifact disagrees');
    });
});
