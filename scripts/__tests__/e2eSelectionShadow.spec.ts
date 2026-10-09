import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { measureShadow, parseChangedRecords, sourceQualificationReasons } from '../e2eSelectionShadow';
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
        [
            'whitespace trivia',
            baseText.replace('const hz = Math.round(value);', 'const hz  = Math.round(value);'),
            'trivia',
        ],
    ])('keeps the full inventory for unproved obligations despite %s', (_name, changed, route) => {
        const report = measureShadow(fixture({ candidateHead: changed }));
        expect(report.shadowOnly).toBe(true);
        expect(report.measurementStatus).toBe('complete');
        expect(report.candidateSpecs).toHaveLength(313);
        expect(report.fallbackReasons).toContain('source-map-unproved-obligation: tests/e2e/additionalUi.spec.ts');
        expect(report.liveSelectedSpecs).toHaveLength(313);
        expect(report.obligationDispositions).toHaveLength(313);
        expect(report.astRoutes.join(' ')).toContain(route);
    });

    it.each([
        ['ordinary comment', `/* shadow note */\n${baseText}`],
        ['existing comment text', baseText.replace('// Whole hertz:', '// Rounded hertz:')],
        ['trailing comment', `${baseText}\n/* shadow note */`],
        ['comment beside a masked static attribute', baseText.replace('className="', 'className=/* shadow note */"')],
        [
            'compiler-significant comment',
            baseText.replace(
                'setA4Reference(deviceId, hz, true);',
                '/* @__PURE__ */ setA4Reference(deviceId, hz, true);'
            ),
        ],
    ])('rejects a changed %s', (_name, changed) => {
        expect(changed).not.toBe(baseText);
        const report = measureShadow(fixture({ candidateHead: changed }));
        expect(report.candidateSpecs).toHaveLength(313);
        expect(report.fallbackReasons).toContain('candidate-ast-not-presentation-only');
        expect(report.astRoutes).toContain('rejected: changed comments');
    });

    it('refuses a direct-witness producer missing from the evaluated source tree', () => {
        const producer = 'src/modules/TimelineEditor/presentations/views/Inspector/TrackDevicesSection.tsx';
        const sourceHashes = Object.fromEntries(
            Object.entries(certificate.sourceHashes).filter(([path]) => path !== producer)
        );
        const report = measureShadow(fixture({ sourceHashes }));
        expect(report.candidateSpecs).toHaveLength(313);
        expect(report.fallbackReasons).toContain(
            'route-certificate-drift: src/modules/TimelineEditor/presentations/views/Inspector/TrackDevicesSection.tsx'
        );
    });

    it.each([
        'src/modules/TimelineEditor/presentations/views/Inspector/TrackDevicesSection.tsx',
        'tests/e2e/e2eUtils.ts',
    ])('requires declared direct-witness producer %s to be bound by the fixed map', (producer) => {
        const witness = certificate.rows.find((row) => row.disposition === 'DIRECT_TUNER_WITNESS');
        if (!witness) {
            throw new Error('Missing frozen direct witness');
        }
        const bound = Object.fromEntries(
            Object.entries(certificate.sourceHashes).filter(([path]) => path !== producer)
        );
        expect(sourceQualificationReasons([witness], bound)).toContain(`source-map-producer-unbound: ${producer}`);
    });

    it('accepts every real direct-witness route with the bound source hashes', () => {
        const witnesses = certificate.rows.filter((row) => row.disposition === 'DIRECT_TUNER_WITNESS');
        expect(witnesses).toHaveLength(2);
        expect(sourceQualificationReasons(witnesses, certificate.sourceHashes)).toEqual([]);
        expect(
            measureShadow(fixture()).fallbackReasons.filter((reason) =>
                reason.startsWith('source-map-producer-route-invalid:')
            )
        ).toEqual([]);
    });

    it.each(['tests/e2e/e2eUtils.ts:72-100,', 'tests/e2e/e2eUtils.ts:72-,131-155', 'tests/e2e/e2eUtils.ts:0-2'])(
        'rejects malformed direct-witness route %s',
        (route) => {
            const witness = certificate.rows.find((row) => row.disposition === 'DIRECT_TUNER_WITNESS');
            if (!witness) {
                throw new Error('Missing frozen direct witness');
            }
            expect(
                sourceQualificationReasons([{ ...witness, producerRoute: [route] }], certificate.sourceHashes)
            ).toContain(`source-map-producer-route-invalid: ${witness.path}`);
        }
    );

    it('distinguishes a synthetic qualified exclusion from an unproved source trace', () => {
        const row = {
            path: 'tests/e2e/example.spec.ts',
            disposition: 'BOUNDED_SOURCE_EXCLUSION',
            reason: 'Synthetic verified source exclusion',
            producerRoute: ['tests/e2e/example.spec.ts:1-4'],
        };
        expect(sourceQualificationReasons([row], { 'tests/e2e/example.spec.ts': 'a'.repeat(64) })).toEqual([]);
        expect(sourceQualificationReasons([{ ...row, disposition: 'SOURCE_ONLY_UNPROVEN' }], {})).toEqual([
            'source-map-unproved-obligation: tests/e2e/example.spec.ts',
        ]);
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

    it('falls back for an altered inventory row', () => {
        const changed = [...inventory];
        changed[0] = { ...changed[0]!, sha256: '0'.repeat(64) };
        expect(measureShadow(fixture({ inventory: changed })).fallbackReasons[0]).toMatch(
            'inventory-certificate-drift'
        );
    });

    it.each([
        'src/modules/WorkspaceShell/presentations/views/AppShell.tsx',
        'src/modules/TimelineEditor/presentations/views/Inspector/TrackDevicesSection.tsx',
        'tests/e2e/e2eUtils.ts',
        'scripts/vitestCollectionPatterns.ts',
        'scripts/prValidationScope.ts',
        'playwright.config.ts',
        'tests/e2e/smoke.spec.ts',
        '.github/workflows/heavy-gates.yml',
    ])('falls back for a changed source route %s', (path) => {
        const sourceHashes = { ...certificate.sourceHashes, [path]: '0'.repeat(64) };
        expect(measureShadow(fixture({ sourceHashes })).fallbackReasons).toContain(`route-certificate-drift: ${path}`);
    });

    it('falls back for a changed source mode', () => {
        const sourceModes = Object.fromEntries(Object.keys(certificate.sourceHashes).map((path) => [path, '100644']));
        sourceModes['playwright.config.ts'] = '120000';
        expect(measureShadow(fixture({ sourceModes })).fallbackReasons).toContain(
            'route-certificate-drift: playwright.config.ts'
        );
    });

    it('falls back for a changed health workflow policy', () => {
        expect(measureShadow(fixture({ healthRequiredPolicySha256: '0'.repeat(64) })).fallbackReasons).toContain(
            'workflow-certificate-drift: health required policy'
        );
    });

    it('falls back for a changed source-map certificate', () => {
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
