// @vitest-environment node
import { webcrypto } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import {
    change,
    clone,
    free,
    from,
    getBackend,
    getHeads,
    getMissingDeps,
    load,
    loadIncremental,
    save,
    saveSince,
} from '@automerge/automerge';
import { build, loadConfigFromFile } from 'vite';
import { expect, it, vi } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const CLIENT = path.join(ROOT, 'src/modules/CrdtDocument/repositories/automergeRepository.ts');
const ENTRY = 'sourdaw:incremental-worker-test';

it('executes the actual shipping IIFE Worker incremental handler with native seeds and exact delta replies', async () => {
    const loaded = await loadConfigFromFile(
        { command: 'build', mode: 'production' },
        path.join(ROOT, 'vite.config.ts'),
        ROOT
    );
    if (!loaded) {
        throw new Error('Shipping Vite configuration missing');
    }
    const config = loaded.config;
    const plugins = config.plugins ?? [];
    expect(config.worker?.format).toBe('iife');
    const result = await build({
        root: ROOT,
        configFile: false,
        logLevel: 'error',
        base: config.base,
        worker: config.worker,
        resolve: config.resolve,
        define: config.define,
        esbuild: config.esbuild,
        oxc: config.oxc,
        plugins: [
            ...plugins,
            {
                name: 'sourdaw-incremental-worker-test-leaf',
                resolveId: (id) => (id === ENTRY ? `\0${ENTRY}` : null),
                load: (id) =>
                    id === `\0${ENTRY}` ? `export { automergeRepository } from ${JSON.stringify(CLIENT)};\n` : null,
            },
        ],
        build: {
            ...config.build,
            write: false,
            copyPublicDir: false,
            rolldownOptions: { ...config.build?.rolldownOptions, input: ENTRY, preserveEntrySignatures: 'strict' },
        },
    });
    const bundles = Array.isArray(result) ? result : [result];
    const assets = bundles
        .flatMap((bundle) => ('output' in bundle ? bundle.output : []))
        .filter((entry) => entry.type === 'asset');
    const worker = assets.find((asset) => /(?:^|\/)crdtWorker-[^/]+\.js$/.test(asset.fileName));
    if (!worker) {
        throw new Error('Actual emitted CRDT Worker asset missing');
    }
    const code = typeof worker.source === 'string' ? worker.source : Buffer.from(worker.source).toString('utf8');
    const posted = vi.fn<(reply: unknown) => void>();
    const scope: { postMessage: typeof posted; onmessage?: (event: { data: unknown }) => void } = {
        postMessage: posted,
    };
    vm.runInNewContext(
        code,
        {
            self: scope,
            crypto: webcrypto,
            WebAssembly,
            TextEncoder,
            TextDecoder,
            Uint8Array,
            ArrayBuffer,
            atob,
            btoa,
            console,
            performance,
        },
        { timeout: 1000 }
    );
    if (!scope.onmessage) {
        throw new Error('Actual emitted Worker handler missing');
    }
    const documents = [];
    for (const [index, count] of [0, 10].entries()) {
        const base = from({ count }, { actor: index === 0 ? 'aaaaaaaaaaaaaaaa' : 'bbbbbbbbbbbbbbbb' });
        const changed = change(clone(base), (doc) => {
            doc.count++;
        });
        const encoding = clone(changed);
        try {
            documents.push({
                id: index === 0 ? 'root' : 'child',
                base,
                changed,
                seed: Uint8Array.from(getBackend(encoding).saveNoCompress()),
                frontier: getHeads(base),
                heads: getHeads(changed),
            });
        } finally {
            free(encoding);
        }
    }
    try {
        scope.onmessage({
            data: { id: 44, type: 'loadBundle', bundle: [['root', save(documents[0]!.base)]], retainShadow: true },
        });
        expect(posted.mock.calls[0]?.[0]).toMatchObject({ id: 44, type: 'loaded' });
        posted.mockClear();
        scope.onmessage({
            data: {
                id: 45,
                type: 'encodeIncrementals',
                documents: documents.map(({ id, seed, heads, frontier }) => ({ id, seed, heads, frontier })),
            },
        });
        expect(posted).toHaveBeenCalledOnce();
        const reply = posted.mock.calls[0]?.[0];
        expect(reply).toMatchObject({ id: 45, type: 'incrementalsEncoded' });
        if (
            typeof reply !== 'object' ||
            reply === null ||
            !('type' in reply) ||
            reply.type !== 'incrementalsEncoded' ||
            !('documents' in reply) ||
            !Array.isArray(reply.documents)
        ) {
            throw new Error('Actual Worker did not encode incremental replies');
        }
        const entries: unknown[] = reply.documents;
        expect(entries).toHaveLength(2);
        for (const entry of entries) {
            if (
                typeof entry !== 'object' ||
                entry === null ||
                !('id' in entry) ||
                !('heads' in entry) ||
                !('chunk' in entry) ||
                !(entry.chunk instanceof Uint8Array)
            ) {
                throw new TypeError('Actual Worker returned a malformed native delta');
            }
            const input = documents.find((doc) => doc.id === entry.id);
            if (!input) {
                throw new Error('Actual Worker returned an unrequested document');
            }
            expect(entry.heads).toEqual(input.heads);
            expect(entry.chunk).toEqual(saveSince(input.changed, input.frontier));
            expect(entry.chunk.byteOffset).toBe(0);
            expect(entry.chunk.byteLength).toBe(entry.chunk.buffer.byteLength);
            const replay = loadIncremental(load(save(input.base)), entry.chunk);
            const missing = loadIncremental(from({}), entry.chunk);
            try {
                expect(getHeads(replay)).toEqual(input.heads);
                expect(replay).toEqual(input.changed);
                expect(getMissingDeps(missing, []).length).toBeGreaterThan(0);
            } finally {
                free(replay);
                free(missing);
            }
        }
        posted.mockClear();
        scope.onmessage({
            data: {
                id: 46,
                type: 'compactShadow',
                seeds: [],
                deltas: [],
                removedDocIds: [],
                expectedHeads: [['root', getHeads(documents[0]!.base)]],
            },
        });
        const shadow = posted.mock.calls[0]?.[0];
        expect(shadow).toMatchObject({ id: 46, type: 'compacted' });
        if (typeof shadow !== 'object' || shadow === null || !('bundle' in shadow) || !Array.isArray(shadow.bundle)) {
            throw new Error('Stateless incremental encoding corrupted the real shadow');
        }
        const bundles: unknown[] = shadow.bundle;
        const root = bundles[0];
        if (!Array.isArray(root) || !(root[1] instanceof Uint8Array)) {
            throw new TypeError('Expected the unchanged native shadow bundle');
        }
        const unchanged = load(root[1]);
        try {
            expect(getHeads(unchanged)).toEqual(getHeads(documents[0]!.base));
        } finally {
            free(unchanged);
        }
    } finally {
        for (const doc of documents) {
            free(doc.base);
            free(doc.changed);
        }
    }
}, 30_000);
