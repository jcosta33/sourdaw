import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    closeSync,
    fstatSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readFileSync,
    realpathSync,
    rmSync,
    rmdirSync,
    symlinkSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    hashInventoryFile,
    listIntegrationInventory,
    listInventory,
    measureShadow,
    parseChangedRecords,
    readHeadSourceBindings,
    readIntegrationSourceHashes,
    sourceQualificationReasons,
    verifyIntegrationCheckout,
} from '../e2eSelectionShadow';
import certificate from '../e2eSelectionShadowCertificate.json' with { type: 'json' };
import { parseSpecDurations } from '../e2eShardPartition';
import { selectValidationPlan, SMOKE_SPEC } from '../prValidationScope';

const candidate = certificate.candidatePath;
const baseText = readFileSync(candidate, 'utf8');
const certificateSha256 = createHash('sha256')
    .update(readFileSync('scripts/e2eSelectionShadowCertificate.json'))
    .digest('hex');
const durationTableText = readFileSync('scripts/e2eSpecDurations.json', 'utf8');
const sha = 'a'.repeat(40);
const head = 'b'.repeat(40);
const inventory = [
    ...certificate.rows.map((row) => ({ path: row.path, gitBlob: row.gitBlob, sha256: row.sha256, mode: '100644' })),
    { path: SMOKE_SPEC, gitBlob: 'c'.repeat(40), sha256: 'd'.repeat(64), mode: '100644' },
];

const realInventoryFileAccess = {
    lstat: lstatSync,
    open: openSync,
    fstat: fstatSync,
    read: (file: string | number) => readFileSync(file),
    close: closeSync,
};

function withInventoryFiles(run: (file: string, outside: string, originalHash: string) => void): void {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-shadow-inventory-'));
    const file = join(root, 'collected.spec.ts');
    const outside = join(root, 'outside.txt');
    const original = Buffer.from('Original collected E2E bytes\n');
    writeFileSync(file, original);
    writeFileSync(outside, 'Outside collected E2E bytes\n');
    try {
        run(file, outside, createHash('sha256').update(original).digest('hex'));
    } finally {
        const leaf = lstatSync(file, { throwIfNoEntry: false });
        if (leaf?.isDirectory()) {
            rmdirSync(file);
        } else if (leaf) {
            unlinkSync(file);
        }
        unlinkSync(outside);
        rmdirSync(root);
    }
}

function withIntegrationCheckout(
    run: (root: string, merge: string, head: string, base: string, first: string) => void
): void {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-shadow-integration-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    const commit = (message: string) => {
        git('add', '.');
        git('-c', 'user.name=Shadow Test', '-c', 'user.email=shadow@example.invalid', 'commit', '-q', '-m', message);
        return git('rev-parse', 'HEAD');
    };
    try {
        git('init', '-q', '-b', 'main');
        mkdirSync(join(root, 'tests/e2e'), { recursive: true });
        writeFileSync(join(root, SMOKE_SPEC), 'smoke\n');
        const base = commit('base');
        writeFileSync(join(root, 'main.txt'), 'main\n');
        const first = commit('main');
        git('checkout', '-q', '-b', 'feature', base);
        writeFileSync(join(root, 'tests/e2e/monoModulationInput.spec.ts'), 'integration spec\n');
        const head = commit('head');
        git('checkout', '-q', 'main');
        git(
            '-c',
            'user.name=Shadow Test',
            '-c',
            'user.email=shadow@example.invalid',
            'merge',
            '-q',
            '--no-ff',
            '-m',
            'integration',
            'feature'
        );
        run(root, git('rev-parse', 'HEAD'), head, base, first);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

function fixture(
    overrides: Record<string, unknown> & {
        sourceHashes?: Record<string, string>;
        integrationSourceHashes?: Record<string, string>;
    } = {}
) {
    const rawDiff = Buffer.from(`M\0${candidate}\0`);
    const selectedInventory = Array.isArray(overrides.inventory) ? overrides.inventory : inventory;
    const suppliedSourceHashes = overrides.sourceHashes ?? certificate.sourceHashes;
    const durationText = typeof overrides.durationText === 'string' ? overrides.durationText : '{}';
    const sourceHashes = {
        '.github/workflows/health-gates.yml': 'e'.repeat(64),
        'scripts/e2eSelectionShadow.ts': 'f'.repeat(64),
        'scripts/e2eSelectionShadowIntegration.ts': '53f814094c2d05455c5682ff98e6b5ff40a9152fbb231da151f393a3c8c30a12',
        ...suppliedSourceHashes,
        'scripts/e2eShardPartition.ts': createHash('sha256')
            .update(readFileSync('scripts/e2eShardPartition.ts'))
            .digest('hex'),
        'scripts/e2eSpecDurations.json': createHash('sha256').update(durationText).digest('hex'),
    };
    return {
        base: sha,
        head,
        integrationSha: 'c'.repeat(40),
        rawDiff,
        certificateSha256,
        records: [{ status: 'M', oldPath: candidate, newPath: candidate, oldMode: '100644', newMode: '100644' }],
        inventory,
        integrationInventory: selectedInventory,
        sourceModes: Object.fromEntries(
            [
                ...Object.keys(certificate.sourceHashes),
                '.github/workflows/health-gates.yml',
                'scripts/e2eSelectionShadow.ts',
                'scripts/e2eSelectionShadowIntegration.ts',
                'scripts/e2eShardPartition.ts',
                'scripts/e2eSpecDurations.json',
            ].map((path) => [path, '100644'])
        ),
        healthRequiredPolicySha256: certificate.healthRequiredPolicySha256,
        candidateBase: baseText,
        candidateHead: baseText.replace('Scoring', 'Pitch display'),
        durationText,
        livePlan: selectValidationPlan(
            [candidate],
            inventory.map((row) => row.path)
        ),
        ...overrides,
        sourceHashes,
        integrationSourceHashes: overrides.integrationSourceHashes ?? sourceHashes,
    };
}

describe('E2E selection shadow', () => {
    function hostedInput(durationText = durationTableText) {
        const changed = [
            ['M', '.github/workflows/health-gates.yml'],
            ['A', 'scripts/__tests__/e2eSelectionShadow.spec.ts'],
            ['M', 'scripts/__tests__/fixtures/health-gate-workflows.snapshot.json'],
            ['M', 'scripts/__tests__/healthGatesWorkflow.spec.ts'],
            ['A', 'scripts/e2eSelectionShadow.ts'],
            ['A', 'scripts/e2eSelectionShadowCertificate.json'],
            ['A', 'scripts/e2eSelectionShadowIntegration.ts'],
            ['M', 'scripts/healthGateWorkflowContract.ts'],
        ] as const;
        const rawDiff = Buffer.from(changed.map(([status, path]) => `${status}\0${path}\0`).join(''));
        const paths = changed.map(([, path]) => path);
        const integrationInventory = [
            ...inventory,
            {
                path: 'tests/e2e/monoModulationInput.spec.ts',
                gitBlob: 'e'.repeat(40),
                sha256: 'f'.repeat(64),
                mode: '100644',
            },
        ];
        const livePlan = selectValidationPlan(
            paths,
            integrationInventory.map((row) => row.path),
            parseSpecDurations(durationTableText)
        );
        return {
            ...fixture({
                rawDiff,
                records: changed.map(([status, path]) => ({
                    status,
                    oldPath: status === 'A' ? null : path,
                    newPath: path,
                    oldMode: status === 'A' ? null : '100644',
                    newMode: '100644',
                })),
                integrationInventory,
                durationText,
                livePlan,
            }),
            livePlan,
        };
    }

    it('recomputes the hosted 314-spec matrix from the exact bound duration table', () => {
        const input = hostedInput();
        const livePlan = input.livePlan;
        expect(livePlan.matrix.include).toHaveLength(12);
        expect(livePlan.matrix.include.flatMap((group) => group.specs)).toHaveLength(314);
        expect(createHash('sha256').update(JSON.stringify(livePlan.matrix)).digest('hex')).toBe(
            '5eab5299f22ffbc15ae9b89d3fa0799f10b29cd765815aaf53f103afc46733ad'
        );
        const report = measureShadow(input);
        expect(report.counts).toEqual({ inventory: 314, candidate: 314, liveSelected: 314 });
        expect(report.fallbackReasons).toContain('scope-head-inventory-drift');
    });

    it('refuses a default, wrong, or unbound duration table rather than accepting its matrix', () => {
        expect(() => measureShadow(hostedInput('{}'))).toThrow('Authoritative scope artifact disagrees');
        const wrong = JSON.stringify({ ...JSON.parse(durationTableText), 'tests/e2e/voiceTempoTestId.spec.ts': 99999 });
        expect(() => measureShadow(hostedInput(wrong))).toThrow('Authoritative scope artifact disagrees');
        expect(() => measureShadow(hostedInput('{invalid'))).toThrow();
        expect(() => measureShadow({ ...hostedInput(), durationText: '{}' })).toThrow(
            'Duration table differs from immutable head'
        );
    });

    it.each(['scripts/e2eShardPartition.ts', 'scripts/e2eSpecDurations.json'])(
        'refuses missing, nonregular, or integration-drifted duration source %s',
        (path) => {
            const input = hostedInput();
            expect(() => measureShadow({ ...input, sourceModes: { ...input.sourceModes, [path]: '120000' } })).toThrow(
                `Integration duration planner is missing, nonregular, or differs from candidate head: ${path}`
            );
            expect(() =>
                measureShadow({ ...input, sourceHashes: { ...input.sourceHashes, [path]: 'missing-or-nonregular' } })
            ).toThrow(`Integration duration planner is missing, nonregular, or differs from candidate head: ${path}`);
            expect(() =>
                measureShadow({
                    ...input,
                    integrationSourceHashes: { ...input.integrationSourceHashes, [path]: '0'.repeat(64) },
                })
            ).toThrow(`Integration duration planner is missing, nonregular, or differs from candidate head: ${path}`);
        }
    );
    it('binds the two-parent integration commit and reads exact regular Git bytes', () => {
        withIntegrationCheckout((root, merge, head, base, first) => {
            expect(() => verifyIntegrationCheckout(root, merge, head, base)).not.toThrow();
            expect(() => verifyIntegrationCheckout(root, merge, first, base)).toThrow('two-parent merge');
            expect(() => verifyIntegrationCheckout(root, merge, head, head)).toThrow('first parent');
            expect(() => verifyIntegrationCheckout(root, '0'.repeat(40), head, base)).toThrow('immutable merge SHA');
            const rows = listIntegrationInventory(root, merge);
            expect(listInventory(root, merge)).toEqual(rows);
            expect(rows.map((row) => row.path)).toContain('tests/e2e/monoModulationInput.spec.ts');
            expect(rows.every((row) => row.mode === '100644')).toBe(true);
            const file = join(root, 'tests/e2e/monoModulationInput.spec.ts');
            const sourceHashes = readIntegrationSourceHashes(root, merge, ['tests/e2e/monoModulationInput.spec.ts']);
            expect(
                readHeadSourceBindings(
                    root,
                    merge,
                    ['tests/e2e/monoModulationInput.spec.ts'],
                    ['tests/e2e/monoModulationInput.spec.ts']
                ).sourceHashes
            ).toEqual(sourceHashes);
            expect(sourceHashes['tests/e2e/monoModulationInput.spec.ts']).toBe(
                createHash('sha256').update(readFileSync(file)).digest('hex')
            );
            writeFileSync(file, 'altered bytes\n');
            expect(readIntegrationSourceHashes(root, merge, ['tests/e2e/monoModulationInput.spec.ts'])).toEqual(
                sourceHashes
            );
            expect(() => listIntegrationInventory(root, merge)).toThrow('disagree with Git blob');
            expect(() => listInventory(root, merge)).toThrow('Candidate inventory bytes disagree');
            expect(() =>
                readHeadSourceBindings(
                    root,
                    merge,
                    ['tests/e2e/monoModulationInput.spec.ts'],
                    ['tests/e2e/monoModulationInput.spec.ts']
                )
            ).toThrow('Shadow rule in checkout disagrees');
            unlinkSync(file);
            symlinkSync(join(root, 'main.txt'), file);
            expect(() => listIntegrationInventory(root, merge)).toThrow('not regular');
        });
    });
    it('retains NUL diff actions and both rename paths', () => {
        expect(parseChangedRecords(`R100\0old.ts\0new.ts\0`)).toEqual([
            { status: 'R100', oldPath: 'old.ts', newPath: 'new.ts' },
        ]);
        expect(() => parseChangedRecords('M\0bad.ts')).toThrow('NUL terminated');
    });

    it('hashes a regular inventory file and marks a preexisting symlink or directory missing', () => {
        withInventoryFiles((file, outside, originalHash) => {
            expect(hashInventoryFile(file, realInventoryFileAccess)).toBe(originalHash);
            unlinkSync(file);
            symlinkSync(outside, file);
            expect(hashInventoryFile(file, realInventoryFileAccess)).toBe('missing');
            unlinkSync(file);
            mkdirSync(file);
            expect(hashInventoryFile(file, realInventoryFileAccess)).toBe('missing');
            rmdirSync(file);
            expect(() => hashInventoryFile(file, realInventoryFileAccess)).toThrow();
        });
    });

    it('does not read outside bytes when the inventory leaf becomes a symlink before open', () => {
        withInventoryFiles((file, outside) => {
            const swap = () => {
                unlinkSync(file);
                symlinkSync(outside, file);
            };
            const access = {
                ...realInventoryFileAccess,
                lstat: (path: string) => {
                    const result = lstatSync(path);
                    swap();
                    return result;
                },
                open: (path: string, flags: number) => {
                    swap();
                    return openSync(path, flags);
                },
                read: (path: string | number) => {
                    if (typeof path === 'string' && realpathSync(path) === realpathSync(outside)) {
                        throw new Error('outside bytes were read');
                    }
                    return readFileSync(path);
                },
            };
            expect(hashInventoryFile(file, access)).toBe('missing');
            expect(lstatSync(file).isSymbolicLink()).toBe(true);
        });
    });

    it('hashes the opened regular object when its inventory path changes afterward', () => {
        withInventoryFiles((file, outside, originalHash) => {
            let closed = 0;
            const swap = () => {
                unlinkSync(file);
                symlinkSync(outside, file);
            };
            const access = {
                ...realInventoryFileAccess,
                lstat: (path: string) => {
                    const result = lstatSync(path);
                    swap();
                    return result;
                },
                open: (path: string, flags: number) => {
                    const fd = openSync(path, flags);
                    swap();
                    return fd;
                },
                read: (path: string | number) => {
                    expect(typeof path).toBe('number');
                    return readFileSync(path);
                },
                close: (fd: number) => {
                    closeSync(fd);
                    closed++;
                },
            };
            expect(hashInventoryFile(file, access)).toBe(originalHash);
            expect(closed).toBe(1);
            expect(lstatSync(file).isSymbolicLink()).toBe(true);
        });
    });

    it('closes the opened inventory descriptor when its read fails', () => {
        withInventoryFiles((file) => {
            const closedDescriptors: number[] = [];
            const access = {
                ...realInventoryFileAccess,
                read: (_path: string | number): Buffer => {
                    throw new Error('injected read failure');
                },
                close: (fd: number) => {
                    closeSync(fd);
                    closedDescriptors.push(fd);
                },
            };
            expect(() => hashInventoryFile(file, access)).toThrow('injected read failure');
            expect(closedDescriptors).toHaveLength(1);
            const closedFd = closedDescriptors[0];
            if (closedFd === undefined) {
                throw new Error('Expected an opened inventory descriptor to close');
            }
            expect(() => fstatSync(closedFd)).toThrow();
        });
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
        const sourceModes = { ...fixture().sourceModes, 'playwright.config.ts': '120000' };
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

    it('keeps an integration-only browser spec in the complete full fallback', () => {
        const extra = {
            path: 'tests/e2e/monoModulationInput.spec.ts',
            gitBlob: 'f'.repeat(40),
            sha256: 'f'.repeat(64),
            mode: '100644',
        };
        const integrationInventory = [...inventory, extra];
        const integrationSourceHashes = {
            ...fixture().integrationSourceHashes,
            'tests/e2e/smoke.spec.ts': '0'.repeat(64),
        };
        const report = measureShadow(
            fixture({
                integrationInventory,
                integrationSourceHashes,
                livePlan: selectValidationPlan(
                    [candidate],
                    integrationInventory.map((row) => row.path)
                ),
            })
        );
        expect(report.measurementStatus).toBe('complete');
        expect(report.counts).toEqual({ inventory: 314, candidate: 314, liveSelected: 314 });
        expect(report.candidateSpecs).toContain(extra.path);
        expect(report.fallbackReasons).toContain('scope-head-inventory-drift');
        expect(report.fallbackReasons).toContain('inventory-certificate-drift: paths');
        expect(report.fallbackReasons).toContain('integration-source-drift: tests/e2e/smoke.spec.ts');
        expect(report.obligationDispositions).toHaveLength(314);
        expect(report.obligationDispositions.find((row) => row.path === extra.path)?.disposition).toBe(
            'INTEGRATION_UNMAPPED'
        );
        expect(report.liveSelectedSpecs).toContain(extra.path);
    });

    it('keeps the complete integration plan when a regular validation workflow changes', () => {
        const extra = {
            path: 'tests/e2e/monoModulationInput.spec.ts',
            gitBlob: 'f'.repeat(40),
            sha256: 'f'.repeat(64),
            mode: '100644',
        };
        const integrationInventory = [...inventory, extra];
        const validationPath = '.github/workflows/validation.yml';
        const integrationValidationSha256 = '3edb4cafd1c0387e2e8709331639b0f7df448bbcb841bb7e5de4c113fcf4eb2b';
        const report = measureShadow(
            fixture({
                integrationInventory,
                integrationSourceHashes: {
                    ...fixture().integrationSourceHashes,
                    [validationPath]: integrationValidationSha256,
                },
                livePlan: selectValidationPlan(
                    [candidate],
                    integrationInventory.map((row) => row.path)
                ),
            })
        );
        expect(report.measurementStatus).toBe('complete');
        expect(report.counts).toEqual({ inventory: 314, candidate: 314, liveSelected: 314 });
        expect(report.candidateSpecs).toContain(extra.path);
        expect(report.liveSelectedSpecs).toContain(extra.path);
        expect(report.fallbackReasons).toContain(`integration-source-drift: ${validationPath}`);
        expect(report.obligationDispositions.find((row) => row.path === extra.path)?.disposition).toBe(
            'INTEGRATION_UNMAPPED'
        );
        expect(report.integrationSourceAndConfigurationSha256[validationPath]).toBe(integrationValidationSha256);
        expect(() =>
            measureShadow(
                fixture({
                    integrationInventory,
                    integrationSourceHashes: {
                        ...fixture().integrationSourceHashes,
                        [validationPath]: integrationValidationSha256,
                    },
                    livePlan: selectValidationPlan(
                        ['README.md'],
                        integrationInventory.map((row) => row.path)
                    ),
                })
            )
        ).toThrow('Authoritative scope artifact disagrees');
    });

    it('refuses unbound or nonregular validation workflow identities', () => {
        const validationPath = '.github/workflows/validation.yml';
        expect(() =>
            measureShadow(
                fixture({
                    sourceModes: { ...fixture().sourceModes, [validationPath]: '120000' },
                })
            )
        ).toThrow('Integration validation policy source is missing or nonregular');
        expect(() =>
            measureShadow(
                fixture({
                    sourceHashes: { ...fixture().sourceHashes, [validationPath]: 'missing-or-nonregular' },
                })
            )
        ).toThrow('Integration validation policy source is missing or nonregular');
        expect(() =>
            measureShadow(
                fixture({
                    integrationSourceHashes: {
                        ...fixture().integrationSourceHashes,
                        [validationPath]: 'missing-or-nonregular',
                    },
                })
            )
        ).toThrow('Integration validation policy source is missing or nonregular');
    });

    it('rejects an integration plan that does not match the authenticated inventory', () => {
        const integrationInventory = [
            ...inventory,
            {
                path: 'tests/e2e/monoModulationInput.spec.ts',
                gitBlob: 'f'.repeat(40),
                sha256: 'f'.repeat(64),
                mode: '100644',
            },
        ];
        expect(() => measureShadow(fixture({ integrationInventory }))).toThrow(
            'Authoritative scope artifact disagrees'
        );
        const livePlan = selectValidationPlan(
            [candidate],
            integrationInventory.map((row) => row.path)
        );
        expect(() =>
            measureShadow(fixture({ integrationInventory, livePlan: { ...livePlan, codeql: !livePlan.codeql } }))
        ).toThrow('Authoritative scope artifact disagrees');
    });

    it('refuses a changed integration selector or collector before authenticating the plan', () => {
        for (const path of ['scripts/prValidationScope.ts', 'scripts/vitestCollectionPatterns.ts']) {
            const integrationSourceHashes = { ...fixture().integrationSourceHashes, [path]: '0'.repeat(64) };
            expect(() => measureShadow(fixture({ integrationSourceHashes }))).toThrow(
                `Integration selector or collector differs from candidate head: ${path}`
            );
        }
    });

    it('refuses a changed integration Playwright or required execution policy', () => {
        for (const path of ['playwright.config.ts', '.github/workflows/heavy-gates.yml']) {
            const integrationSourceHashes = { ...fixture().integrationSourceHashes, [path]: '0'.repeat(64) };
            expect(() => measureShadow(fixture({ integrationSourceHashes }))).toThrow(
                `Integration execution policy differs from candidate head: ${path}`
            );
        }
    });

    it('keeps full fallback when an integration execution source differs', () => {
        const integrationSourceHashes = {
            ...fixture().integrationSourceHashes,
            'tests/e2e/smoke.spec.ts': '0'.repeat(64),
        };
        const report = measureShadow(fixture({ integrationSourceHashes }));
        expect(report.candidateSpecs).toHaveLength(313);
        expect(report.fallbackReasons).toContain('integration-source-drift: tests/e2e/smoke.spec.ts');
    });

    it('falls back when the immutable integration reader differs from its frozen rule', () => {
        const sourceHashes = {
            ...fixture().sourceHashes,
            'scripts/e2eSelectionShadowIntegration.ts': '0'.repeat(64),
        };
        expect(measureShadow(fixture({ sourceHashes })).fallbackReasons).toContain('integration-reader-drift');
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
