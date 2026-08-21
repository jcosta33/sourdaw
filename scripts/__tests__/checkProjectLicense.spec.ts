import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    DISTRIBUTION_PROJECT_NOTICE,
    PROJECT_LICENSE_ID,
    PROJECT_NOTICE,
    PROJECT_AUTHOR,
    SPDX_OWNERSHIP_HEADER,
    validateDependencyLicenseReport,
    validateProjectLicense,
    validateServerThirdPartyNotices,
} from '../checkProjectLicense';
import {
    collectNpmLockDependencyLicenses,
    DEPENDENCY_LICENSE_REPORT_PATH,
    isPlatformRestrictedPackage,
    renderDependencyLicenseReport,
    renderServerThirdPartyNotices,
    SERVER_THIRD_PARTY_NOTICES_PATH,
    type DependencyLicenseRecord,
} from '../dependencyLicenseReport';

const ownershipFiles = [
    '.dependency-cruiser.cjs',
    '.dependency-cruiser.shared.cjs',
    '.dependency-cruiser.tests.cjs',
    '.dependency-cruiser.types.cjs',
    '.dependency-cruiser.reachability.cjs',
    'src/infra/store/storage/LocalStorageKeys.ts',
    'src/modules/AiRuntime/models/ToolDefinitions.ts',
    'src/modules/AiRuntime/models/Tools/Types.ts',
    'src/modules/AiGeneration/models/MidiPatternType.ts',
];

function write(root: string, path: string, contents: string): void {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
}

describe('project license', () => {
    let root: string;
    const cargo = {
        packages: [{ name: 'crate-one', license: PROJECT_LICENSE_ID, authors: [PROJECT_AUTHOR] }],
    };

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'sourdaw-project-license-'));
        const license = readFileSync(join(process.cwd(), 'LICENSE'), 'utf8');
        const distributedLicense = readFileSync(join(process.cwd(), 'public/legal/Apache-2.0.txt'), 'utf8');
        const serverThirdPartyNotices = readFileSync(join(process.cwd(), 'server/THIRD-PARTY-NOTICES.md'), 'utf8');
        const adaptedSourceLicense = readFileSync(join(process.cwd(), 'public/legal/MI-PLAITS-DSP-RS-MIT.txt'), 'utf8');
        const originalSourceLicense = readFileSync(
            join(process.cwd(), 'public/legal/MUTABLE-INSTRUMENTS-PLAITS-MIT.txt'),
            'utf8'
        );
        write(root, 'LICENSE', license);
        write(root, 'public/legal/Apache-2.0.txt', distributedLicense);
        write(root, 'server/LICENSE', license);
        write(root, 'NOTICE', PROJECT_NOTICE);
        write(root, 'public/legal/SOURDAW-NOTICE.txt', DISTRIBUTION_PROJECT_NOTICE);
        write(root, 'server/NOTICE', DISTRIBUTION_PROJECT_NOTICE);
        write(root, 'public/legal/THIRD-PARTY-NOTICES.md', '# Third-Party Notices\n');
        write(root, 'public/legal/MI-PLAITS-DSP-RS-MIT.txt', adaptedSourceLicense);
        write(root, 'public/legal/MUTABLE-INSTRUMENTS-PLAITS-MIT.txt', originalSourceLicense);
        write(root, 'server/THIRD-PARTY-NOTICES.md', serverThirdPartyNotices);
        write(root, 'package.json', JSON.stringify({ license: PROJECT_LICENSE_ID }));
        write(root, 'server/package.json', JSON.stringify({ license: PROJECT_LICENSE_ID }));
        write(root, 'server/package-lock.json', JSON.stringify({ packages: { '': { license: PROJECT_LICENSE_ID } } }));
        for (const path of ownershipFiles) {
            write(root, path, `${SPDX_OWNERSHIP_HEADER}export {};\n`);
        }
        for (const path of [
            'release/open-source-inventory.json',
            'public/samples/levain/provenance.tsv',
            'scripts/checkLevainProvenance.ts',
            'scripts/checkReleaseInventory.ts',
        ]) {
            write(root, path, 'current');
        }
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    it('accepts one project grant across source and shipped metadata', () => {
        expect(validateProjectLicense(root, cargo)).toEqual([]);
    });

    it('rejects canonical LICENSE drift independently', () => {
        write(root, 'LICENSE', 'wrong');
        expect(validateProjectLicense(root, cargo)).toContain('LICENSE: Apache-2.0 text drifted');
    });

    it('rejects shipped license and notice drift', () => {
        write(root, 'public/legal/Apache-2.0.txt', 'wrong');
        write(root, 'server/LICENSE', 'wrong');
        write(root, 'NOTICE', 'wrong');
        write(root, 'public/legal/SOURDAW-NOTICE.txt', 'wrong');
        write(root, 'server/NOTICE', 'wrong');
        write(root, 'public/legal/MI-PLAITS-DSP-RS-MIT.txt', 'wrong');
        write(root, 'public/legal/MUTABLE-INSTRUMENTS-PLAITS-MIT.txt', 'wrong');
        expect(validateProjectLicense(root, cargo)).toEqual(
            expect.arrayContaining([
                'public/legal/Apache-2.0.txt: Apache-2.0 text drifted',
                'server/LICENSE: Apache-2.0 text drifted',
                'NOTICE: project attribution drifted',
                'public/legal/SOURDAW-NOTICE.txt: project attribution drifted',
                'server/NOTICE: project attribution drifted',
                'public/legal/MI-PLAITS-DSP-RS-MIT.txt: upstream MIT license drifted',
                'public/legal/MUTABLE-INSTRUMENTS-PLAITS-MIT.txt: original upstream MIT license drifted',
            ])
        );
    });

    it('rejects package and crate metadata drift', () => {
        write(root, 'package.json', JSON.stringify({ license: 'MIT' }));
        expect(
            validateProjectLicense(root, {
                packages: [{ name: 'crate-one', license: null, authors: [] }],
            })
        ).toEqual(
            expect.arrayContaining([
                'package.json: license must be Apache-2.0',
                'crate-one: Cargo license must be Apache-2.0',
                'crate-one: Cargo authors must include Jose Costa',
            ])
        );
    });

    it('rejects server/package.json drift independently', () => {
        write(root, 'server/package.json', JSON.stringify({ license: 'MIT' }));
        expect(validateProjectLicense(root, cargo)).toContain('server/package.json: license must be Apache-2.0');
    });

    it('rejects server/package-lock.json drift independently', () => {
        write(root, 'server/package-lock.json', JSON.stringify({ packages: { '': { license: 'MIT' } } }));
        expect(validateProjectLicense(root, cargo)).toContain('server/package-lock.json: license must be Apache-2.0');
    });

    it('rejects stale proprietary headers and pending project grants', () => {
        write(root, ownershipFiles[0]!, 'all rights reserved');
        write(root, 'release/open-source-inventory.json', 'pending:OS-10-project-grant');
        expect(validateProjectLicense(root, cargo)).toEqual(
            expect.arrayContaining([
                `${ownershipFiles[0]}: SPDX ownership header drifted`,
                `${ownershipFiles[0]}: stale proprietary ownership claim`,
                'release/open-source-inventory.json: stale project-license marker pending:OS-10-project-grant',
            ])
        );
    });

    it('renders dependency identities and deduplicated exact legal files', () => {
        const legalFile = { label: 'LICENSE', sha256: 'a'.repeat(64), contents: 'exact terms\n' };
        const records: DependencyLicenseRecord[] = [
            { ecosystem: 'npm', name: 'zeta', version: '1.0.0', license: 'MIT', legalFiles: [legalFile] },
            { ecosystem: 'cargo', name: 'alpha', version: '2.0.0', license: 'Apache-2.0', legalFiles: [legalFile] },
            { ecosystem: 'npm', name: 'beta', version: '3.0.0', license: 'MIT', legalFiles: [legalFile] },
        ];

        const report = renderDependencyLicenseReport(records);
        expect(report).toContain('cargo:alpha@2.0.0 | Apache-2.0 | sha256:');
        expect(report).not.toContain('metadata-only');
        expect(report.match(/exact terms/gu)).toHaveLength(1);
    });

    it('fails dependency generation when exact legal text is unavailable', () => {
        expect(() =>
            renderDependencyLicenseReport([
                { ecosystem: 'npm', name: 'missing', version: '1.0.0', license: 'MIT', legalFiles: [] },
            ])
        ).toThrow('npm:missing@1.0.0: exact license and copyright notice could not be proven');
    });

    it('binds the report to both JavaScript lock graphs', () => {
        const legalFile = { label: 'LICENSE', sha256: 'a'.repeat(64), contents: 'exact terms\n' };
        const report = renderDependencyLicenseReport(
            [{ ecosystem: 'npm', name: 'alpha', version: '1.0.0', license: 'MIT', legalFiles: [legalFile] }],
            {
                'pnpm-lock.yaml': 'b'.repeat(64),
                'server/package-lock.json': 'c'.repeat(64),
            }
        );
        expect(report).toContain(`- pnpm-lock.yaml sha256:${'b'.repeat(64)}`);
        expect(report).toContain(`- server/package-lock.json sha256:${'c'.repeat(64)}`);
    });

    it('collects the standalone server production closure and exact ws legal file', () => {
        write(
            root,
            'server/package-lock.json',
            JSON.stringify({
                packages: {
                    '': { dependencies: { ws: '8.21.1' } },
                    'node_modules/ws': { version: '8.21.1', license: 'MIT' },
                    'node_modules/dev-only': { version: '1.0.0', license: 'MIT', dev: true },
                    'node_modules/unreachable': { version: '1.0.0', license: 'MIT' },
                },
            })
        );
        write(
            root,
            'server/node_modules/ws/package.json',
            JSON.stringify({ name: 'ws', version: '8.21.1', license: 'MIT' })
        );
        write(root, 'server/node_modules/ws/LICENSE', 'exact ws terms\n');

        expect(collectNpmLockDependencyLicenses(root)).toEqual([
            expect.objectContaining({
                ecosystem: 'npm',
                name: 'ws',
                version: '8.21.1',
                graphs: ['server/package-lock.json'],
                legalFiles: [expect.objectContaining({ contents: 'exact ws terms\n' })],
            }),
        ]);

        write(
            root,
            'server/node_modules/ws/package.json',
            JSON.stringify({ name: 'ws', version: '8.20.0', license: 'MIT' })
        );
        expect(() => collectNpmLockDependencyLicenses(root)).toThrow(
            'installed version does not match server/package-lock.json'
        );
    });

    it('excludes host-selected package archives from the cross-platform dependency report', () => {
        expect(isPlatformRestrictedPackage({ os: ['darwin'], cpu: ['arm64'] })).toBe(true);
        expect(isPlatformRestrictedPackage({ libc: ['glibc'] })).toBe(true);
        expect(isPlatformRestrictedPackage({ os: 'darwin' })).toBe(true);
        expect(isPlatformRestrictedPackage({ cpu: 'arm64' })).toBe(true);
        expect(isPlatformRestrictedPackage({ libc: 'musl' })).toBe(true);
        expect(isPlatformRestrictedPackage({})).toBe(false);
    });

    it('rejects dependency report drift and absence', () => {
        write(root, DEPENDENCY_LICENSE_REPORT_PATH, 'current');
        expect(validateDependencyLicenseReport(root, 'current')).toEqual([]);
        expect(validateDependencyLicenseReport(root, 'expected')).toEqual([
            `${DEPENDENCY_LICENSE_REPORT_PATH}: dependency license report drifted`,
        ]);
        rmSync(join(root, DEPENDENCY_LICENSE_REPORT_PATH));
        expect(validateDependencyLicenseReport(root, 'expected')).toEqual([
            `${DEPENDENCY_LICENSE_REPORT_PATH}: dependency license report missing`,
        ]);
    });

    it('generates the standalone server notice from the same exact dependency records', () => {
        const legalFile = { label: 'LICENSE', sha256: 'a'.repeat(64), contents: 'exact ws terms\n' };
        const expected = renderServerThirdPartyNotices([
            {
                ecosystem: 'npm',
                name: 'ws',
                version: '8.21.1',
                license: 'MIT',
                legalFiles: [legalFile],
                graphs: ['server/package-lock.json'],
            },
        ]);
        write(root, SERVER_THIRD_PARTY_NOTICES_PATH, expected);
        expect(validateServerThirdPartyNotices(root, expected)).toEqual([]);

        write(root, SERVER_THIRD_PARTY_NOTICES_PATH, expected.replace('exact ws terms', 'replacement'));
        expect(validateServerThirdPartyNotices(root, expected)).toEqual([
            `${SERVER_THIRD_PARTY_NOTICES_PATH}: third-party notices drifted`,
        ]);

        rmSync(join(root, SERVER_THIRD_PARTY_NOTICES_PATH));
        expect(validateServerThirdPartyNotices(root, expected)).toEqual([
            `${SERVER_THIRD_PARTY_NOTICES_PATH}: third-party notices missing`,
        ]);
    });
});
