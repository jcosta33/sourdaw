// @vitest-environment node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Alias, type ResolvedConfig, resolveConfig } from 'vite';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const PLUGIN_NAME = 'sourdaw-automerge-streaming-entry';
const base64Entry = fileURLToPath(new URL('./fullfat_base64.js', import.meta.resolve('@automerge/automerge')));
const streamingEntry = resolve(root, 'src/infra/automerge/automergeStreamingEntry.ts');
const appImporter = resolve(root, 'src/modules/CrdtDocument/repositories/automergeRepository.ts');

type ResolveIdHandler = (id: string, importer: string | undefined) => unknown;

function isResolveIdHandler(value: unknown): value is ResolveIdHandler {
    return typeof value === 'function';
}

function streamingResolveId(config: ResolvedConfig): ResolveIdHandler {
    const plugin = config.plugins.find((candidate) => candidate.name === PLUGIN_NAME);
    const hook: unknown = plugin?.resolveId;
    const handler = typeof hook === 'object' && hook !== null && 'handler' in hook ? hook.handler : hook;
    if (!isResolveIdHandler(handler)) {
        throw new TypeError(`${PLUGIN_NAME} must be registered with a resolveId hook`);
    }
    return handler;
}

function aliasMatches(alias: Alias, id: string): boolean {
    if (typeof alias.find === 'string') {
        return id === alias.find || id.startsWith(`${alias.find}/`);
    }
    return alias.find.test(id);
}

function aliasesMatching(config: ResolvedConfig, id: string): Alias[] {
    return config.resolve.alias.filter((alias) => aliasMatches(alias, id));
}

describe('Automerge streaming-entry redirect', () => {
    it.each([
        ['an app build', 'production', 'build'],
        ['the dev server', 'e2e', 'serve'],
    ] as const)('redirects the base64 entry to the streaming entry for %s', async (_label, mode, command) => {
        const config = await resolveConfig({ root, mode }, command);
        const resolveId = streamingResolveId(config);

        expect(await resolveId(base64Entry, appImporter)).toBe(streamingEntry);
        expect(await resolveId(base64Entry, streamingEntry)).toBeNull();
        expect(await resolveId('@automerge/automerge/slim', appImporter)).toBeNull();
    });

    it('aliases exactly the bare package specifier to the base64 entry', async () => {
        const config = await resolveConfig({ root, mode: 'production' }, 'build');

        expect(aliasesMatching(config, '@automerge/automerge').map((alias) => alias.replacement)).toEqual([
            base64Entry,
        ]);
        expect(aliasesMatching(config, '@automerge/automerge/slim')).toEqual([]);
        expect(aliasesMatching(config, '@automerge/automerge/automerge.wasm?url')).toEqual([]);
    });

    it('keeps Vitest on the base64 entry', async () => {
        const config = await resolveConfig({ root, mode: 'test' }, 'serve');

        expect(config.plugins.some((plugin) => plugin.name === PLUGIN_NAME)).toBe(false);
    });

    it('keeps IIFE build workers on the base64 entry', async () => {
        const config = await resolveConfig({ root, mode: 'production' }, 'build');
        const workerConfig = await config.worker.plugins([]);

        expect(config.worker.format).toBe('iife');
        expect(workerConfig.plugins.some((plugin) => plugin.name === PLUGIN_NAME)).toBe(false);
    });
});
