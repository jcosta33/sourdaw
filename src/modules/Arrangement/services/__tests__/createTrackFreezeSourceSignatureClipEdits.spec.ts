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

    it('preserves the exact signature for legacy clips without a canonical seconds offset', () => {
        expect(signatureOf(base)).toBe('clip-b:4:4::1:audio:buffer-b:0:0:0:0:false:::false:0||');
    });

    it('changes when the canonical seconds offset changes while the beat alias stays fixed', () => {
        const clip = { ...base, audioOffsetBeats: 2, audioOffsetSeconds: 1 };
        expect(signatureOf({ ...clip, audioOffsetSeconds: 2 })).not.toBe(signatureOf(clip));
    });

    it('distinguishes canonical zero from an absent offset despite a nonzero beat alias', () => {
        const legacy = { ...base, audioOffsetBeats: 2 };
        expect(signatureOf({ ...legacy, audioOffsetSeconds: 0 })).not.toBe(signatureOf(legacy));
    });

    it('changes when the canonical seconds offset is negative', () => {
        const clip = { ...base, audioOffsetSeconds: 0 };
        expect(signatureOf({ ...clip, audioOffsetSeconds: -1 })).not.toBe(signatureOf(clip));
    });

    it('keeps an unchanged canonical seconds offset stable', () => {
        const clip = { ...base, audioOffsetSeconds: -1 };
        expect(signatureOf({ ...base, audioOffsetSeconds: -1 })).toBe(signatureOf(clip));
    });
});
