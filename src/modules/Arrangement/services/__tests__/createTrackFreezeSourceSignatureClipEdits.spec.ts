import { describe, expect, it } from 'vitest';

import { ClipDummy } from '../../__tests__/ClipDummy';
import { type Clip } from '../../models/Track';
import { createTrackFreezeSourceSignature } from '../createTrackFreezeSourceSignature';

// Audit #4591 — a frozen track keeps replaying its rendered buffer until
// `initStalenessDetection` sees the freeze source signature change. Every
// clip edit that changes what the track sounds like must change it, or the
// frozen track keeps playing — live and in export — audio it no longer has.
describe('freeze source signature and audible clip edits', () => {
    const base: Clip = ClipDummy.create({ id: 'clip-b', startBeat: 4, endBeat: 8, audioBufferId: 'buffer-b' });

    function signatureOf(clip: Clip): string {
        return createTrackFreezeSourceSignature({ clips: [clip], devices: [] });
    }

    it.each([
        ['muting the clip', { muted: true }],
        ['a fade-in', { fadeInBeats: 1 }],
        ['a fade-out', { fadeOutBeats: 1 }],
        ['slipping the content', { audioOffsetBeats: 2 }],
        ['swapping the audio buffer (reverse)', { audioBufferId: 'buffer-b-reversed' }],
    ] as const)('changes when an edit is %s', (_edit, change) => {
        expect(signatureOf({ ...base, ...change })).not.toBe(signatureOf(base));
    });

    it.each([
        { audioOffsetSeconds: 0 },
        { audioLoopStartSeconds: -1 },
        { audioLoopPassEntrySeconds: 0 },
        { audioLoopPassOriginBeat: 2 },
    ])('invalidates a frozen render when a physical audio source anchor changes %j', (change) => {
        const canonical: Clip = {
            ...base,
            startBeat: 2,
            endBeat: 9,
            loopEnabled: true,
            loopLength: 4,
            loopOriginBeat: 0,
            audioOffsetSeconds: 1.5,
            audioLoopStartSeconds: 0,
            audioLoopPassEntrySeconds: 0.5,
            audioLoopPassOriginBeat: 1,
            stretchMode: 'timestretch',
            stretchRatio: 2,
        };
        expect(signatureOf({ ...canonical, ...change })).not.toBe(signatureOf(canonical));
    });
});
