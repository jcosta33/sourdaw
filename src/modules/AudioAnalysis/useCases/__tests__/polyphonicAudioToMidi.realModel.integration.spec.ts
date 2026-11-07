import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import { setBackend } from '@tensorflow/tfjs';
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
vi.mock('@spotify/basic-pitch/model/model.json?url', () => ({ default: '/assets/model-fingerprint.json' }));
vi.mock('@spotify/basic-pitch/model/group1-shard1of1.bin?url', () => ({
    default: '/assets/weights-fingerprint.bin',
}));

const packageRoot = dirname(createRequire(import.meta.url).resolve('@spotify/basic-pitch/package.json'));

afterEach(() => vi.unstubAllGlobals());

describe('bundled Basic Pitch real-model inference', () => {
    it('loads the emitted weights and transcribes simultaneous pitches without changing source PCM', async () => {
        await setBackend('cpu');
        const requests: string[] = [];
        let weightsUnavailable = true;
        vi.stubGlobal('fetch', async (input: string | URL | Request) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            requests.push(url);
            if (url === '/assets/model-fingerprint.json') {
                return new Response(readFileSync(resolve(packageRoot, 'model/model.json')), {
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            if (url === '/assets/weights-fingerprint.bin') {
                if (weightsUnavailable) {
                    throw new Error('Weight transport temporarily unavailable');
                }
                return new Response(readFileSync(resolve(packageRoot, 'model/group1-shard1of1.bin')));
            }
            return new Response('Unbundled model resource', { status: 404 });
        });

        const sampleRate = 22_050;
        const buffer = new MockAudioBuffer({ length: sampleRate, numberOfChannels: 1, sampleRate });
        const pcm = buffer.getChannelData(0);
        for (let frame = 0; frame < pcm.length; frame++) {
            const seconds = frame / sampleRate;
            const envelope = Math.min(1, seconds / 0.025, (1 - seconds) / 0.05);
            for (const frequency of [261.625565, 329.627557]) {
                for (let harmonic = 1; harmonic <= 5; harmonic++) {
                    pcm[frame] += (0.12 * envelope * Math.sin(2 * Math.PI * frequency * harmonic * seconds)) / harmonic;
                }
            }
        }
        const original = pcm.slice();
        source.buffer = buffer;

        // A rejected real load must not leave a permanently rejected singleton.
        expect(await polyphonicAudioToMidi({ clipId: 'dyad' })).toBeNull();
        expect(pcm).toEqual(original);
        weightsUnavailable = false;
        const result = await polyphonicAudioToMidi({ clipId: 'dyad' });

        expect(requests.filter((url) => url === '/assets/model-fingerprint.json')).toHaveLength(2);
        expect(requests).toContain('/assets/weights-fingerprint.bin');
        expect(requests).not.toContain('/assets/group1-shard1of1.bin');
        expect(result).not.toBeNull();
        for (const pitch of [60, 64]) {
            const note = result?.notes.find((candidate) => candidate.pitchMidi === pitch);
            expect(note, `Missing independently specified MIDI pitch ${pitch}`).toBeDefined();
            expect(note?.startTimeSeconds).toBeGreaterThanOrEqual(0);
            expect(note?.startTimeSeconds).toBeLessThan(0.3);
            expect(note?.durationSeconds).toBeGreaterThan(0.35);
            expect(note?.durationSeconds).toBeLessThan(1.3);
        }
        expect(result?.sourceClip).toMatchObject({ startBeat: 8, endBeat: 12, projectRevision: 'source-revision' });
        expect(pcm).toEqual(original);
    }, 30_000);
});
