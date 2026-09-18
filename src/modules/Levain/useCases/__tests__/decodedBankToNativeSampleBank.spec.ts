import { describe, expect, it } from 'vitest';

import { type DecodedBank, type DecodedSample } from '../../repositories/sampleLoader/createDecodedBankResource';
import { type ManifestLegatoTransition, type ManifestZone } from '../../repositories/sampleLoader/sampleManifest';
import { decodedBankToNativeSampleBank } from '../decodedBankToNativeSampleBank';

/**
 * Decoded material as the cache holds it: interleaved f32 in a
 * `SharedArrayBuffer`, which is exactly the backing the bridge cannot carry.
 */
function decodedSample(frames: readonly number[], channels: number, sampleRate = 48_000): DecodedSample {
    const data = new Float32Array(new SharedArrayBuffer(frames.length * 4));
    data.set(frames);
    return { data, frameCount: frames.length / channels, channels, sampleRate };
}

function zone(overrides: Partial<ManifestZone> = {}): ManifestZone {
    return {
        file: 'sustain-c4.wav',
        rootNote: 60,
        loKey: 59,
        hiKey: 61,
        loVel: 0,
        hiVel: 127,
        rrPos: 0,
        rrLen: 1,
        micId: 0,
        isRelease: false,
        loop: { mode: 'none' },
        gainDb: -1.5,
        attack: 0.01,
        decay: 0.2,
        sustain: 0.8,
        release: 0.3,
        ...overrides,
    };
}

function legato(overrides: Partial<ManifestLegatoTransition> = {}): ManifestLegatoTransition {
    return {
        file: 'legato-up2.wav',
        interval: 2,
        transitionType: 'slurred',
        dynamic: 'mf',
        crossfadeOutMs: 40,
        ...overrides,
    };
}

function bank(overrides: Partial<DecodedBank> = {}): DecodedBank {
    const files = ['sustain-c4.wav', 'legato-up2.wav'] as const;
    return {
        bankKey: 'violin-1@1',
        version: 1,
        instrumentId: 'violin-1',
        files,
        samples: new Map<string, DecodedSample>([
            ['sustain-c4.wav', decodedSample([0.25, -0.25, 0.5, -0.5], 2)],
            ['legato-up2.wav', decodedSample([0.125, 0.25], 1, 44_100)],
        ]),
        zones: [{ zone: zone(), articulationId: 3 }],
        legatoTransitions: [legato()],
        numArticulations: 4,
        numMics: 2,
        decodedByteLength: 24,
        ...overrides,
    };
}

describe('decodedBankToNativeSampleBank', () => {
    it('numbers samples by their position in the bank files and names zones by that id', () => {
        const translated = decodedBankToNativeSampleBank(bank());

        expect(translated.samples.map((sample) => sample.sampleId)).toEqual(['0', '1']);
        expect(translated.zones[0]?.sampleId).toBe('0');
        expect(translated.legatoTransitions[0]?.sampleId).toBe('1');
    });

    it('carries each file its own rate, channel count and frame count', () => {
        const translated = decodedBankToNativeSampleBank(bank());

        expect(translated.samples[0]).toMatchObject({ sampleRate: 48_000, channels: 2, frameCount: 2 });
        expect(translated.samples[1]).toMatchObject({ sampleRate: 44_100, channels: 1, frameCount: 2 });
    });

    it('copies the PCM into a buffer the bridge can carry, byte for byte', () => {
        const source = bank();
        const translated = decodedBankToNativeSampleBank(source);

        const pcm = translated.samples[0]?.pcm;
        const decoded = source.samples.get('sustain-c4.wav');
        expect(pcm?.buffer).toBeInstanceOf(ArrayBuffer);
        expect(pcm).toEqual(new Uint8Array(new Float32Array([0.25, -0.25, 0.5, -0.5]).buffer));
        // A copy, not a view: mutating the cache's material afterwards must not
        // change bytes already staged.
        decoded?.data.set([1, 1, 1, 1]);
        expect(translated.samples[0]?.pcm).toEqual(new Uint8Array(new Float32Array([0.25, -0.25, 0.5, -0.5]).buffer));
    });

    it('copies the PCM from the view’s own window rather than the head of its buffer', () => {
        const frames = [0.25, -0.25, 0.5, -0.5];
        const buffer = new SharedArrayBuffer(64);
        // A view that does not start at byte 0 is the decoder's ordinary case:
        // it packs material into one shared allocation, so a sample's bytes
        // begin where its own view begins. Sentinels stand where a copy
        // reading from the buffer's head would land instead.
        new Float32Array(buffer, 0, 4).set([9, 9, 9, 9]);
        const data = new Float32Array(buffer, 16, frames.length);
        data.set(frames);

        const translated = decodedBankToNativeSampleBank(
            bank({
                samples: new Map<string, DecodedSample>([
                    ['sustain-c4.wav', { data, frameCount: 2, channels: 2, sampleRate: 48_000 }],
                    ['legato-up2.wav', decodedSample([0.125, 0.25], 1, 44_100)],
                ]),
            })
        );

        expect(translated.samples[0]?.pcm).toEqual(new Uint8Array(new Float32Array(frames).buffer));
        expect(translated.samples[0]?.pcm).toHaveLength(frames.length * 4);
    });

    it('passes a non-looping zone through with a zeroed loop window', () => {
        const translated = decodedBankToNativeSampleBank(bank());

        expect(translated.zones[0]).toEqual({
            sampleId: '0',
            articulationId: 3,
            rootNote: 60,
            loKey: 59,
            hiKey: 61,
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
            gainDb: -1.5,
            attack: 0.01,
            decay: 0.2,
            sustain: 0.8,
            release: 0.3,
        });
    });

    it('resolves a sample-end loop against the frames the decoder actually read', () => {
        const translated = decodedBankToNativeSampleBank(
            bank({
                zones: [
                    {
                        zone: zone({
                            loop: { mode: 'forward', startFrame: 1, endFrame: 'sample-end', crossfadeFrames: 8 },
                        }),
                        articulationId: 0,
                    },
                ],
            })
        );

        // Only the decoder knows the length, and the engine takes frames — a
        // literal `sample-end` reaching the store would loop nothing.
        expect(translated.zones[0]).toMatchObject({
            loopMode: 'forward',
            loopStart: 1,
            loopEnd: 2,
            loopCrossfade: 8,
        });
    });

    it('carries the bank dimensions and instrument beside the material', () => {
        const translated = decodedBankToNativeSampleBank(bank());

        expect(translated).toMatchObject({ instrumentId: 'violin-1', numArticulations: 4, numMics: 2 });
    });

    it('refuses a file the decode did not produce, naming it', () => {
        const missing = bank({ samples: new Map<string, DecodedSample>() });

        expect(() => decodedBankToNativeSampleBank(missing)).toThrow(/sustain-c4\.wav/);
    });

    it('refuses a channel count the native bank store cannot take, naming the file', () => {
        const quad = bank({
            samples: new Map<string, DecodedSample>([
                ['sustain-c4.wav', decodedSample([0, 0, 0, 0], 4)],
                ['legato-up2.wav', decodedSample([0], 1)],
            ]),
        });

        // Refused here rather than across the bridge, where `add_sample`'s
        // refusal would no longer know which file it was.
        expect(() => decodedBankToNativeSampleBank(quad)).toThrow(/sustain-c4\.wav carries 4 channels/);
    });
});
