// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { beforeAll, describe, expect, it } from 'vitest';

import { WEBLLM_MODELS } from '../../../models/ModelInfo';
import { getWebLlmArtifactManifestModel } from '../webLlmArtifactManifest';

type RuntimeInstance = {
    listGlobalFuncNames: () => string[];
    beginScope: () => void;
    getGlobalFunc: (name: string) => unknown;
    endScope: () => void;
    dispose: () => void;
};
type Runtime = {
    instantiate: (bytes: ArrayBuffer, wasi: object) => Promise<RuntimeInstance>;
    createPolyfillWASI: () => object;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPackage(path: string): Record<string, unknown> {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isRecord(value)) {
        throw new TypeError(`Invalid package metadata: ${path}`);
    }
    return value;
}

function isRuntime(value: unknown): value is Runtime {
    return (
        typeof value === 'object' &&
        value !== null &&
        'instantiate' in value &&
        typeof value.instantiate === 'function' &&
        'createPolyfillWASI' in value &&
        typeof value.createPolyfillWASI === 'function'
    );
}

const fixtureDirectory = join(import.meta.dirname, 'fixtures/model-libraries');
const require = createRequire(import.meta.url);
const sdkPath = require.resolve('@mlc-ai/web-llm');
const sdkRequire = createRequire(sdkPath);
const runtimePath = sdkRequire.resolve('@mlc-ai/web-runtime');
const runtime: unknown = sdkRequire('@mlc-ai/web-runtime');
const requiredGlobal = 'runtime.TensorAllocWithScope';
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('the admitted WebLLM libraries and SDK runtime ABI', () => {
    beforeAll(() => {
        const sdkPackage = readPackage(join(dirname(sdkPath), '../package.json'));
        const runtimePackage = readPackage(join(dirname(runtimePath), '../package.json'));
        const dependencies = sdkPackage.dependencies;
        if (
            !isRecord(dependencies) ||
            typeof dependencies['@mlc-ai/web-runtime'] !== 'string' ||
            typeof runtimePackage.name !== 'string' ||
            typeof runtimePackage.version !== 'string'
        ) {
            throw new TypeError('The SDK runtime dependency identity is missing or invalid');
        }
        expect(runtimePackage.name).toBe('@mlc-ai/web-runtime');
        expect(runtimePackage.version).toBe(dependencies['@mlc-ai/web-runtime']);
        // These executable identities bind the audited equivalent SDK/runtime constructor, not a second direct pin.
        expect(sha256(readFileSync(sdkPath))).toBe('5460309cbb350e97fe63c817d73718588976049e7125ef66b657818a0e31818a');
        expect(sha256(readFileSync(runtimePath))).toBe(
            '7919d6c599b9b86da020cdd20738bbe4a2e06d5643f79f3907d07a80ca279e62'
        );
        if (!isRuntime(runtime)) {
            throw new TypeError('The SDK dependency does not expose the audited public runtime API');
        }
    });

    it.each(WEBLLM_MODELS)(
        'constructs $id and resolves the required allocation global before weights or GPU',
        async ({ id }) => {
            if (!isRuntime(runtime)) {
                throw new TypeError('The SDK dependency does not expose the audited public runtime API');
            }
            const model = getWebLlmArtifactManifestModel(id);
            const artifact = model.artifacts.find(({ kind }) => kind === 'model-library');
            if (!artifact) {
                throw new Error(`No admitted model library for ${id}`);
            }
            const bytes = gunzipSync(readFileSync(join(fixtureDirectory, `${basename(artifact.path)}.gz`)));
            expect(bytes.byteLength).toBe(artifact.sizeBytes);
            expect(sha256(bytes)).toBe(artifact.sha256);
            const buffer = new ArrayBuffer(bytes.byteLength);
            new Uint8Array(buffer).set(bytes);
            const instance = await runtime.instantiate(buffer, runtime.createPolyfillWASI());
            let scopeOpen = false;
            try {
                expect(instance.listGlobalFuncNames()).toContain(requiredGlobal);
                instance.beginScope();
                scopeOpen = true;
                expect(typeof instance.getGlobalFunc(requiredGlobal)).toBe('function');
            } finally {
                if (scopeOpen) {
                    instance.endScope();
                }
                instance.dispose();
            }
        }
    );
});
