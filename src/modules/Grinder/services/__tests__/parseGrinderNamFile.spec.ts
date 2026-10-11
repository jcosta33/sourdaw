import { describe, expect, it } from 'vitest';

import { parseGrinderNamFile } from '../parseGrinderNamFile';

/**
 * Fixtures are complete, valid WaveNet models: the parser validates the whole
 * file against the native runtime's contract, so the weight arrays are
 * derived from the same formula the validator applies (single layer array,
 * channels 2, kernel 3, dilations [1, 2], head_size 1, head_bias true →
 * 2 + 2 * (14 + 2 + 6) + 3 + 1 = 50 weights).
 */
function makeWavenetJson(name: string, mutate_weights?: (weights: number[]) => number[]): string {
    const weights = Array.from({ length: 50 }, (_, index) => Math.sin(index * 12.9898) * 0.5);
    return JSON.stringify({
        version: '0.5.4',
        architecture: 'WaveNet',
        config: {
            layers: [
                {
                    input_size: 1,
                    condition_size: 1,
                    head_size: 1,
                    channels: 2,
                    kernel_size: 3,
                    dilations: [1, 2],
                    activation: 'Tanh',
                    gated: false,
                    head_bias: true,
                },
            ],
            head: null,
            head_scale: 0.02,
        },
        weights: mutate_weights ? mutate_weights(weights) : weights,
        sample_rate: 48_000,
        metadata: {
            name,
            modeled_by: 'QA',
            tone_type: 'high-gain',
            sample_rate: 48_000,
        },
    });
}

describe('parseGrinderNamFile', () => {
    it('should derive an imported Grinder neural entry from a valid NAM file', () => {
        const nam_json = makeWavenetJson('Tight Rhythm');

        const imported_entry = parseGrinderNamFile({
            file_name: 'tight-rhythm.nam',
            file_text: nam_json,
        });

        expect(imported_entry.name).toBe('Tight Rhythm');
        expect(imported_entry.source).toBe('imported');
        expect(imported_entry.family).toMatch(/NAM/i);
        expect(imported_entry.profile.convWeights).toHaveLength(10);
        expect(imported_entry.profile.derivedFrom).toBe('nam');
        expect(imported_entry.profile.sourceSampleRate).toBe(48_000);
        expect(imported_entry.profile.model?.architecture).toBe('WaveNet');
        expect(imported_entry.profile.model?.version).toBe('0.5.4');
        expect(imported_entry.profile.model?.weights).toHaveLength(50);
        expect(imported_entry.profile.modelDigest).not.toBeNull();
        expect(imported_entry.sourceFileName).toBe('tight-rhythm.nam');
        expect(imported_entry.sourceFileText).toBe(nam_json);
    });

    it('should reject invalid NAM payloads', () => {
        expect(() =>
            parseGrinderNamFile({
                file_name: 'broken.nam',
                file_text: JSON.stringify({
                    version: '0.7.0',
                    architecture: 'WaveNet',
                    weights: [],
                }),
            })
        ).toThrow(/invalid nam/i);
    });

    // Fix 1 (#24): the `version` field is optional in legacy NAM files. A
    // valid file that omits it must still parse into an imported entry rather
    // than being rejected for "missing" data.
    it('should accept a valid NAM file that omits the optional version field', () => {
        const nam_json = makeWavenetJson('No Version Capture').replace('"version":"0.5.4",', '');

        const imported_entry = parseGrinderNamFile({
            file_name: 'no-version.nam',
            file_text: nam_json,
        });

        expect(imported_entry.name).toBe('No Version Capture');
        expect(imported_entry.source).toBe('imported');
        expect(imported_entry.profile.derivedFrom).toBe('nam');
        expect(imported_entry.profile.model?.version).toBeNull();
    });

    // Fix 1 (#24): architecture and non-empty weights remain mandatory even
    // though version is now optional.
    it('should still reject a NAM file missing architecture even without version', () => {
        expect(() =>
            parseGrinderNamFile({
                file_name: 'no-arch.nam',
                file_text: JSON.stringify({
                    weights: [0.1, -0.2, 0.3, 0.4],
                    metadata: { name: 'No Arch' },
                }),
            })
        ).toThrow(/invalid nam/i);
    });

    // Fix 2 (NEW-14): two distinct NAM files that share a display name must
    // produce distinct ids. The library upsert is keyed by id, so an id
    // collision lets the second import silently overwrite the first (data
    // loss). These two payloads are a hand-found collision pair under the old
    // 32-bit djb2 content hash — they share both name and old-hash suffix, so
    // under the old code both produced the identical id. Both carry an explicit
    // `version` field, so this case isolates the hash-width defect from the
    // optional-version relaxation in fix 1.
    it('should derive distinct ids for distinct NAM contents that collided under the old 32-bit hash', () => {
        function make(weight: number): string {
            const json = makeWavenetJson('Shared Name');
            const parsed = JSON.parse(json) as { weights: number[] };
            parsed.weights[0] = weight;
            return JSON.stringify(parsed);
        }

        const first = parseGrinderNamFile({ file_name: 'capture.nam', file_text: make(0.000_178_3) });
        const second = parseGrinderNamFile({ file_name: 'capture.nam', file_text: make(0.006_475_199_999_999_999_5) });

        expect(first.name).toBe(second.name);
        expect(first.sourceFileText).not.toBe(second.sourceFileText);
        expect(first.id).not.toBe(second.id);
    });

    // Fix 2 (NEW-14): the id must stay deterministic per content so that
    // re-importing the exact same file is idempotent rather than duplicating.
    it('should derive a stable id for identical NAM content', () => {
        const nam_json = makeWavenetJson('Stable Capture');

        const first = parseGrinderNamFile({ file_name: 'stable.nam', file_text: nam_json });
        const second = parseGrinderNamFile({ file_name: 'stable.nam', file_text: nam_json });

        expect(first.id).toBe(second.id);
    });
});
