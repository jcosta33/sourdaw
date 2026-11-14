import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { MockAudioBuffer } from '#/helpers/__tests__/audioContext.mock';

import { polyphonicAudioToMidi } from '../polyphonicAudioToMidi';

const source = vi.hoisted(() => ({ buffer: null as AudioBuffer | null }));
vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: () => [{ clips: [{ id: 'dyad', name: 'Dyad', audioBufferId: 'pcm', startBeat: 8, endBeat: 12 }] }],
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({ getCachedAudioBuffer: () => source.buffer }));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    settlePendingProjectWritesAndCaptureRevision: () => 'source-revision',
    projectRevisionMatchesLiveIgnoringSaveWrites: (revision: string) => revision === 'source-revision',
}));
vi.mock('virtual:sourdaw-basic-pitch-model', () => ({ modelUrl: '/assets/basic-pitch/model.json' }));

const packageRoot = dirname(createRequire(import.meta.url).resolve('@spotify/basic-pitch/package.json'));

afterEach(() => vi.unstubAllGlobals());

describe('bundled Basic Pitch real-model inference', () => {
    it('loads one complete TensorFlow.js cohort shared with the application', () => {
        const basicPitchRequire = createRequire(resolve(packageRoot, 'package.json'));
        const tensorflowRequire = createRequire(basicPitchRequire.resolve('@tensorflow/tfjs/package.json'));
        const runtime: unknown = basicPitchRequire('@tensorflow/tfjs');
        if (typeof runtime !== 'object' || runtime === null || !('version' in runtime)) {
            throw new TypeError('Basic Pitch must load the TensorFlow.js runtime');
        }
        expect(runtime.version).toEqual({
            'tfjs-core': '4.22.0',
            'tfjs-backend-cpu': '4.22.0',
            'tfjs-backend-webgl': '4.22.0',
            'tfjs-data': '4.22.0',
            'tfjs-layers': '4.22.0',
            'tfjs-converter': '4.22.0',
            tfjs: '4.22.0',
        });
        expect(tensorflowRequire.resolve('@tensorflow/tfjs-core/package.json')).toBe(
            createRequire(import.meta.url).resolve('@tensorflow/tfjs-core/package.json')
        );
    });

    it('loads emitted weights and retains simultaneous pitches across the full four-second source', async () => {
        const requests: string[] = [];
        let modelUnavailable = true;
        let weightsUnavailable = true;
        vi.stubGlobal('fetch', async (input: string | URL | Request) => {
            let url: string;
            if (typeof input === 'string') {
                url = input;
            } else if (input instanceof URL) {
                url = input.href;
            } else {
                url = input.url;
            }
            requests.push(url);
            if (url === '/assets/basic-pitch/model.json') {
                if (modelUnavailable) {
                    throw new Error('Model transport temporarily unavailable');
                }
                return new Response(readFileSync(resolve(packageRoot, 'model/model.json')), {
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            if (url === '/assets/basic-pitch/group1-shard1of1.bin') {
                if (weightsUnavailable) {
                    throw new Error('Weight transport temporarily unavailable');
                }
                return new Response(readFileSync(resolve(packageRoot, 'model/group1-shard1of1.bin')));
            }
            return new Response('Unbundled model resource', { status: 404 });
        });

        const sampleRate = 22_050;
        const durationSeconds = 4;
        const buffer = new MockAudioBuffer({ length: sampleRate * durationSeconds, numberOfChannels: 1, sampleRate });
        const pcm = buffer.getChannelData(0);
        for (let frame = 0; frame < pcm.length; frame++) {
            const seconds = frame / sampleRate;
            const envelope = Math.min(1, seconds / 0.025, (durationSeconds - seconds) / 0.05);
            for (const frequency of [261.625565, 329.627557]) {
                for (let harmonic = 1; harmonic <= 5; harmonic++) {
                    pcm[frame] =
                        pcm[frame]! +
                        (0.12 * envelope * Math.sin(2 * Math.PI * frequency * harmonic * seconds)) / harmonic;
                }
            }
        }
        const original = pcm.slice();
        source.buffer = buffer;

        // A rejected real load must not leave a permanently rejected singleton.
        expect(await polyphonicAudioToMidi({ clipId: 'dyad' })).toBeNull();
        expect(pcm).toEqual(original);
        modelUnavailable = false;
        expect(await polyphonicAudioToMidi({ clipId: 'dyad' })).toBeNull();
        weightsUnavailable = false;
        const result = await polyphonicAudioToMidi({ clipId: 'dyad' });

        expect(requests.filter((url) => url === '/assets/basic-pitch/model.json')).toHaveLength(3);
        expect(requests).toContain('/assets/basic-pitch/group1-shard1of1.bin');
        expect(result).not.toBeNull();
        for (const pitch of [60, 64]) {
            const notes = result?.notes.filter((candidate) => candidate.pitchMidi === pitch) ?? [];
            expect(notes.length, `Missing independently specified MIDI pitch ${pitch}`).toBeGreaterThan(0);
            const spans = notes
                .map((note) => ({ start: note.startTimeSeconds, end: note.startTimeSeconds + note.durationSeconds }))
                .sort((left, right) => left.start - right.start);
            expect(spans[0]?.start).toBeGreaterThanOrEqual(0);
            expect(spans[0]?.start).toBeLessThan(0.3);
            expect(Math.max(...spans.map((span) => span.end))).toBeGreaterThan(3.5);
            expect(Math.max(...spans.map((span) => span.end))).toBeLessThan(4.35);
            // The network may retrigger a held tone. Measure the union of its
            // intervals, so duplicate notes cannot counterfeit retained audio.
            let coveredSeconds = 0;
            let coveredThrough = 0.15;
            for (const span of spans) {
                const start = Math.max(0.15, span.start, coveredThrough);
                const end = Math.min(3.85, span.end);
                coveredSeconds += Math.max(0, end - start);
                coveredThrough = Math.max(coveredThrough, end);
            }
            expect(coveredSeconds, `Incomplete four-second coverage for MIDI pitch ${pitch}`).toBeGreaterThan(3);
        }
        expect(result?.sourceClip).toMatchObject({ startBeat: 8, endBeat: 12, projectRevision: 'source-revision' });
        expect(pcm).toEqual(original);
    }, 30_000);
});
