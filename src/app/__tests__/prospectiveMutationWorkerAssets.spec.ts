// @vitest-environment node
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { change, clone, free, from, getChanges, getHeads, load, save } from '@automerge/automerge';
import { build, loadConfigFromFile } from 'vite';
import { describe, expect, it, vi } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CLIENT = path.join(ROOT, 'src/modules/CrdtDocument/repositories/prospectiveMutationWorkerClient.ts');
const ENTRY = 'sourdaw:prospective-worker-assets';
const RESOLVED_ENTRY = `\0${ENTRY}`;
const WASM_SHA256 = '2a613b3ba557689889eadd66a54732223859be0f9a45b933d1512d8f2686367a';

describe('shipping prospective Worker public WASM assets', () => {
    it('keeps root initialization and emits a self-relative raw binary used by the actual IIFE Worker', async () => {
        const loaded = await loadConfigFromFile(
            { command: 'build', mode: 'production' },
            path.join(ROOT, 'vite.config.ts'),
            ROOT
        );
        if (!loaded) throw new Error('Shipping Vite config missing');
        const config = loaded.config;
        expect(config.base).toBe('./');
        expect(config.worker?.format).toBe('iife');
        const shippingBuild = config.build ?? {};
        const shippingRolldown = shippingBuild.rolldownOptions ?? {};
        const shippingOutput = shippingRolldown.output ?? {};
        if (Array.isArray(shippingOutput)) throw new Error('Expected one shipping output configuration');
        const resolved = new Map<string, string>();
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
                ...(config.plugins ?? []),
                {
                    name: 'sourdaw-prospective-worker-leaf',
                    async buildStart() {
                        for (const id of [
                            '@automerge/automerge',
                            '@automerge/automerge/slim',
                            '@automerge/automerge/automerge.wasm?url',
                        ]) {
                            const target = await this.resolve(id, CLIENT);
                            if (!target) throw new Error(`Unresolved public entry: ${id}`);
                            resolved.set(id, target.id);
                        }
                    },
                    resolveId: (id) => (id === ENTRY ? RESOLVED_ENTRY : null),
                    load: (id) =>
                        id === RESOLVED_ENTRY
                            ? `export { requestProspectiveMutation } from ${JSON.stringify(CLIENT)};\n`
                            : null,
                },
            ],
            build: {
                ...shippingBuild,
                write: false,
                // The selected leaf imports no public file; avoid copying the unrelated sample library.
                copyPublicDir: false,
                rolldownOptions: {
                    ...shippingRolldown,
                    input: ENTRY,
                    preserveEntrySignatures: 'strict',
                    output: shippingOutput,
                },
            },
        });
        const rootEntry = fileURLToPath(new URL('./fullfat_base64.js', import.meta.resolve('@automerge/automerge')));
        const slimEntry = fileURLToPath(import.meta.resolve('@automerge/automerge/slim'));
        const binaryEntry = fileURLToPath(import.meta.resolve('@automerge/automerge/automerge.wasm'));
        expect(realpathSync(resolved.get('@automerge/automerge')!)).toBe(realpathSync(rootEntry));
        expect(realpathSync(resolved.get('@automerge/automerge/slim')!)).toBe(realpathSync(slimEntry));
        expect(realpathSync(resolved.get('@automerge/automerge/automerge.wasm?url')!.split('?')[0]!)).toBe(
            realpathSync(binaryEntry)
        );
        const bundles = Array.isArray(result) ? result : [result];
        const outputs = bundles.flatMap((bundle) => ('output' in bundle ? bundle.output : []));
        const assets = outputs.filter((item) => item.type === 'asset');
        const binary = assets.find((asset) => asset.fileName.endsWith('.wasm'));
        const worker = assets.find((asset) => /(?:^|\/)prospectiveMutationWorker-[^/]+\.js$/.test(asset.fileName));
        if (!binary || !worker) throw new Error('Actual worker or raw WASM asset was not emitted');
        const bytes =
            typeof binary.source === 'string'
                ? new TextEncoder().encode(binary.source)
                : Uint8Array.from(binary.source);
        expect(bytes.byteLength).toBe(3_644_225);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(WASM_SHA256);
        expect(Buffer.from(bytes)).toEqual(readFileSync(binaryEntry));
        const code = typeof worker.source === 'string' ? worker.source : new TextDecoder().decode(worker.source);
        expect(code).not.toContain(Buffer.from(bytes).toString('base64').slice(0, 128));
        expect(code).not.toContain('import.meta');
        const reference = code.indexOf(path.posix.basename(binary.fileName));
        expect(reference).toBeGreaterThanOrEqual(0);
        console.info(
            'Actual Worker WASM reference:',
            code.slice(Math.max(0, reference - 60), reference + path.posix.basename(binary.fileName).length + 80)
        );

        type Reply =
            | { status: 'complete'; bytes: Uint8Array<ArrayBuffer>; heads: string[] }
            | { status: 'failed'; message: string };
        for (const origin of ['https://example.test/subdirectory/', 'app://sourdaw/']) {
            const postMessage = vi.fn<(reply: Reply, transfer?: ArrayBuffer[]) => void>();
            const scope: {
                location: { href: string };
                postMessage: typeof postMessage;
                onmessage?: (event: { data: unknown }) => Promise<void>;
            } = {
                location: { href: new URL(worker.fileName, origin).href },
                postMessage,
            };
            const fetchBinary = vi.fn(async (url: string) => {
                expect(url).toBe(new URL(binary.fileName, origin).href);
                return new Response(Uint8Array.from(bytes), { headers: { 'Content-Type': 'application/wasm' } });
            });
            const context = vm.createContext({
                self: scope,
                fetch: fetchBinary,
                crypto: webcrypto,
                WebAssembly,
                TextEncoder,
                TextDecoder,
                Uint8Array,
                ArrayBuffer,
                URL,
                Request,
                Response,
                console,
                performance,
            });
            vm.runInContext(code, context, { timeout: 1000 });
            expect(fetchBinary).not.toHaveBeenCalled();
            if (!scope.onmessage) throw new Error('Actual emitted Worker handler missing');
            const actor = 'aaaaaaaaaaaaaaaa';
            const original = from({ slot: { count: 0 } }, { actor });
            const encoding = clone(original, { actor });
            let seed: Uint8Array<ArrayBuffer>;
            try {
                seed = Uint8Array.from(save(encoding));
            } finally {
                free(encoding);
            }
            try {
                // Browser messaging rehomes JSON records into the Worker realm; VM calls do not.
                Reflect.set(context, 'suppliedSeed', seed);
                Reflect.set(
                    context,
                    'suppliedJson',
                    JSON.stringify({
                        heads: getHeads(original),
                        actor,
                        message: 'Detect',
                        time: 7,
                        mutation: {
                            kind: 'canonical-json-slot-v1',
                            key: 'slot',
                            baseValue: { count: 0 },
                            value: { count: 1 },
                            documentPresence: { slot: { count: 0 } },
                        },
                    })
                );
                const data: unknown = vm.runInContext('({ ...JSON.parse(suppliedJson), seed: suppliedSeed })', context);
                await scope.onmessage({ data });
                expect(fetchBinary).toHaveBeenCalledTimes(1);
                expect(postMessage).toHaveBeenCalledTimes(1);
                const reply = postMessage.mock.calls[0]![0];
                if (reply.status !== 'complete') throw new Error(reply.message);
                const actual = load<{ slot: { count: number } }>(reply.bytes, { actor });
                try {
                    expect(actual.slot.count).toBe(1);
                    expect(getHeads(actual)).toEqual(reply.heads);
                    const expected = change(clone(original, { actor }), { message: 'Detect', time: 7 }, (draft) => {
                        draft.slot.count = 1;
                    });
                    try {
                        expect(getChanges(original, actual)).toEqual(getChanges(original, expected));
                    } finally {
                        free(expected);
                    }
                    expect(postMessage.mock.calls[0]![1]).toEqual([reply.bytes.buffer]);
                } finally {
                    free(actual);
                }
            } finally {
                free(original);
            }
        }
    }, 30_000);
});
