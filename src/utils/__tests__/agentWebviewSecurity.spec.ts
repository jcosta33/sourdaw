import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type TauriConfiguration = {
    app: {
        security: {
            capabilities?: string[];
            csp: string;
            devCsp?: string;
        };
    };
};

type TauriCapability = {
    identifier: string;
    permissions: string[];
    remote?: unknown;
    windows: string[];
};

function readJson<T>(path: string): T {
    return JSON.parse(readFileSync(resolve(path), 'utf8')) as T;
}

function parseCsp(policy: string): Map<string, string[]> {
    const directives = new Map<string, string[]>();

    for (const entry of policy.split(';')) {
        const [name, ...sources] = entry.trim().split(/\s+/u);
        if (name) {
            directives.set(name, sources);
        }
    }

    return directives;
}

function extractMatches(source: string, pattern: RegExp): string[] {
    return [...source.matchAll(pattern)].flatMap((match) => (match[1] ? [match[1]] : []));
}

describe('packaged agent webview security boundary', () => {
    const configuration = readJson<TauriConfiguration>('src-tauri/tauri.conf.json');
    const capability = readJson<TauriCapability>('src-tauri/capabilities/default.json');

    it('separates development origins from the production CSP', () => {
        const production = parseCsp(configuration.app.security.csp);
        const development = parseCsp(configuration.app.security.devCsp ?? '');
        const productionSources = [...production.values()].flat();

        expect(production.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"]);
        expect(production.get('worker-src')).toEqual(["'self'", 'blob:']);
        expect(productionSources).not.toContain("'unsafe-eval'");
        expect(production.get('script-src')).not.toContain("'unsafe-inline'");
        expect(productionSources).not.toContain('http://localhost:*');
        expect(productionSources).not.toContain('ws://localhost:*');
        expect(productionSources).not.toContain('http:');
        expect(productionSources).not.toContain('ws:');
        expect(development.get('script-src')).toContain("'unsafe-eval'");
        expect(development.get('connect-src')).toContain('http://localhost:*');
        expect(development.get('connect-src')).toContain('ws://localhost:*');
    });

    it('admits only bundled workers and secure provider or model connections in production', () => {
        const production = parseCsp(configuration.app.security.csp);

        expect(production.get('connect-src')).toEqual(["'self'", 'ipc:', 'http://ipc.localhost', 'https:']);
        expect(production.get('object-src')).toEqual(["'none'"]);
        expect(production.get('base-uri')).toEqual(["'self'"]);
    });

    it('binds one non-remote capability to the main webview without overlapping grants', () => {
        expect(configuration.app.security.capabilities).toEqual(['default']);
        expect(capability).toMatchObject({
            identifier: 'default',
            windows: ['main'],
        });
        expect(capability.remote).toBeUndefined();
        expect(capability.permissions).toContain('allow-sourdaw-commands');
        expect(new Set(capability.permissions).size).toBe(capability.permissions.length);
    });

    it('keeps every registered custom command inside the main webview allowlist', () => {
        const registered = extractMatches(
            readFileSync('src-tauri/src/lib.rs', 'utf8'),
            /^\s*commands::[\w:]+::(\w+),$/gmu
        );
        const manifested = extractMatches(readFileSync('src-tauri/build.rs', 'utf8'), /^\s*"(\w+)",$/gmu);
        const allowed = extractMatches(
            readFileSync('src-tauri/permissions/sourdaw-commands.toml', 'utf8'),
            /^\s*"(\w+)",$/gmu
        );

        expect([...new Set(manifested)].sort()).toEqual([...new Set(registered)].sort());
        expect([...new Set(allowed)].sort()).toEqual([...new Set(registered)].sort());
        expect(manifested).toHaveLength(registered.length);
        expect(allowed).toHaveLength(registered.length);
    });
});
