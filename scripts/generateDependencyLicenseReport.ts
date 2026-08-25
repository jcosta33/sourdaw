#!/usr/bin/env node

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    buildDependencyLicenseArtifacts,
    DEPENDENCY_LICENSE_REPORT_PATH,
    SERVER_THIRD_PARTY_NOTICES_PATH,
} from './dependencyLicenseReport.ts';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const artifacts = buildDependencyLicenseArtifacts(root);
writeFileSync(resolve(root, DEPENDENCY_LICENSE_REPORT_PATH), artifacts.report, 'utf8');
writeFileSync(resolve(root, SERVER_THIRD_PARTY_NOTICES_PATH), artifacts.serverNotices, 'utf8');
process.stdout.write(`wrote ${DEPENDENCY_LICENSE_REPORT_PATH} and ${SERVER_THIRD_PARTY_NOTICES_PATH}\n`);
