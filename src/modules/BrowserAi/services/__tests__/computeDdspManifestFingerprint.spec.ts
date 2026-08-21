import { describe, expect, it } from 'vitest';

import { resolveDdspInstrument } from '../../models/DdspInstrumentCatalog';
import { computeDdspManifestFingerprint } from '../computeDdspManifestFingerprint';

const admitted = resolveDdspInstrument('ddsp-violin');

function manifest() {
    return admitted.artifacts.map((artifact) => ({ ...artifact }));
}

describe('computeDdspManifestFingerprint', () => {
    it('is stable only for the same ordered manifest and algorithm identity', async () => {
        const input = {
            artifactVersion: admitted.artifactVersion,
            artifacts: manifest(),
            renderAlgorithmRevision: 'algorithm-v1',
        };

        await expect(computeDdspManifestFingerprint(input)).resolves.toBe(
            await computeDdspManifestFingerprint(structuredClone(input))
        );
    });

    it.each([
        ['artifact version', (input: ReturnType<typeof manifest>) => input, 'version-v2'],
        [
            'artifact order',
            (input: ReturnType<typeof manifest>) => [input[1]!, input[0]!, input[2]!],
            admitted.artifactVersion,
        ],
        [
            'artifact URL',
            (input: ReturnType<typeof manifest>) => {
                input[0]!.url += '?revision=2';
                return input;
            },
            admitted.artifactVersion,
        ],
        [
            'artifact size',
            (input: ReturnType<typeof manifest>) => {
                input[0]!.sizeBytes += 1;
                return input;
            },
            admitted.artifactVersion,
        ],
        [
            'artifact digest',
            (input: ReturnType<typeof manifest>) => {
                input[0]!.sha256 = 'f'.repeat(64);
                return input;
            },
            admitted.artifactVersion,
        ],
    ])('changes when the %s changes', async (_field, mutateArtifacts, artifactVersion) => {
        const baseline = await computeDdspManifestFingerprint({
            artifactVersion: admitted.artifactVersion,
            artifacts: manifest(),
            renderAlgorithmRevision: 'algorithm-v1',
        });

        const changed = await computeDdspManifestFingerprint({
            artifactVersion,
            artifacts: mutateArtifacts(manifest()),
            renderAlgorithmRevision: 'algorithm-v1',
        });

        expect(changed).not.toBe(baseline);
    });

    it('changes when the algorithm identity changes', async () => {
        const artifacts = manifest();
        const first = await computeDdspManifestFingerprint({
            artifactVersion: admitted.artifactVersion,
            artifacts,
            renderAlgorithmRevision: 'algorithm-v1',
        });
        const second = await computeDdspManifestFingerprint({
            artifactVersion: admitted.artifactVersion,
            artifacts,
            renderAlgorithmRevision: 'algorithm-v2',
        });

        expect(second).not.toBe(first);
    });
});
