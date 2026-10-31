// @vitest-environment node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Alias, createServer, type ResolvedConfig, resolveConfig } from 'vite';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const PLUGIN_NAME = 'sourdaw-automerge-streaming-entry';
const base64Entry = fileURLToPath(new URL('./fullfat_base64.js', import.meta.resolve('@automerge/automerge')));
const streamingEntry = resolve(root, 'src/infra/automerge/automergeStreamingEntry.ts');
const appImporter = resolve(root, 'src/modules/CrdtDocument/repositories/automergeRepository.ts');

async function resolveThroughDevServer(importer: string): Promise<string | undefined> {
    const server = await createServer({
        root,
        mode: 'development',
        logLevel: 'silent',
        server: { middlewareMode: true, hmr: false },
    });
    try {
        const resolved = await server.environments.client.pluginContainer.resolveId('@automerge/automerge', importer);
        return resolved?.id;
    } finally {
        await server.close();
    }
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
    it('resolves the app import to the streaming entry through the dev server plugin container', async () => {
        expect(await resolveThroughDevServer(appImporter)).toBe(streamingEntry);
    });

    it('lets the streaming entry itself reach the package', async () => {
        expect(await resolveThroughDevServer(streamingEntry)).not.toBe(streamingEntry);
    });

    it('runs the redirect before Vite resolves the aliased path in an app build', async () => {
        // A build environment exposes no plugin container; Rolldown runs the
        // resolved plugin list in this order, and Vite's resolver answers the
        // aliased absolute path for any plugin placed after it.
        const config = await resolveConfig({ root, mode: 'production' }, 'build');
        const names = config.plugins.map((plugin) => plugin.name);

        expect(names).toContain(PLUGIN_NAME);
        expect(names).toContain('vite:resolve-builtin');
        expect(names.indexOf(PLUGIN_NAME)).toBeLessThan(names.indexOf('vite:resolve-builtin'));
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
