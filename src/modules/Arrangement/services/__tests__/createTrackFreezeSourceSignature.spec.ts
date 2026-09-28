import { describe, it, expect } from 'vitest';

import { ClipDummy } from '../../__tests__/ClipDummy';
import { type Clip } from '../../models/Track';
import { createTrackFreezeSourceSignature } from '../createTrackFreezeSourceSignature';

function signatureOf(clip: Clip): string {
    return createTrackFreezeSourceSignature({ clips: [clip], devices: [] });
}

describe('createTrackFreezeSourceSignature', () => {
    it('builds a deterministic signature from clips and devices', () => {
        const sig = createTrackFreezeSourceSignature({
            clips: [
                {
                    id: 'c1',
                    startBeat: 0,
                    endBeat: 4,
                    type: 'audio',
                    fadeInBeats: 0,
                    fadeOutBeats: 0,
                    muted: false,
                    gain: 1,
                },
            ],
            devices: [{ id: 'd1', type: 'reverb', parameterValues: { mix: 0.5, decay: 2 }, bypassed: false }],
        });

        // clip = id:start:duration:assetHash:gain:type:bufferId:audioOffset:
        // midiOffset:fadeIn:fadeOut:muted:stretchMode:stretchRatio:loopEnabled:loopLength
        // ; device params sorted by name.
        expect(sig).toBe('c1:0:4::1:audio::0:0:0:0:false:::false:0||d1:reverb:decay=2,mix=0.5:false');
    });

    it('includes the asset hash when a clip carries one', () => {
        const withHash = createTrackFreezeSourceSignature({
            clips: [
                {
                    id: 'c1',
                    startBeat: 0,
                    endBeat: 4,
                    assetHash: 'sha-abc',
                    type: 'audio',
                    fadeInBeats: 0,
                    fadeOutBeats: 0,
                    muted: false,
                    gain: 1,
                },
            ],
            devices: [],
        });
        const withoutHash = createTrackFreezeSourceSignature({
            clips: [
                {
                    id: 'c1',
                    startBeat: 0,
                    endBeat: 4,
                    type: 'audio',
                    fadeInBeats: 0,
                    fadeOutBeats: 0,
                    muted: false,
                    gain: 1,
                },
            ],
            devices: [],
        });

        // The hash arm (?? '') produces a non-empty slot vs an empty one.
        expect(withHash).toBe('c1:0:4:sha-abc:1:audio::0:0:0:0:false:::false:0||');
        expect(withoutHash).toBe('c1:0:4::1:audio::0:0:0:0:false:::false:0||');
        expect(withHash).not.toBe(withoutHash);
    });

    it('sorts clips by start beat then id so reordering does not change the signature', () => {
        const base = [
            {
                id: 'a',
                startBeat: 0,
                endBeat: 4,
                type: 'audio',
                fadeInBeats: 0,
                fadeOutBeats: 0,
                muted: false,
                gain: 1,
            },
            {
                id: 'b',
                startBeat: 4,
                endBeat: 8,
                type: 'audio',
                fadeInBeats: 0,
                fadeOutBeats: 0,
                muted: false,
                gain: 1,
            },
        ] as const;
        const sigForward = createTrackFreezeSourceSignature({ clips: [...base], devices: [] });
        const sigReversed = createTrackFreezeSourceSignature({ clips: [...base].reverse(), devices: [] });

        expect(sigForward).toBe(sigReversed);
    });

    it('breaks start-beat ties by clip id so same-start clips are ordered deterministically', () => {
        // Both clips start at beat 0, so the comparator must fall through to
        // id.localeCompare — otherwise the sort (and the signature) would be
        // unstable across runs.
        const clip = {
            startBeat: 0,
            endBeat: 2,
            type: 'audio',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            muted: false,
            gain: 1,
        } as const;
        const sigOrdered = createTrackFreezeSourceSignature({
            clips: [
                { id: 'alpha', ...clip },
                { id: 'beta', ...clip },
            ],
            devices: [],
        });
        const sigReversed = createTrackFreezeSourceSignature({
            clips: [
                { id: 'beta', ...clip },
                { id: 'alpha', ...clip },
            ],
            devices: [],
        });

        // alpha before beta regardless of input order.
        expect(sigOrdered).toBe(
            'alpha:0:2::1:audio::0:0:0:0:false:::false:0|beta:0:2::1:audio::0:0:0:0:false:::false:0||'
        );
        expect(sigOrdered).toBe(sigReversed);
    });

    it('is independent of device parameter insertion order', () => {
        const sigA = createTrackFreezeSourceSignature({
            clips: [],
            devices: [{ id: 'd1', type: 'eq', parameterValues: { gain: 1, freq: 440 }, bypassed: false }],
        });
        const sigB = createTrackFreezeSourceSignature({
            clips: [],
            devices: [{ id: 'd1', type: 'eq', parameterValues: { freq: 440, gain: 1 }, bypassed: false }],
        });

        // Parameter entries are sorted by name, so key order is irrelevant.
        expect(sigA).toBe(sigB);
    });

    // Every render-affecting clip field the freeze render reads must move the
    // signature, or a frozen track keeps replaying its stale buffer after the
    // edit (audit #4591).
    it.each([
        ['mute', { muted: true }],
        ['fade-in', { fadeInBeats: 1 }],
        ['fade-out', { fadeOutBeats: 1 }],
        ['audio content slip', { audioOffsetBeats: 2 }],
        ['midi content slip', { midiOffsetBeats: 2 }],
        ['audio buffer swap', { audioBufferId: 'buffer-2' }],
        ['asset hash', { assetHash: 'sha-x' }],
        ['stretch mode', { stretchMode: 'timestretch' }],
        ['stretch ratio', { stretchRatio: 1.5 }],
        ['loop toggle', { loopEnabled: true }],
        ['loop length', { loopLength: 2 }],
        ['clip gain', { gain: 0.5 }],
        ['start beat', { startBeat: 1 }],
        ['end beat', { endBeat: 5 }],
        ['clip type', { type: 'midi' }],
    ] as const)('changes when an edit is %s', (_edit, change) => {
        const base: Clip = ClipDummy.create({ id: 'c1', startBeat: 0, endBeat: 4, audioBufferId: 'buffer-1' });

        expect(signatureOf({ ...base, ...change })).not.toBe(signatureOf(base));
    });

    it('does not change when a field no renderer reads changes', () => {
        const base: Clip = ClipDummy.create({ id: 'c1', startBeat: 0, endBeat: 4, audioBufferId: 'buffer-1' });
        const renamed: Clip = { ...base, name: 'renamed', color: '#00ff00', locked: !base.locked };

        expect(signatureOf(base)).toBe(signatureOf(renamed));
    });
});
