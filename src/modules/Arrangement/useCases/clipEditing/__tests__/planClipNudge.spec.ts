import { describe, expect, it } from 'vitest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { planClipNudge } from '../planClipNudge';

describe('planClipNudge', () => {
    it('keeps the placement when the requested beats are not finite', () => {
        const clip = ClipDummy.create({ startBeat: 2, endBeat: 6, loopOriginBeat: 1 });

        expect(planClipNudge(clip, Number.NaN)).toEqual({ startBeat: 2, endBeat: 6, loopOriginBeat: 1 });
        expect(planClipNudge(clip, Number.POSITIVE_INFINITY)).toEqual({ startBeat: 2, endBeat: 6, loopOriginBeat: 1 });
    });

    it('moves the rectangle and carries both anchors by the applied delta', () => {
        const clip = ClipDummy.create({ startBeat: 2, endBeat: 6, loopOriginBeat: 1, audioLoopPassOriginBeat: 3 });

        expect(planClipNudge(clip, 1.5)).toEqual({
            startBeat: 3.5,
            endBeat: 7.5,
            loopOriginBeat: 2.5,
            audioLoopPassOriginBeat: 4.5,
        });
    });

    it('clamps at beat 0 and shifts the anchors by the clamped delta', () => {
        const clip = ClipDummy.create({ startBeat: 1, endBeat: 5, loopOriginBeat: 2 });

        expect(planClipNudge(clip, -3)).toEqual({ startBeat: 0, endBeat: 4, loopOriginBeat: 1 });
    });

    it('leaves a locked clip where it is and writes a recorded placement verbatim', () => {
        const locked = ClipDummy.create({ startBeat: 2, endBeat: 6, locked: true });
        const free = ClipDummy.create({ startBeat: 2, endBeat: 6 });

        expect(planClipNudge(locked, 4, { startBeat: 9, endBeat: 10 })).toEqual({ startBeat: 2, endBeat: 6 });
        expect(planClipNudge(free, 4, { startBeat: 9, endBeat: 10 })).toEqual({ startBeat: 9, endBeat: 10 });
    });
});
