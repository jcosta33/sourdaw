#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    buildDependencyLicenseArtifacts,
    DEPENDENCY_LICENSE_REPORT_PATH,
    SERVER_THIRD_PARTY_NOTICES_PATH,
    type DependencyLicenseArtifacts,
} from './dependencyLicenseReport.ts';
import { parseJsonWithUniqueKeys } from './strictJson.ts';

export const PROJECT_LICENSE_ID = 'Apache-2.0';
export const PROJECT_AUTHOR = 'Jose Costa';
export const PROJECT_COPYRIGHT_HOLDERS = 'Sourdaw Ltd. and Sourdaw contributors';
const RIGHTS_SCOPE_NOTICE =
    'The Apache-2.0 grant covers only rights licensable by Sourdaw Ltd. and contributors.\n' +
    'Third-party components remain under their own terms.\n';
export const PROJECT_NOTICE = `Sourdaw\nCopyright ${PROJECT_COPYRIGHT_HOLDERS}\n\n${RIGHTS_SCOPE_NOTICE}\nThis product includes third-party software. See public/legal/THIRD-PARTY-NOTICES.md.\n`;
export const DISTRIBUTION_PROJECT_NOTICE = `Sourdaw\nCopyright ${PROJECT_COPYRIGHT_HOLDERS}\n\n${RIGHTS_SCOPE_NOTICE}\nThis product includes third-party software. See THIRD-PARTY-NOTICES.md.\n`;
export const SPDX_OWNERSHIP_HEADER = `/* SPDX-FileCopyrightText: Copyright Sourdaw Ltd. */\n/* SPDX-License-Identifier: ${PROJECT_LICENSE_ID} */\n`;

const PROJECT_APACHE_LICENSE_SHA256 = 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4';
const DISTRIBUTED_APACHE_LICENSE_SHA256 = '84a271fd53a9c884c0bf6672ab87add1b06adb9302f898ba23b966d2ce6971a1';
const MI_PLAITS_DSP_RS_LICENSE_SHA256 = 'b2ec3cd241dd660bd4de9f07dd94ecce3ee9c696eaf15af7af68eae6ed4af04c';
const MUTABLE_INSTRUMENTS_PLAITS_LICENSE_SHA256 = '22f658d32f65c7c535005368d589dc056c0f8417f3f15190d151233de60957a0';
const OWNERSHIP_FILES = [
    '.dependency-cruiser.cjs',
    '.dependency-cruiser.shared.cjs',
    '.dependency-cruiser.tests.cjs',
    '.dependency-cruiser.types.cjs',
    '.dependency-cruiser.reachability.cjs',
    'src/infra/store/storage/LocalStorageKeys.ts',
    'src/modules/AiRuntime/models/ToolDefinitions.ts',
    'src/modules/AiRuntime/models/Tools/Types.ts',
    'src/modules/AiGeneration/models/MidiPatternType.ts',
] as const;
const RETIRED_PROJECT_LICENSE_MARKERS = [
    'pending:OS-10-project-grant',
    'pending:OS-10-project-license',
    'owner-created:pending-OS-10-project-license',
    'project grant and dependency notices pending OS-10',
    'individual dependency terms pending OS-10 notice assembly',
    'pending:OS-10-Cargo-dependency-notices',
    'Complete the OS-10 project grant before public release.',
    'apply the OS-10 project license',
    'Apply the project license in OS-10',
    'project grant',
] as const;

type CargoMetadata = {
    packages: Array<{ name: string; license: string | null; authors: string[] }>;
};

function sha256(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readJson<TResult>(path: string): TResult {
    return parseJsonWithUniqueKeys<TResult>(readFileSync(path, 'utf8'), path);
}

export function validateProjectLicense(root: string, cargo: CargoMetadata): string[] {
    const errors: string[] = [];
    for (const path of ['LICENSE', 'server/LICENSE']) {
        if (sha256(resolve(root, path)) !== PROJECT_APACHE_LICENSE_SHA256) {
            errors.push(`${path}: Apache-2.0 text drifted`);
        }
    }
    if (sha256(resolve(root, 'public/legal/Apache-2.0.txt')) !== DISTRIBUTED_APACHE_LICENSE_SHA256) {
        errors.push('public/legal/Apache-2.0.txt: Apache-2.0 text drifted');
    }
    if (readFileSync(resolve(root, 'NOTICE'), 'utf8') !== PROJECT_NOTICE) {
        errors.push('NOTICE: project attribution drifted');
    }
    for (const path of ['public/legal/SOURDAW-NOTICE.txt', 'server/NOTICE']) {
        if (readFileSync(resolve(root, path), 'utf8') !== DISTRIBUTION_PROJECT_NOTICE) {
            errors.push(`${path}: project attribution drifted`);
        }
    }
    if (sha256(resolve(root, 'public/legal/MI-PLAITS-DSP-RS-MIT.txt')) !== MI_PLAITS_DSP_RS_LICENSE_SHA256) {
        errors.push('public/legal/MI-PLAITS-DSP-RS-MIT.txt: upstream MIT license drifted');
    }
    if (
        sha256(resolve(root, 'public/legal/MUTABLE-INSTRUMENTS-PLAITS-MIT.txt')) !==
        MUTABLE_INSTRUMENTS_PLAITS_LICENSE_SHA256
    ) {
        errors.push('public/legal/MUTABLE-INSTRUMENTS-PLAITS-MIT.txt: original upstream MIT license drifted');
    }

    const packageFiles = ['package.json', 'server/package.json', 'server/package-lock.json'];
    for (const path of packageFiles) {
        const metadata = readJson<{ license?: string; packages?: Record<string, { license?: string }> }>(
            resolve(root, path)
        );
        const license = path.endsWith('package-lock.json') ? metadata.packages?.['']?.license : metadata.license;
        if (license !== PROJECT_LICENSE_ID) {
            errors.push(`${path}: license must be ${PROJECT_LICENSE_ID}`);
        }
    }
    for (const crate of cargo.packages) {
        if (crate.license !== PROJECT_LICENSE_ID) {
            errors.push(`${crate.name}: Cargo license must be ${PROJECT_LICENSE_ID}`);
        }
        if (!crate.authors.includes(PROJECT_AUTHOR)) {
            errors.push(`${crate.name}: Cargo authors must include ${PROJECT_AUTHOR}`);
        }
    }

    for (const path of OWNERSHIP_FILES) {
        const contents = readFileSync(resolve(root, path), 'utf8');
        if (!contents.startsWith(SPDX_OWNERSHIP_HEADER)) {
            errors.push(`${path}: SPDX ownership header drifted`);
        }
        if (/all rights reserved/iu.test(contents)) {
            errors.push(`${path}: stale proprietary ownership claim`);
        }
    }
    for (const path of [
        'release/open-source-inventory.json',
        'public/samples/levain/provenance.tsv',
        'public/legal/THIRD-PARTY-NOTICES.md',
        'scripts/checkLevainProvenance.ts',
        'scripts/checkReleaseInventory.ts',
    ]) {
        const contents = readFileSync(resolve(root, path), 'utf8');
        for (const marker of RETIRED_PROJECT_LICENSE_MARKERS) {
            if (contents.includes(marker)) {
                errors.push(`${path}: stale project-license marker ${marker}`);
            }
        }
    }
    return errors;
}

export function validateDependencyLicenseReport(root: string, expected: string): string[] {
    try {
        if (readFileSync(resolve(root, DEPENDENCY_LICENSE_REPORT_PATH), 'utf8') !== expected) {
            return [`${DEPENDENCY_LICENSE_REPORT_PATH}: dependency license report drifted`];
        }
    } catch {
        return [`${DEPENDENCY_LICENSE_REPORT_PATH}: dependency license report missing`];
    }
    return [];
}

export function validateServerThirdPartyNotices(root: string, expected: string): string[] {
    try {
        if (readFileSync(resolve(root, SERVER_THIRD_PARTY_NOTICES_PATH), 'utf8') !== expected) {
            return [`${SERVER_THIRD_PARTY_NOTICES_PATH}: third-party notices drifted`];
        }
    } catch {
        return [`${SERVER_THIRD_PARTY_NOTICES_PATH}: third-party notices missing`];
    }
    return [];
}

export function checkProjectLicense(
    root: string,
    artifactBuilder: (root: string) => DependencyLicenseArtifacts = buildDependencyLicenseArtifacts
): void {
    const cargo = parseJsonWithUniqueKeys<CargoMetadata>(
        execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1'], {
            cwd: root,
            encoding: 'utf8',
        }),
        'cargo metadata --no-deps --format-version 1'
    );
    const artifacts = artifactBuilder(root);
    const errors = [
        ...validateProjectLicense(root, cargo),
        ...validateDependencyLicenseReport(root, artifacts.report),
        ...validateServerThirdPartyNotices(root, artifacts.serverNotices),
    ];
    if (errors.length > 0) {
        throw new Error(errors.join('\n'));
    }
    process.stdout.write(`project license valid: ${PROJECT_LICENSE_ID}, ${String(cargo.packages.length)} crates\n`);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === new URL(`file://${resolve(entry)}`).href) {
    checkProjectLicense(resolve(fileURLToPath(new URL('..', import.meta.url))));
}
