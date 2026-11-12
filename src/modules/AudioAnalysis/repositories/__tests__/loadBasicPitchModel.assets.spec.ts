import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import { build } from 'vite';
import { describe, expect, it } from 'vitest';

import { basicPitchAssets } from '../../../../../scripts/basicPitchAssets';

describe('Basic Pitch production asset edges', () => {
    it('emits the actual model and shard referenced by the production repository', async () => {
        // Exercise Vite's production URL pipeline without the unrelated app
        // graph, output writes, network, or configuration plugins.
        const built = await build({
            configFile: false,
            logLevel: 'error',
            base: './',
            plugins: [basicPitchAssets()],
            build: {
                write: false,
                minify: false,
                rollupOptions: {
                    input: resolve(import.meta.dirname, '../loadBasicPitchModel.ts'),
                    external: (id) => id === '@spotify/basic-pitch',
                    preserveEntrySignatures: 'strict',
                },
            },
        });
        const bundles = Array.isArray(built) ? built : [built];
        const output = bundles.flatMap((bundle) => {
            if (!('output' in bundle)) {
                throw new Error('Expected a completed non-watching production bundle');
            }
            return bundle.output;
        });
        const packageRoot = dirname(createRequire(import.meta.url).resolve('@spotify/basic-pitch/package.json'));
        const model = output.find((entry) => entry.type === 'asset' && entry.fileName.endsWith('.json'));
        const weights = output.find((entry) => entry.type === 'asset' && entry.fileName.endsWith('.bin'));
        if (model?.type !== 'asset' || weights?.type !== 'asset') {
            throw new Error('The actual repository did not emit both model topology and weights');
        }
        expect(Buffer.from(model.source)).toEqual(readFileSync(resolve(packageRoot, 'model/model.json')));
        expect(Buffer.from(weights.source)).toEqual(readFileSync(resolve(packageRoot, 'model/group1-shard1of1.bin')));
        const chunk = output.find((entry) => entry.type === 'chunk');
        if (chunk?.type !== 'chunk') {
            throw new Error('The loader did not emit a chunk');
        }
        const match = chunk.code.match(/new URL\("([^"]+)", import\.meta\.url\)/);
        expect(match).not.toBeNull();
        if (!match?.[1]) {
            throw new Error('The model URL is not relative to its emitted chunk');
        }
        const chunkUrl = new URL(chunk.fileName, 'https://example.test/nested/');
        const modelUrl = new URL(match[1], chunkUrl);
        expect(modelUrl.href).toBe(new URL(model.fileName, 'https://example.test/nested/').href);
        const paths: unknown = JSON.parse(Buffer.from(model.source).toString()).weightsManifest[0].paths;
        expect(paths).toEqual(['group1-shard1of1.bin']);
        expect(new URL('group1-shard1of1.bin', modelUrl).href).toBe(
            new URL(weights.fileName, 'https://example.test/nested/').href
        );
    });
});
