#!/usr/bin/env node

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDependencyLicenseReport, DEPENDENCY_LICENSE_REPORT_PATH } from './dependencyLicenseReport.ts';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
writeFileSync(resolve(root, DEPENDENCY_LICENSE_REPORT_PATH), buildDependencyLicenseReport(root), 'utf8');
process.stdout.write(`wrote ${DEPENDENCY_LICENSE_REPORT_PATH}\n`);
