// @vitest-environment node
import { createHash, webcrypto } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { change, clone, free, from, getChanges, getHeads, load, save } from '@automerge/automerge';
import { build, createLogger, createServer, loadConfigFromFile } from 'vite';
import { describe, expect, it, vi } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CLIENT = path.join(ROOT, 'src/modules/CrdtDocument/repositories/prospectiveMutationWorkerClient.ts');
const ENTRY = 'sourdaw:prospective-worker-assets';
const RESOLVED_ENTRY = `\0${ENTRY}`;
const WASM_SHA256 = '2a613b3ba557689889eadd66a54732223859be0f9a45b933d1512d8f2686367a';

describe('shipping prospective Worker public WASM assets', () => {
    it('prebundles public Slim before the first Worker request without reloading', async () => {
        const loaded = await loadConfigFromFile(
            { command: 'serve', mode: 'development' },
            path.join(ROOT, 'vite.config.ts'),
            ROOT
        );
        if (!loaded) throw new Error('Shipping Vite config missing');
        const cacheDir = mkdtempSync(path.join(tmpdir(), 'prospective-worker-optimizer-'));
        const logger = createLogger('info', { allowClearScreen: false });
        const info = vi.spyOn(logger, 'info');
        const config = loaded.config;
        let server: Awaited<ReturnType<typeof createServer>> | undefined;
        try {
            server = await createServer({
                ...config,
                root: ROOT,
                configFile: false,
                cacheDir,
                customLogger: logger,
                // Select the actual client leaf; retain all shipping optimizer options and plugins.
                optimizeDeps: { ...config.optimizeDeps, entries: [CLIENT] },
                server: { ...config.server, port: 0, strictPort: true },
            });
            await server.listen();
            await server.transformRequest('/src/modules/CrdtDocument/repositories/prospectiveMutationWorkerClient.ts');
            await server.waitForRequestsIdle();
            type Metadata = {
                browserHash: string;
                optimized: Record<string, { src: string; file: string; fileHash: string }>;
            };
            const metadataPath = path.join(cacheDir, 'deps/_metadata.json');
            const readMetadata = (): Metadata => JSON.parse(readFileSync(metadataPath, 'utf8')) as Metadata;
            await vi.waitFor(() => expect(readMetadata().browserHash).toBeTruthy(), { timeout: 15_000 });
            const initial = readMetadata();
            const slim = initial.optimized['@automerge/automerge/slim'];
            // This must fail on actual cold optimizer output when the startup include is removed.
            expect(slim, 'Public Slim must be optimized before any Worker entry request').toBeDefined();
            if (!slim) throw new Error('Initial optimizer output is missing public Slim');
            expect(realpathSync(path.resolve(path.dirname(metadataPath), slim.src))).toBe(
                realpathSync(fileURLToPath(import.meta.resolve('@automerge/automerge/slim')))
            );
            const binary = readFileSync(fileURLToPath(import.meta.resolve('@automerge/automerge/automerge.wasm')));
            const embeddedPrefix = binary.toString('base64').slice(0, 128);
            const pending = [path.resolve(path.dirname(metadataPath), slim.file)];
            const visited = new Set<string>();
            while (pending.length > 0) {
                const file = pending.pop();
                if (!file || visited.has(file)) continue;
                visited.add(file);
                const code = readFileSync(file, 'utf8');
                expect(code, `Optimized Slim closure embeds WASM: ${file}`).not.toContain(embeddedPrefix);
                for (const match of code.matchAll(/\b(?:from\s*|import\s*)(['"])([^'"]+)\1/g)) {
                    const imported = match[2];
                    if (imported?.startsWith('.')) pending.push(path.resolve(path.dirname(file), imported));
                }
            }
            expect(visited.size).toBeGreaterThan(1);
            const origin = server.resolvedUrls?.local[0];
            if (!origin) throw new Error('Cold dev server did not expose its temporary listener');
            const entry = await fetch(
                new URL(
                    '/src/modules/CrdtDocument/workers/prospectiveMutationWorker.ts?worker_file&type=module',
                    origin
                )
            );
            expect(entry.status).toBe(200);
            const entryCode = await entry.text();
            const slimImport = [...entryCode.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)]
                .map((match) => match[1])
                .find((url) => url && new URL(url, origin).pathname.endsWith(`/${path.basename(slim.file)}`));
            if (!slimImport) throw new Error('Actual Worker transform did not import the startup optimized Slim');
            const optimized = await fetch(new URL(slimImport, origin));
            expect(optimized.status).toBe(200);
            expect(await optimized.text()).toContain('initializeWasm');
            expect(readMetadata()).toEqual(initial);
            expect(readMetadata().browserHash).toBe(initial.browserHash);
            expect(info.mock.calls.map(([message]) => message).join('\n')).not.toContain(
                'optimized dependencies changed. reloading'
            );
            console.info('Cold public Slim startup metadata:', {
                browserHash: initial.browserHash,
                optimized: slim,
                reachableFiles: [...visited].map((file) => path.relative(cacheDir, file)),
            });
        } finally {
            try {
                await server?.close();
            } finally {
                info.mockRestore();
                rmSync(cacheDir, { recursive: true, force: true });
            }
        }
    }, 30_000);

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
