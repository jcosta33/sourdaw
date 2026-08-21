#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type DdspTfjsBundlePackage = { name: string; version: string };

/**
 * Exact third-party package closure observed in the production TFJS worker source map.
 *
 * The worker imports the aggregate `@tensorflow/tfjs` entry point, so its bundle carries CPU and
 * WebGL fallback code, TFJS data/layers, `long`, and `seedrandom` even though DDSP admission later
 * requires the selected runtime backend to be WebGPU.
 */
export const DDSP_TFJS_BUNDLE_PACKAGES = [
    { name: '@tensorflow/tfjs', version: '4.22.0' },
    { name: '@tensorflow/tfjs-backend-cpu', version: '4.22.0' },
    { name: '@tensorflow/tfjs-backend-webgl', version: '4.22.0' },
    { name: '@tensorflow/tfjs-backend-webgpu', version: '4.22.0' },
    { name: '@tensorflow/tfjs-converter', version: '4.22.0' },
    { name: '@tensorflow/tfjs-core', version: '4.22.0' },
    { name: '@tensorflow/tfjs-data', version: '4.22.0' },
    { name: '@tensorflow/tfjs-layers', version: '4.22.0' },
    { name: 'long', version: '4.0.0' },
    { name: 'seedrandom', version: '3.0.5' },
] as const satisfies readonly DdspTfjsBundlePackage[];

type SourceMap = { sources: string[] };

function parseSourceMap(value: string): SourceMap {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch (error) {
        throw new Error('DDSP TFJS worker source map is malformed', { cause: error });
    }
    if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !Array.isArray((parsed as { sources?: unknown }).sources) ||
        !(parsed as { sources: unknown[] }).sources.every((source) => typeof source === 'string')
    ) {
        throw new Error('DDSP TFJS worker source map is missing string sources');
    }
    return parsed as SourceMap;
}

function packageFromPnpmSource(source: string): DdspTfjsBundlePackage | undefined {
    const match = /(?:^|\/)node_modules\/\.pnpm\/([^/]+)\/node_modules\/((?:@[^/]+\/)?[^/]+)\//u.exec(source);
    const store = match?.[1];
    const name = match?.[2];
    if (store === undefined || name === undefined) {
        return undefined;
    }
    const prefix = `${name.replace('/', '+')}@`;
    if (!store.startsWith(prefix)) {
        throw new Error(`DDSP TFJS worker source map has unreadable package path: ${source}`);
    }
    const version = store.slice(prefix.length).split('_', 1)[0];
    if (version === undefined || version === '') {
        throw new Error(`DDSP TFJS worker source map has unreadable package version: ${source}`);
    }
    return { name, version };
}

function packageKey(value: DdspTfjsBundlePackage): string {
    return `${value.name}@${value.version}`;
}

export function assertDdspTfjsWorkerBundleClosure(sourceMapText: string): readonly DdspTfjsBundlePackage[] {
    const actual = [
        ...new Map(
            parseSourceMap(sourceMapText)
                .sources.map(packageFromPnpmSource)
                .filter((entry): entry is DdspTfjsBundlePackage => entry !== undefined)
                .map((entry) => [packageKey(entry), entry])
        ).values(),
    ].sort((left, right) => packageKey(left).localeCompare(packageKey(right)));
    const expected = [...DDSP_TFJS_BUNDLE_PACKAGES].sort((left, right) =>
        packageKey(left).localeCompare(packageKey(right))
    );
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(
            `DDSP TFJS worker bundle closure does not match: expected ${expected.map(packageKey).join(', ')}; ` +
                `actual ${actual.map(packageKey).join(', ')}`
        );
    }
    return DDSP_TFJS_BUNDLE_PACKAGES;
}

export function findDdspTfjsWorkerSourceMap(root: string): string | undefined {
    const assets = resolve(root, 'dist/assets');
    if (!existsSync(assets)) {
        return undefined;
    }
    const matches = readdirSync(assets)
        .filter((name) => /^tfjsInferenceWorker-[A-Za-z0-9_-]+\.js\.map$/u.test(name))
        .sort();
    if (matches.length > 1) {
        throw new Error(`multiple DDSP TFJS worker source maps found: ${matches.join(', ')}`);
    }
    return matches[0] === undefined ? undefined : join(assets, matches[0]);
}

export function checkDdspTfjsWorkerBundle(root: string, requireBundle = true): void {
    const sourceMap = findDdspTfjsWorkerSourceMap(root);
    if (sourceMap === undefined) {
        if (requireBundle) {
            throw new Error('production build did not emit a DDSP TFJS worker source map');
        }
        return;
    }
    assertDdspTfjsWorkerBundleClosure(readFileSync(sourceMap, 'utf8'));
}

const entry = process.argv[1];
if (entry !== undefined && fileURLToPath(import.meta.url) === resolve(entry)) {
    try {
        checkDdspTfjsWorkerBundle(resolve(fileURLToPath(new URL('..', import.meta.url))));
        process.stdout.write(`DDSP TFJS worker closure valid: ${String(DDSP_TFJS_BUNDLE_PACKAGES.length)} packages\n`);
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}
