import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    assertLicenseExpressionEvidence,
    collectNpmLockDependencyLicenses,
    DEPENDENCY_LICENSE_PROOFS_PATH,
    DEPENDENCY_LICENSE_REPORT_PATH,
    assertPlatformRestrictedNpmPackage,
    isPlatformRestrictedPackage,
    readLegalFile,
    readDependencyLicenseProofManifest,
    renderDependencyLicenseReport,
    renderServerThirdPartyNotices,
    SERVER_THIRD_PARTY_NOTICES_PATH,
    validateDependencyLicenseProof,
    type DependencyLicenseProof,
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

    it('rejects duplicate keys in every project package manifest', () => {
        write(root, 'package.json', '{"license":"MIT","license":"Apache-2.0"}');
        expect(() => validateProjectLicense(root, cargo)).toThrow('package.json: duplicate key');

        write(root, 'package.json', JSON.stringify({ license: PROJECT_LICENSE_ID }));
        write(root, 'server/package.json', '{"license":"MIT","license":"Apache-2.0"}');
        expect(() => validateProjectLicense(root, cargo)).toThrow('server/package.json: duplicate key');

        write(root, 'server/package.json', JSON.stringify({ license: PROJECT_LICENSE_ID }));
        write(root, 'server/package-lock.json', '{"packages":{"":{"license":"MIT","license":"Apache-2.0"}}}');
        expect(() => validateProjectLicense(root, cargo)).toThrow('server/package-lock.json: duplicate key');
    });

    it('rejects server/package.json drift independently', () => {
        write(root, 'server/package.json', JSON.stringify({ license: 'MIT' }));
        expect(validateProjectLicense(root, cargo)).toContain('server/package.json: license must be Apache-2.0');
    });

    it('rejects server/package-lock.json drift independently', () => {
        write(root, 'server/package-lock.json', JSON.stringify({ packages: { '': { license: 'MIT' } } }));
        expect(validateProjectLicense(root, cargo)).toContain('server/package-lock.json: license must be Apache-2.0');
    });

    it('rejects stale proprietary headers and retired project-grant obligations', () => {
        write(root, ownershipFiles[0]!, 'all rights reserved');
        write(
            root,
            'release/open-source-inventory.json',
            'pending:OS-10-project-grant\nComplete the OS-10 project grant before public release.\n' +
                'apply the OS-10 project license\nApply the project license in OS-10'
        );
        expect(validateProjectLicense(root, cargo)).toEqual(
            expect.arrayContaining([
                `${ownershipFiles[0]}: SPDX ownership header drifted`,
                `${ownershipFiles[0]}: stale proprietary ownership claim`,
                'release/open-source-inventory.json: stale project-license marker pending:OS-10-project-grant',
                'release/open-source-inventory.json: stale project-license marker Complete the OS-10 project grant before public release.',
                'release/open-source-inventory.json: stale project-license marker apply the OS-10 project license',
                'release/open-source-inventory.json: stale project-license marker Apply the project license in OS-10',
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

    it('collects root server dependencies and optional dependencies without server/node_modules', () => {
        write(
            root,
            'server/package-lock.json',
            JSON.stringify({
                packages: {
                    '': { dependencies: { ws: '8.21.1' }, optionalDependencies: { optional: '2.0.0' } },
                    'node_modules/ws': {
                        version: '8.21.1',
                        license: 'MIT',
                        resolved: 'https://registry.npmjs.org/ws/-/ws-8.21.1.tgz',
                        integrity: 'sha512-ws',
                    },
                    'node_modules/optional': {
                        version: '2.0.0',
                        license: 'MIT',
                        resolved: 'https://registry.npmjs.org/optional/-/optional-2.0.0.tgz',
                        integrity: 'sha512-optional',
                    },
                    'node_modules/dev-only': { version: '1.0.0', license: 'MIT', dev: true },
                    'node_modules/unreachable': { version: '1.0.0', license: 'MIT' },
                },
            })
        );
        expect(collectNpmLockDependencyLicenses(root)).toEqual([
            expect.objectContaining({ name: 'optional', version: '2.0.0' }),
            expect.objectContaining({
                ecosystem: 'npm',
                name: 'ws',
                version: '8.21.1',
                graphs: ['server/package-lock.json'],
                legalFiles: [],
            }),
        ]);
    });

    it('excludes host-selected package archives from the cross-platform dependency report', () => {
        expect(isPlatformRestrictedPackage({ os: ['darwin'], cpu: ['arm64'] })).toBe(true);
        expect(isPlatformRestrictedPackage({ libc: ['glibc'] })).toBe(true);
        expect(isPlatformRestrictedPackage({ os: 'darwin' })).toBe(true);
        expect(isPlatformRestrictedPackage({ cpu: 'arm64' })).toBe(true);
        expect(isPlatformRestrictedPackage({ libc: 'musl' })).toBe(true);
        expect(isPlatformRestrictedPackage({})).toBe(false);
        expect(() => assertPlatformRestrictedNpmPackage('unknown-native@1.0.0')).toThrow(
            'platform-restricted production package has no audited shipped-closure classification'
        );
        expect(() => assertPlatformRestrictedNpmPackage('@rollup/rollup-linux-x64-gnu@4.60.1')).not.toThrow();
        expect(() => assertPlatformRestrictedNpmPackage('@rollup/rollup-win32-x64-msvc@4.60.1')).not.toThrow();
        expect(() => assertPlatformRestrictedNpmPackage('fsevents@2.3.3')).not.toThrow();
        expect(() => assertPlatformRestrictedNpmPackage('@rollup/rollup-linux-x64-gnu@4.60.2')).toThrow(
            'platform-restricted production package has no audited shipped-closure classification'
        );
    });

    it('rejects an empty installed legal file directly', () => {
        const path = join(root, 'empty-LICENSE');
        write(root, 'empty-LICENSE', '');
        expect(() => readLegalFile(path, 'empty-LICENSE')).toThrow('empty-LICENSE: legal file is empty');
    });

    it('marks the intended WASM package when run from a crate directory', () => {
        const helperRoot = mkdtempSync(join(tmpdir(), 'sourdaw-mark-wasm-package-'));
        try {
            const sourceHelper = join(dirname(fileURLToPath(import.meta.url)), '..', 'markWasmPackageInternal.ts');
            const helper = join(helperRoot, 'scripts/markWasmPackageInternal.ts');
            const packagePath = join(helperRoot, 'public/wasm/daw-dsp/package.json');
            const crateDirectory = join(helperRoot, 'crates/daw-dsp');
            mkdirSync(dirname(helper), { recursive: true });
            mkdirSync(dirname(packagePath), { recursive: true });
            mkdirSync(crateDirectory, { recursive: true });
            writeFileSync(helper, readFileSync(sourceHelper));
            writeFileSync(packagePath, '{"name":"daw-dsp","private":false}\n');

            execFileSync(process.execPath, [helper, 'daw-dsp'], { cwd: crateDirectory, encoding: 'utf8' });

            expect(JSON.parse(readFileSync(packagePath, 'utf8'))).toMatchObject({ private: true });
            expect(existsSync(join(crateDirectory, 'public/wasm/daw-dsp/package.json'))).toBe(false);
        } finally {
            rmSync(helperRoot, { recursive: true, force: true });
        }
    });

    it('rejects empty, unrelated, stale, and unbound fallback proof evidence', () => {
        const record: DependencyLicenseRecord = {
            ecosystem: 'npm',
            name: 'example',
            version: '1.0.0',
            license: 'MIT',
            legalFiles: [],
        };
        write(
            root,
            'pnpm-lock.yaml',
            'lockfileVersion: 9.0\npackages:\n  example@1.0.0:\n    resolution:\n      integrity: sha512-example\n'
        );
        const path = 'release/dependency-license-proofs/example-1.0.0-LICENSE';
        const mitTerms = readFileSync(join(process.cwd(), 'public/legal/MI-PLAITS-DSP-RS-MIT.txt'), 'utf8');
        write(root, path, mitTerms);
        const digest = (contents: string): string => createHash('sha256').update(contents).digest('hex');
        const proof: DependencyLicenseProof = {
            source: 'npm:example@1.0.0',
            revision: 'sha512-example',
            files: [{ path, sourcePath: 'LICENSE', sha256: digest(mitTerms) }],
        };

        expect(validateDependencyLicenseProof(root, record, proof)).toHaveLength(1);

        write(root, path, '');
        expect(() => validateDependencyLicenseProof(root, record, proof)).toThrow('legal file is empty');

        write(root, path, 'Apache License, Version 2.0\nCopyright Example\n');
        proof.files![0]!.sha256 = digest('Apache License, Version 2.0\nCopyright Example\n');
        expect(() => validateDependencyLicenseProof(root, record, proof)).toThrow(
            'does not substantiate declared license MIT'
        );

        write(root, path, mitTerms);
        expect(() => validateDependencyLicenseProof(root, record, proof)).toThrow('dependency proof drifted');

        proof.files![0]!.sha256 = digest(mitTerms);
        proof.revision = 'sha512-stale';
        expect(() => validateDependencyLicenseProof(root, record, proof)).toThrow(
            'proof source identity does not match'
        );

        proof.revision = 'sha512-example';
        proof.files![0]!.path = 'LICENSE';
        expect(() => validateDependencyLicenseProof(root, record, proof)).toThrow('proof path escapes');
    });

    it('confines checked-in proof files to the exact proof root', () => {
        const record: DependencyLicenseRecord = {
            ecosystem: 'npm',
            name: 'example',
            version: '1.0.0',
            license: 'MIT',
            legalFiles: [],
        };
        write(
            root,
            'pnpm-lock.yaml',
            'lockfileVersion: 9.0\npackages:\n  example@1.0.0:\n    resolution:\n      integrity: sha512-example\n'
        );
        const contents = readFileSync(join(process.cwd(), 'public/legal/MI-PLAITS-DSP-RS-MIT.txt'), 'utf8');
        const digest = createHash('sha256').update(contents).digest('hex');
        const proof: DependencyLicenseProof = {
            source: 'npm:example@1.0.0',
            revision: 'sha512-example',
            files: [
                {
                    path: 'release/dependency-license-proofs/../outside-LICENSE',
                    sourcePath: 'LICENSE',
                    sha256: digest,
                },
            ],
        };
        write(root, 'release/dependency-license-proofs/placeholder', 'x');
        write(root, 'release/outside-LICENSE', contents);
        expect(() => validateDependencyLicenseProof(root, record, proof)).toThrow(
            'proof path escapes release/dependency-license-proofs/'
        );

        proof.files![0]!.path = 'release/dependency-license-proofs-confused/example-LICENSE';
        write(root, proof.files![0]!.path, contents);
        expect(() => validateDependencyLicenseProof(root, record, proof)).toThrow(
            'proof path escapes release/dependency-license-proofs/'
        );
    });

    it('enforces SPDX AND, OR, and WITH semantics against full terms', () => {
        const mit = readFileSync(join(process.cwd(), 'public/legal/MI-PLAITS-DSP-RS-MIT.txt'), 'utf8');
        const apache = readFileSync(join(process.cwd(), 'LICENSE'), 'utf8');
        const legal = (contents: string) => [{ label: 'LICENSE', sha256: 'a'.repeat(64), contents }];

        expect(() => assertLicenseExpressionEvidence('npm:example@1', 'MIT AND Apache-2.0', legal(mit))).toThrow(
            'does not substantiate'
        );
        expect(() => assertLicenseExpressionEvidence('npm:example@1', 'MIT OR Apache-2.0', legal(mit))).not.toThrow();
        expect(() =>
            assertLicenseExpressionEvidence('npm:example@1', 'Apache-2.0 WITH LLVM-exception', legal(apache))
        ).toThrow('does not substantiate');
        expect(() =>
            assertLicenseExpressionEvidence(
                'npm:example@1',
                'Apache-2.0 WITH LLVM-exception',
                legal(
                    `${apache}\nLLVM Exceptions to the Apache 2.0 License\nlimitations under the License with the following exceptions`
                )
            )
        ).not.toThrow();
    });

    it('rejects false-positive words and metadata-only evidence', () => {
        const legal = (contents: string) => [{ label: 'package.json', sha256: 'a'.repeat(64), contents }];
        expect(() =>
            assertLicenseExpressionEvidence('npm:example@1', 'MIT', legal('license copyright permission'))
        ).toThrow('does not substantiate');
        expect(() =>
            assertLicenseExpressionEvidence(
                'npm:example@1',
                'ISC',
                legal('{"name":"example","license":"ISC","author":"Example"}')
            )
        ).toThrow('does not substantiate');
    });

    it('builds honest assembled evidence from locked metadata and pinned SPDX text', () => {
        const metadataContents = '{"name":"example","version":"1.0.0","author":"Example","license":"MIT"}\n';
        const metadata = {
            label: 'package.json',
            sha256: createHash('sha256').update(metadataContents).digest('hex'),
            contents: metadataContents,
        };
        const record: DependencyLicenseRecord = {
            ecosystem: 'npm',
            name: 'example',
            version: '1.0.0',
            license: 'MIT',
            legalFiles: [],
            metadataFiles: [metadata],
        };
        write(
            root,
            'pnpm-lock.yaml',
            'lockfileVersion: 9.0\npackages:\n  example@1.0.0:\n    resolution:\n      integrity: sha512-example\n'
        );
        write(
            root,
            'release/spdx-license-texts/MIT.txt',
            readFileSync(join(process.cwd(), 'release/spdx-license-texts/MIT.txt'), 'utf8')
        );
        const proof: DependencyLicenseProof = {
            source: 'npm:example@1.0.0',
            revision: 'sha512-example',
            assembled: {
                metadata: [{ sourcePath: metadata.label, sha256: metadata.sha256 }],
                licenses: ['MIT'],
            },
        };

        const [notice] = validateDependencyLicenseProof(root, record, proof);
        expect(notice?.contents).toContain('assembled evidence, not an upstream file');
        expect(notice?.contents).toContain(metadataContents.trim());
        expect(notice?.contents).toContain('canonical SPDX MIT');

        proof.assembled!.metadata[0]!.sha256 = '0'.repeat(64);
        expect(() => validateDependencyLicenseProof(root, record, proof)).toThrow('assembled proof metadata drifted');
    });

    it('rejects duplicate keys in the dependency proof manifest', () => {
        write(root, DEPENDENCY_LICENSE_PROOFS_PATH, '{"schemaVersion":3,"schemaVersion":3,"packages":{}}');
        expect(() => readDependencyLicenseProofManifest(root)).toThrow('duplicate key');
    });

    it('validates the current aws-lc compound expression branch by branch', () => {
        const apache = readFileSync(join(process.cwd(), 'LICENSE'), 'utf8');
        const mit = readFileSync(join(process.cwd(), 'public/legal/MI-PLAITS-DSP-RS-MIT.txt'), 'utf8');
        const isc =
            'Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted.\n' +
            'THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES, INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY.\n';
        const bsd =
            'Redistribution and use in source and binary forms are permitted. Redistributions of source code must retain this notice. ' +
            'Redistributions in binary form must reproduce this notice. Neither the name of Example nor the names of its contributors may be used to endorse. ' +
            'THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS".\n';
        const mitZero =
            'MIT No Attribution\nPermission is hereby granted, free of charge. THE SOFTWARE IS PROVIDED "AS IS".\n';
        const files = [
            { label: 'LICENSE', sha256: 'a'.repeat(64), contents: `${apache}\n${mit}\n${isc}\n${bsd}\n${mitZero}` },
        ];
        expect(() =>
            assertLicenseExpressionEvidence(
                'cargo:aws-lc-sys@0.44.0',
                'ISC AND (Apache-2.0 OR ISC) AND Apache-2.0 AND MIT AND BSD-3-Clause AND ' +
                    '(Apache-2.0 OR ISC OR MIT) AND (Apache-2.0 OR ISC OR MIT-0)',
                files
            )
        ).not.toThrow();
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
