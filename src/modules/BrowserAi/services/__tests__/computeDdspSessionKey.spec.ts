import { describe, expect, it } from 'vitest';

import { resolveDdspInstrument } from '../../models/DdspInstrumentCatalog';
import {
    computeDdspManifestFingerprint,
    computeDdspSessionKey,
    DDSP_TFJS_RUNTIME_REVISION,
} from '../computeDdspSessionKey';

const violin = resolveDdspInstrument('ddsp-violin');

function manifest() {
    return violin.artifacts.map((artifact) => ({ ...artifact }));
}

describe('computeDdspSessionKey', () => {
    it('is stable for one complete ordered manifest and runtime revision', async () => {
        const first = await computeDdspSessionKey({
            instrumentId: violin.id,
            artifactVersion: violin.artifactVersion,
            artifacts: manifest(),
        });
        const second = await computeDdspSessionKey({
            instrumentId: violin.id,
            artifactVersion: violin.artifactVersion,
            artifacts: manifest(),
        });

        expect(first).toBe(second);
        expect(first).toMatch(/^ddsp-violin:magenta-js-ddsp-2020-01-05:[0-9a-f]{64}$/u);
    });

    it.each([
        ['runtime revision', async () => computeDdspManifestFingerprint(violin, 'runtime-v2')],
        [
            'artifact version',
            async () =>
                computeDdspManifestFingerprint(
                    { ...violin, artifactVersion: `${violin.artifactVersion}-changed`, artifacts: manifest() },
                    DDSP_TFJS_RUNTIME_REVISION
                ),
        ],
        [
            'artifact order',
            async () =>
                computeDdspManifestFingerprint(
                    { ...violin, artifacts: [manifest()[1]!, manifest()[0]!, manifest()[2]!] },
                    DDSP_TFJS_RUNTIME_REVISION
                ),
        ],
        [
            'artifact path',
            async () => {
                const artifacts = manifest();
                artifacts[0] = { ...artifacts[0]!, path: 'settings.json' };
                return computeDdspManifestFingerprint({ ...violin, artifacts }, DDSP_TFJS_RUNTIME_REVISION);
            },
        ],
        [
            'artifact URL',
            async () => {
                const artifacts = manifest();
                artifacts[0] = { ...artifacts[0]!, url: `${artifacts[0]!.url}?changed=1` };
                return computeDdspManifestFingerprint({ ...violin, artifacts }, DDSP_TFJS_RUNTIME_REVISION);
            },
        ],
        [
            'artifact size',
            async () => {
                const artifacts = manifest();
                artifacts[0] = { ...artifacts[0]!, sizeBytes: artifacts[0]!.sizeBytes + 1 };
                return computeDdspManifestFingerprint({ ...violin, artifacts }, DDSP_TFJS_RUNTIME_REVISION);
            },
        ],
        [
            'artifact digest',
            async () => {
                const artifacts = manifest();
                artifacts[0] = { ...artifacts[0]!, sha256: 'f'.repeat(64) };
                return computeDdspManifestFingerprint({ ...violin, artifacts }, DDSP_TFJS_RUNTIME_REVISION);
            },
        ],
    ])('changes when the %s changes', async (_label, changedFingerprint) => {
        const baseline = await computeDdspManifestFingerprint(violin, DDSP_TFJS_RUNTIME_REVISION);

        await expect(changedFingerprint()).resolves.not.toBe(baseline);
    });
});
