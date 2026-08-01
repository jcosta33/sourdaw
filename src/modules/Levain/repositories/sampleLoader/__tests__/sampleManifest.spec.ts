import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseSampleManifest } from '../sampleManifest';

describe('parseSampleManifest', () => {
    it('accepts every bundled Levain bank manifest', async () => {
        const root = path.join(process.cwd(), 'public/samples/levain');
        const entries = await readdir(root, { withFileTypes: true });
        const instrumentDirectories = entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort();

        const parsedIds: string[] = [];
        for (const instrumentId of instrumentDirectories) {
            const raw = await readFile(path.join(root, instrumentId, 'manifest.json'), 'utf8');
            const manifest = parseSampleManifest(JSON.parse(raw));
            expect(manifest.instrumentId.length).toBeGreaterThan(0);
            expect(manifest.articulations.some((articulation) => articulation.zones.length > 0)).toBe(true);
            parsedIds.push(manifest.instrumentId);
        }

        expect(parsedIds).toHaveLength(instrumentDirectories.length);
    });

    it('rejects malformed I/O before loading any sample data', () => {
        expect(() =>
            parseSampleManifest({
                version: '1',
                instrumentId: 'violin-1',
                sampleRate: 48_000,
                micPositions: ['close'],
                articulations: [],
            })
        ).toThrow('Levain sample manifest version must be a positive integer');
    });

    it('rejects sample paths that can escape the selected bank directory', () => {
        expect(() =>
            parseSampleManifest({
                version: 1,
                instrumentId: 'violin-1',
                sampleRate: 48_000,
                micPositions: ['close'],
                articulations: [
                    {
                        type: 'sustain',
                        id: 0,
                        zones: [
                            {
                                file: '../outside.wav',
                                rootNote: 60,
                                loKey: 0,
                                hiKey: 127,
                                loVel: 0,
                                hiVel: 127,
                                rrPos: 0,
                                rrLen: 1,
                                micId: 0,
                                isRelease: false,
                                loopMode: 'none',
                                loopStart: 0,
                                loopEnd: 0,
                                loopCrossfade: 0,
                                gainDb: 0,
                                attack: 0,
                                decay: 0,
                                sustain: 1,
                                release: 0,
                            },
                        ],
                    },
                ],
            })
        ).toThrow('articulations[0].zones[0].file must be a safe relative sample path');
    });
});
