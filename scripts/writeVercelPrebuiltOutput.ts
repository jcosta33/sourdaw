#!/usr/bin/env node
/**
 * Writes a Vercel Build Output API v3 tree from the local Vite dist.
 *
 * `vercel pull` and `vercel build` GET /teams/ and 403 a project-scoped token
 * (vercel/vercel#17506). Nightly therefore builds locally and deploys with
 * `deploy --prebuilt`, which is the remaining CLI path that can proceed.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

type HeaderRoute = {
    readonly src: string;
    readonly headers: Record<string, string>;
    readonly continue: true;
};

type FilesystemHandle = {
    readonly handle: 'filesystem';
};

type SpaFallback = {
    readonly src: string;
    readonly dest: string;
};

type BuildOutputRoute = HeaderRoute | FilesystemHandle | SpaFallback;

type BuildOutputConfig = {
    readonly version: 3;
    readonly routes: readonly BuildOutputRoute[];
};

const SPA_FALLBACK: SpaFallback = { src: '/(.*)', dest: '/index.html' };
const SUCCESS_LOG = 'wrote the prebuilt Vercel output from the local dist';

function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function directoryContainsFile(directory: string): boolean {
    const entries = readdirSync(directory, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
        if (entry.isFile()) {
            return true;
        }
    }
    return false;
}

function requireDistDirectory(rootDirectory: string): string {
    const distDirectory = join(rootDirectory, 'dist');
    if (!existsSync(distDirectory) || !statSync(distDirectory).isDirectory()) {
        throw new Error('the Vite dist directory is missing');
    }
    if (!directoryContainsFile(distDirectory)) {
        throw new Error('the Vite dist directory contains no files');
    }
    return distDirectory;
}

function readVercelJson(rootDirectory: string): unknown {
    const path = join(rootDirectory, 'vercel.json');
    if (!existsSync(path)) {
        throw new Error('vercel.json is missing');
    }
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        throw new TypeError('vercel.json is malformed');
    }
}

function compileHeaderRoute(rule: unknown): HeaderRoute {
    const record = asRecord(rule);
    if (record === null) {
        throw new TypeError('vercel.json is malformed');
    }
    const source = typeof record.source === 'string' ? record.source : '';
    if (source === '') {
        throw new TypeError('vercel.json is malformed');
    }
    if (!Array.isArray(record.headers)) {
        throw new TypeError('vercel.json is malformed');
    }
    const headers: Record<string, string> = {};
    for (const entry of record.headers) {
        const header = asRecord(entry);
        const key = typeof header?.key === 'string' ? header.key : '';
        const value = typeof header?.value === 'string' ? header.value : '';
        if (key === '' || value === '') {
            throw new TypeError('vercel.json is malformed');
        }
        headers[key] = value;
    }
    if (Object.keys(headers).length === 0) {
        throw new Error('vercel.json has no isolation headers to compile');
    }
    return { src: source, headers, continue: true };
}

function compileHeaderRoutes(payload: unknown): HeaderRoute[] {
    const record = asRecord(payload);
    if (record === null) {
        throw new TypeError('vercel.json is malformed');
    }
    if (!Array.isArray(record.headers) || record.headers.length === 0) {
        throw new Error('vercel.json has no isolation headers to compile');
    }
    return record.headers.map(compileHeaderRoute);
}

function copyStaticOutput(rootDirectory: string, distDirectory: string): void {
    const outputDirectory = join(rootDirectory, '.vercel', 'output');
    const staticDirectory = join(outputDirectory, 'static');
    mkdirSync(outputDirectory, { recursive: true });
    rmSync(staticDirectory, { recursive: true, force: true });
    cpSync(distDirectory, staticDirectory, { recursive: true });
}

function writeBuildOutputConfig(rootDirectory: string, headerRoutes: readonly HeaderRoute[]): string {
    const outputDirectory = join(rootDirectory, '.vercel', 'output');
    mkdirSync(outputDirectory, { recursive: true });
    const config: BuildOutputConfig = {
        version: 3,
        routes: [...headerRoutes, { handle: 'filesystem' }, SPA_FALLBACK],
    };
    const configPath = join(outputDirectory, 'config.json');
    writeFileSync(configPath, `${JSON.stringify(config)}\n`, 'utf8');
    return configPath;
}

export function writeVercelPrebuiltOutput(rootDirectory: string): string {
    const distDirectory = requireDistDirectory(rootDirectory);
    const headerRoutes = compileHeaderRoutes(readVercelJson(rootDirectory));
    copyStaticOutput(rootDirectory, distDirectory);
    const configPath = writeBuildOutputConfig(rootDirectory, headerRoutes);
    console.log(SUCCESS_LOG);
    return configPath;
}

function main(): void {
    writeVercelPrebuiltOutput(process.cwd());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        main();
    } catch (error: unknown) {
        console.error(`could not write the prebuilt Vercel output: ${String(error)}`);
        process.exit(1);
    }
}
