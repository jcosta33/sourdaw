// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixtures = resolve(repository, 'scripts/__tests__/fixtures/audioDependencyPorts');

describe('installed audio and inference dependency ports', () => {
    it.each([
        [
            'package inventories and physical parent edges',
            'scripts/dependencyPorts/verifyInstalled.mjs',
            '"physicalEdges":21',
        ],
        [
            'TensorFlow formats, Long hashes, native fetch and Unicode CLI',
            `${fixtures}/tensorflow.cjs`,
            'TensorFlow contracts passed',
        ],
        [
            'independent FFT, PCM, stream lifecycle, Meyda CLI and QR failure propagation',
            `${fixtures}/audio.mjs`,
            '"passed": 15',
        ],
        [
            'actual DOM and Worker contracts and malformed type rejection',
            `${fixtures}/types.mjs`,
            'DOM and Worker dependency type contracts passed',
        ],
        [
            'ONNX generated wire, deliberate malformed rejection and nine real exports',
            `${fixtures}/onnx.mjs`,
            'ONNX contracts passed',
        ],
    ])(
        '%s',
        (_name, script, observable) => {
            const result = spawnSync(process.execPath, [resolve(repository, script), repository], {
                cwd: repository,
                encoding: 'utf8',
                timeout: 30_000,
                maxBuffer: 4 * 1024 * 1024,
            });
            expect(result.error).toBeUndefined();
            expect(result.status, result.stdout + result.stderr).toBe(0);
            expect(result.stdout).toContain(observable);
        },
        35_000
    );
});
