import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseSampleManifest } from '../sampleManifest';

const VALID_ZONE = {
    file: 'sustain-c4.wav',
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
};

function createValidManifest() {
    return {
        version: 1,
        instrumentId: 'violin-1',
        sampleRate: 48_000,
        micPositions: ['close'],
        articulations: [{ type: 'sustain', id: 0, zones: [{ ...VALID_ZONE }] }],
    };
}

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

    it('rejects instrument ids outside the canonical Levain bank contract', () => {
        const manifest = createValidManifest();
        manifest.instrumentId = 'unknown-bank';

        expect(() => parseSampleManifest(manifest)).toThrow(
            'Levain sample manifest instrumentId must be a supported instrument id'
        );
    });

    it('rejects banks without a playable note path', () => {
        const manifest = createValidManifest();
        manifest.micPositions = [];
        expect(() => parseSampleManifest(manifest)).toThrow('must contain 1 through 8 microphone names');

        manifest.micPositions = ['close'];
        manifest.articulations = [];
        expect(() => parseSampleManifest(manifest)).toThrow('must contain at least one articulation');

        manifest.articulations = [{ type: 'sustain', id: 0, zones: [] }];
        expect(() => parseSampleManifest(manifest)).toThrow('articulations[0] must contain a playable note-on zone');
    });

    it('rejects sample paths that can escape the selected bank directory', () => {
        const manifest = createValidManifest();
        manifest.articulations[0]?.zones.push({ ...VALID_ZONE, file: '../outside.wav' });

        expect(() => parseSampleManifest(manifest)).toThrow('must be a safe relative sample path');
    });

    it('rejects articulation ids that do not match the canonical DSP id', () => {
        const manifest = createValidManifest();
        manifest.articulations[0] = { type: 'tremolo', id: 2, zones: [{ ...VALID_ZONE }] };

        expect(() => parseSampleManifest(manifest)).toThrow('articulations[0].id must be 13 for tremolo');
    });

    it('rejects round-robin dimensions beyond the DSP limit', () => {
        const manifest = createValidManifest();
        manifest.articulations[0]?.zones.push({ ...VALID_ZONE, rrLen: 13 });

        expect(() => parseSampleManifest(manifest)).toThrow(
            'articulations[0].zones[1].rrLen must be an integer from 1 through 12 greater than rrPos'
        );
    });

    it('rejects microphone dimensions beyond the DSP limit', () => {
        const manifest = createValidManifest();
        manifest.micPositions = Array.from({ length: 9 }, (_, index) => `mic-${index}`);

        expect(() => parseSampleManifest(manifest)).toThrow(
            'Levain sample manifest micPositions must contain 1 through 8 microphone names'
        );
    });

    it('rejects loop positions that cannot cross the u32 WASM boundary', () => {
        const manifest = createValidManifest();
        manifest.articulations[0]?.zones.push({ ...VALID_ZONE, loopStart: 4_294_967_296 });

        expect(() => parseSampleManifest(manifest)).toThrow(
            'articulations[0].zones[1].loopStart must be an integer from 0 through 4294967295'
        );
    });

    it('rejects a reversed explicit loop before it reaches unsigned Rust arithmetic', () => {
        const manifest = createValidManifest();
        manifest.articulations[0]?.zones.push({ ...VALID_ZONE, loopMode: 'forward', loopStart: 20, loopEnd: 10 });

        expect(() => parseSampleManifest(manifest)).toThrow(
            'articulations[0].zones[1].loopEnd must be greater than loopStart for an explicit loop'
        );
    });

    it('marks the bundled zero loop sentinel for resolution against decoded sample length', () => {
        const manifest = createValidManifest();
        manifest.articulations[0]!.zones[0] = { ...VALID_ZONE, loopMode: 'forward' };

        const parsed = parseSampleManifest(manifest);

        expect(parsed.articulations[0]?.zones[0]?.loop).toEqual({
            mode: 'forward',
            startFrame: 0,
            endFrame: 'sample-end',
            crossfadeFrames: 0,
        });
    });

    it('rejects finite JavaScript numbers that overflow a Rust f32', () => {
        const manifest = createValidManifest();
        manifest.articulations[0]?.zones.push({ ...VALID_ZONE, gainDb: Number.MAX_VALUE });

        expect(() => parseSampleManifest(manifest)).toThrow('must fit a finite 32-bit float');
    });

    it('rejects zone maps whose flattened lookup arena exceeds the DSP limit', () => {
        const manifest = createValidManifest();
        manifest.articulations[0] = {
            type: 'sustain',
            id: 0,
            zones: Array.from({ length: 33 }, () => ({ ...VALID_ZONE })),
        };

        expect(() => parseSampleManifest(manifest)).toThrow(
            'Levain sample manifest zones exceed the 65536-entry DSP lookup arena'
        );
    });

    it('rejects oversized collections before parsing their entries', () => {
        const manifest = createValidManifest();
        manifest.articulations = Array.from({ length: 29 }, () => manifest.articulations[0]!);

        expect(() => parseSampleManifest(manifest)).toThrow('must contain at most 28 entries');

        const oversizedZones: unknown[] = Array.from({ length: 65_536 });
        expect(() =>
            parseSampleManifest({
                ...manifest,
                articulations: [{ ...manifest.articulations[0]!, zones: oversizedZones }],
            })
        ).toThrow('articulations[0].zones must contain at most 65535 entries');
    });
});
