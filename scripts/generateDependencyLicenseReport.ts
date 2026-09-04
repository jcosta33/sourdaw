#!/usr/bin/env node

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    buildDependencyLicenseArtifactsFromInstalledMetadata,
    DEPENDENCY_LICENSE_PROOFS_PATH,
    DEPENDENCY_LICENSE_REPORT_PATH,
    SERVER_THIRD_PARTY_NOTICES_PATH,
    type GeneratedDependencyLicenseArtifacts,
} from './dependencyLicenseReport.ts';

export const DEPENDENCY_LICENSE_ARTIFACT_PATHS = [
    DEPENDENCY_LICENSE_PROOFS_PATH,
    DEPENDENCY_LICENSE_REPORT_PATH,
    SERVER_THIRD_PARTY_NOTICES_PATH,
] as const;

/** Builds every artifact before writing any, so a rejected proof leaves the tree as it was. */
export function writeDependencyLicenseArtifacts(
    root: string,
    build: (root: string) => GeneratedDependencyLicenseArtifacts = buildDependencyLicenseArtifactsFromInstalledMetadata
): void {
    const artifacts = build(root);
    writeFileSync(resolve(root, DEPENDENCY_LICENSE_PROOFS_PATH), artifacts.proofManifest, 'utf8');
    writeFileSync(resolve(root, DEPENDENCY_LICENSE_REPORT_PATH), artifacts.report, 'utf8');
    writeFileSync(resolve(root, SERVER_THIRD_PARTY_NOTICES_PATH), artifacts.serverNotices, 'utf8');
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === new URL(`file://${resolve(entry)}`).href) {
    writeDependencyLicenseArtifacts(resolve(fileURLToPath(new URL('..', import.meta.url))));
    process.stdout.write(
        `wrote ${DEPENDENCY_LICENSE_PROOFS_PATH}, ${DEPENDENCY_LICENSE_REPORT_PATH}, and ${SERVER_THIRD_PARTY_NOTICES_PATH}\n`
    );
}
