// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Alias, build, createServer, type Plugin, type ResolvedConfig, resolveConfig, type Rolldown } from 'vite';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const PLUGIN_NAME = 'sourdaw-automerge-streaming-entry';
const PROBE_ENTRY = 'virtual:automerge-streaming-probe';
const base64Entry = fileURLToPath(new URL('./fullfat_base64.js', import.meta.resolve('@automerge/automerge')));
const wasmBase64Excerpt = readFileSync(new URL('../../automerge.wasm', import.meta.resolve('@automerge/automerge')))
    .toString('base64')
    .slice(1_000, 1_060);
const streamingEntry = resolve(root, 'src/infra/automerge/automergeStreamingEntry.ts');
const appImporter = resolve(root, 'src/modules/CrdtDocument/repositories/automergeRepository.ts');

/** An app-side module whose only import is the bare package, built with the real config. */
function probeEntryPlugin(): Plugin {
    const resolvedId = `\0${PROBE_ENTRY}`;
    return {
        name: 'automerge-streaming-probe-entry',
        resolveId: (id) => (id === PROBE_ENTRY ? resolvedId : null),
        load: (id) => (id === resolvedId ? "export { from, save } from '@automerge/automerge';" : null),
    };
}

function isRolldownOutput(value: unknown): value is Rolldown.RolldownOutput {
    return typeof value === 'object' && value !== null && 'output' in value && Array.isArray(value.output);
}

async function buildProbe(): Promise<Rolldown.RolldownOutput['output']> {
    const result = await build({
        root,
        mode: 'production',
        logLevel: 'silent',
        plugins: [probeEntryPlugin()],
        build: { write: false, sourcemap: false, rolldownOptions: { input: PROBE_ENTRY } },
    });
    if (!isRolldownOutput(result)) {
        throw new TypeError('A single-input, non-watch build must return one Rolldown output');
    }
    return result.output;
}

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
    it('builds the app import against the emitted wasm instead of the inlined base64', async () => {
        const output = await buildProbe();
        const chunkCode = output.flatMap((file) => (file.type === 'chunk' ? [file.code] : [])).join('\n');

        expect(
            output.some((file) => file.type === 'asset' && /^assets\/automerge-[\w-]+\.wasm$/.test(file.fileName))
        ).toBe(true);
        expect(chunkCode).toContain('initializeWasm(');
        expect(chunkCode).not.toContain(wasmBase64Excerpt);
    });

    it('keeps the dev server on the base64 entry, which module workers share with the page', async () => {
        expect(await resolveThroughDevServer(appImporter)).not.toBe(streamingEntry);
    });

    it.each(['development', 'e2e', 'test'])('registers no redirect for a %s-mode server', async (mode) => {
        const config = await resolveConfig({ root, mode }, 'serve');

        expect(config.plugins.some((plugin) => plugin.name === PLUGIN_NAME)).toBe(false);
    });

    it('aliases exactly the bare package specifier to the base64 entry', async () => {
        const config = await resolveConfig({ root, mode: 'production' }, 'build');

        expect(aliasesMatching(config, '@automerge/automerge').map((alias) => alias.replacement)).toEqual([
            base64Entry,
        ]);
        expect(aliasesMatching(config, '@automerge/automerge/slim')).toEqual([]);
        expect(aliasesMatching(config, '@automerge/automerge/automerge.wasm?url')).toEqual([]);
    });

    it('keeps IIFE build workers on the base64 entry', async () => {
        const config = await resolveConfig({ root, mode: 'production' }, 'build');
        const workerConfig = await config.worker.plugins([]);

        expect(config.worker.format).toBe('iife');
        expect(workerConfig.plugins.some((plugin) => plugin.name === PLUGIN_NAME)).toBe(false);
    });
});
