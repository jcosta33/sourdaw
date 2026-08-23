#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageName = process.argv[2];
if (packageName === undefined || !/^[a-z0-9-]+$/u.test(packageName)) {
    throw new Error('usage: node scripts/markWasmPackageInternal.ts <package>');
}

const repositoryRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const path = resolve(repositoryRoot, 'public/wasm', packageName, 'package.json');
const metadata = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
metadata.private = true;
writeFileSync(path, `${JSON.stringify(metadata, null, 2)}\n`);
