import { describe, expect, it } from 'vitest';

import { parseGrinderNamFile } from '../parseGrinderNamFile';

describe('parseGrinderNamFile', () => {
    it('should derive an imported Grinder neural entry from a valid NAM file', () => {
        const nam_json = JSON.stringify({
            version: '0.7.0',
            architecture: 'WaveNet',
            config: { sample_rate: 48_000, receptive_field: 256 },
            weights: [0.14, -0.21, 0.32, 0.08, -0.11, 0.27, 0.19, -0.07, 0.25, 0.04, -0.03, 0.09],
            metadata: {
                name: 'Tight Rhythm',
                modeled_by: 'QA',
                tone_type: 'high-gain',
                sample_rate: 48_000,
            },
        });

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
});
