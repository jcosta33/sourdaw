#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_LICENSE_ID = 'Apache-2.0';
export const PROJECT_OWNER = 'Jose Costa';
export const PROJECT_NOTICE = `Sourdaw\nCopyright 2026 ${PROJECT_OWNER}\n\nThis product includes third-party software. See public/legal/THIRD-PARTY-NOTICES.md.\n`;
export const SPDX_OWNERSHIP_HEADER = `/* SPDX-FileCopyrightText: 2026 ${PROJECT_OWNER} */\n/* SPDX-License-Identifier: ${PROJECT_LICENSE_ID} */\n`;

const APACHE_LICENSE_SHA256 = 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4';
const OWNERSHIP_FILES = [
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
] as const;

type CargoMetadata = {
    packages: Array<{ name: string; license: string | null; authors: string[] }>;
};

function sha256(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readJson<TResult>(path: string): TResult {
    return JSON.parse(readFileSync(path, 'utf8')) as TResult;
}

export function validateProjectLicense(root: string, cargo: CargoMetadata): string[] {
    const errors: string[] = [];
    for (const path of ['LICENSE', 'public/legal/APACHE-2.0.txt']) {
        if (sha256(resolve(root, path)) !== APACHE_LICENSE_SHA256) {
            errors.push(`${path}: Apache-2.0 text drifted`);
        }
    }
    for (const path of ['NOTICE', 'public/legal/SOURDAW-NOTICE.txt']) {
        if (readFileSync(resolve(root, path), 'utf8') !== PROJECT_NOTICE) {
            errors.push(`${path}: project attribution drifted`);
        }
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
        if (!crate.authors.includes(PROJECT_OWNER)) {
            errors.push(`${crate.name}: Cargo authors must include ${PROJECT_OWNER}`);
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

export function checkProjectLicense(root: string): void {
    const cargo = JSON.parse(
        execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1'], {
            cwd: root,
            encoding: 'utf8',
        })
    ) as CargoMetadata;
    const errors = validateProjectLicense(root, cargo);
    if (errors.length > 0) {
        throw new Error(errors.join('\n'));
    }
    process.stdout.write(`project license valid: ${PROJECT_LICENSE_ID}, ${String(cargo.packages.length)} crates\n`);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === new URL(`file://${resolve(entry)}`).href) {
    checkProjectLicense(resolve(fileURLToPath(new URL('..', import.meta.url))));
}
