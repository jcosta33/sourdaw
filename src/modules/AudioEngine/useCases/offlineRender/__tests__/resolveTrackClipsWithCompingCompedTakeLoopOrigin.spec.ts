import { afterEach, describe, expect, it } from 'vitest';

import { type Clip, type TakeLaneStoreState, takeLaneStore } from '#/modules/Arrangement/stores';
import { resolveClipsWithComping } from '#/modules/Arrangement/useCases';

import { projectOfflineAudioClipPlaybacks } from '../projectOfflineAudioClipPlaybacks';
import { resolveTrackClipsWithComping } from '../resolveTrackClipsWithComping';

/**
 * #4988, comped takes under an anchored looped source: a take fragment's media
 * basis is the take's own — its offset names what sounds at the region head in
 * take coordinates — so the source clip's loop anchor has no meaning in it.
 * Carried through, the loop-window readers subtract advance = fragmentStart −
 * anchor from the take's offset and wrap onto an earlier pass's material. The
 * resolvers strip the anchor, so the fragment reads the pre-anchor law: window
 * opening at its own offset, the placed media it read before anchoring existed.
 *
 * Figures are flat 120 BPM — one beat is 0.5 s. The recorded clip spans [0,16)
 * with a 4-beat loop; pass 3 was placed at depth 8, so its media is beats
 * [8,12) = buffer seconds [4,6), and the comp region [8,12) is one full loop
 * past the anchor at 0.
 */

function recordedClip(loopOriginBeat: number | undefined): Clip {
    const clip: Clip = {
        id: 'rec',
        trackId: 't1',
        name: 'Recording',
        startBeat: 0,
        endBeat: 16,
        type: 'audio',
        audioBufferId: 'rec-buf',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
        loopEnabled: true,
        loopLength: 4,
        audioOffsetBeats: 0,
    };
    if (loopOriginBeat !== undefined) {
        clip.loopOriginBeat = loopOriginBeat;
    }
    return clip;
}

/** A placed audio pass as the recorder commits it: placement seconds at 120 BPM. */
function placedPass(id: string, startBeat: number, depthBeats: number) {
    return {
        id,
        clipId: 'rec',
        name: id,
        startBeat,
        endBeat: startBeat + 4,
        selected: false,
        sourceOffsetBeats: depthBeats,
        passAnchorSeconds: startBeat / 2,
        passDepthSeconds: depthBeats / 2,
    };
}

const PASS3_LANE: TakeLaneStoreState = {
    lanes: [
        {
            id: 'lane-1',
            trackId: 't1',
            takes: [placedPass('pass-1', 0, 0), placedPass('pass-3', 8, 8)],
            activeCompRegions: [{ startBeat: 8, endBeat: 12, takeId: 'pass-3' }],
        },
    ],
};

function projectFragment(fragment: Clip) {
    return projectOfflineAudioClipPlaybacks({
        clip: fragment,
        // The 16-beat recording at 120 BPM.
        bufferDurationSeconds: 8,
        regionStartBeat: 0,
        regionStartSec: 0,
        durationSeconds: 40,
        compensationDelay: 0,
        projectBeatToSeconds: (beat) => beat * 0.5,
        resolveTempoAtBeat: () => 120,
    });
}

describe('comped take fragments under an anchored looped source', () => {
    afterEach(() => {
        takeLaneStore.set({ lanes: [] });
    });

    it('the offline resolver strips the anchor so a region on pass 3 reads pass 3', () => {
        takeLaneStore.set(PASS3_LANE);

        // Sorted by startBeat: the head gap [0,8), the comped take fragment
        // [8,12), the tail gap [12,16).
        const [, takeFragment, tailGap] = resolveTrackClipsWithComping('t1', [recordedClip(0)]);

        // The fragment carries the take's own entry — media beat 8, the head
        // of pass 3's material — and no anchor: the source's anchor at 0 is
        // meaningless in the take's basis.
        expect(takeFragment!.startBeat).toBe(8);
        expect(takeFragment!.endBeat).toBe(12);
        expect(takeFragment!.audioOffsetBeats).toBe(8);
        expect(takeFragment!.loopOriginBeat).toBeUndefined();
        // The fragment still loops with the source's length.
        expect(takeFragment!.loopEnabled).toBe(true);
        expect(takeFragment!.loopLength).toBe(4);

        const playbacks = projectFragment(takeFragment!);
        // Carrying the anchor read buffer 0 — pass 1's material. Stripped, the
        // region opens at the fragment's own offset: pass 3. The fragment
        // starts at beat 8, so the sound opens at second 4 on this timeline.
        expect(playbacks).toHaveLength(1);
        expect(playbacks[0]!.startSec).toBe(4);
        expect(playbacks[0]!.bufferOffsetSec).toBe(4);
        expect(playbacks[0]!.playDuration).toBe(2);

        // Gap fragments keep the anchor: their offset advances with the same
        // beat as the window, so the source's own region law holds — the gap
        // at [12,16) reads the loop region [0,4) from its head.
        expect(tailGap!.startBeat).toBe(12);
        expect(tailGap!.loopOriginBeat).toBe(0);
        expect(tailGap!.audioOffsetBeats).toBe(12);
        const gapPlaybacks = projectFragment(tailGap!);
        expect(gapPlaybacks[0]!.bufferOffsetSec).toBe(0);
    });

    it('the live resolver strips the anchor the same way', () => {
        takeLaneStore.set(PASS3_LANE);

        const [, takeFragment, tailGap] = resolveClipsWithComping('t1', [recordedClip(0)]);

        expect(takeFragment!.startBeat).toBe(8);
        expect(takeFragment!.audioOffsetBeats).toBe(8);
        expect(takeFragment!.loopOriginBeat).toBeUndefined();
        expect(takeFragment!.loopEnabled).toBe(true);
        expect(takeFragment!.loopLength).toBe(4);
        expect(tailGap!.loopOriginBeat).toBe(0);

        const playbacks = projectFragment(takeFragment!);
        expect(playbacks[0]!.bufferOffsetSec).toBe(4);
    });

    it('an anchored source reads identically to an unanchored one', () => {
        takeLaneStore.set(PASS3_LANE);

        const anchored = resolveTrackClipsWithComping('t1', [recordedClip(0)]);
        const unanchored = resolveTrackClipsWithComping('t1', [recordedClip(undefined)]);

        expect(anchored.map((clip) => clip.audioOffsetBeats)).toEqual(unanchored.map((clip) => clip.audioOffsetBeats));
        // The take fragment loses the anchor either way; gap fragments keep
        // theirs — the anchor at 0 — because their basis is the source's own.
        expect(anchored[1]!.loopOriginBeat).toBeUndefined();
        expect(unanchored[1]!.loopOriginBeat).toBeUndefined();
        expect(anchored[2]!.loopOriginBeat).toBe(0);
    });
});
