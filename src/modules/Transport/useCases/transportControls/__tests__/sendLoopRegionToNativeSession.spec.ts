/**
 * Every loop gesture, against a live native session (#3105).
 *
 * Driven through the gestures rather than through the helper they share,
 * because the defect this covers was never in a helper — it was in which
 * gestures had one. The live `transportStore` is the subject too, not a double:
 * the region the engine receives is projected from what the gesture committed,
 * so a spec that stubbed the commit would only prove the projection agrees with
 * itself.
 *
 * `updateNativeLiveGraphSessionTransportMaps` is the double, because it is the
 * boundary the Transport module is allowed to know about. What the session then
 * does with the maps is proven where the session lives.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTransportState, type TransportState } from '../../../models/TransportState';
import { tempoMapStore } from '../../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../../stores/timeSignatureMapStore';
import { transportStore } from '../../../stores/transportStore';
import { disableLooping } from '../../setLooping';
import { restoreLoopRegion } from '../restoreLoopRegion';
import { setLoopEnabled } from '../setLoopEnabled';
import { setLoopRegion } from '../setLoopRegion';
import { toggleLoop } from '../toggleLoop';

type MapsUpdate = (input: {
    transportMaps: { loopRegion: { enabled: boolean; startSeconds: number; endSeconds: number } | null };
}) => Promise<{ outcome: 'updated' } | { outcome: 'declined'; reason: string }>;

const mocks = vi.hoisted(() => ({
    updateTransportMaps: vi.fn<MapsUpdate>(),
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    startNativeLiveGraphSession: vi.fn(),
    updateNativeLiveGraphSessionTransportMaps: mocks.updateTransportMaps,
}));
vi.mock('#/infra/logger/appLogger', () => ({ logger: mocks.logger }));

/** The region the last gesture sent, as the engine would receive it. */
function sentLoopRegion(): unknown {
    return mocks.updateTransportMaps.mock.lastCall?.[0].transportMaps.loopRegion;
}

/**
 * A transport playing a 120 BPM arrangement with a loop over beats 4 to 8 —
 * two seconds to four on the engine's clock.
 */
function playingWithLoop(overrides?: Partial<TransportState>): void {
    transportStore.set({
        ...defaultTransportState,
        tempo: 120,
        isPlaying: true,
        isLooping: true,
        loopStart: 4,
        loopEnd: 8,
        ...overrides,
    });
}

beforeEach(() => {
    mocks.updateTransportMaps.mockReset();
    mocks.updateTransportMaps.mockResolvedValue({ outcome: 'updated' });
    mocks.logger.debug.mockClear();
    mocks.logger.warn.mockClear();
    tempoMapStore.set({ changes: [] });
    timeSignatureMapStore.set({ changes: [] });
});

describe('loop gestures during playback', () => {
    it('sends the disengaged region when the loop is toggled off mid-take', () => {
        playingWithLoop();

        toggleLoop();

        // The engine wraps on `enabled`, so a toggle that never reached it goes
        // on wrapping at a seam the musician just switched off, while the Web
        // Audio transport plays straight through.
        expect(sentLoopRegion()).toEqual({ enabled: false, startSeconds: 2, endSeconds: 4 });
    });

    it('sends the engaged region when the loop is toggled on mid-take', () => {
        playingWithLoop({ isLooping: false });

        toggleLoop();

        expect(sentLoopRegion()).toEqual({ enabled: true, startSeconds: 2, endSeconds: 4 });
    });

    it('integrates a newly dragged region through the tempo map, not through the transport tempo', () => {
        playingWithLoop({ isLooping: false, loopStart: 0, loopEnd: 0 });
        // Half tempo from beat 8 on: beat 8 lands four seconds in, and the four
        // beats after it take four seconds rather than two. A region converted
        // at the flat transport tempo would put the seam at six seconds — two
        // seconds before the bar the musician dropped the brace on.
        tempoMapStore.set({
            changes: [
                { id: 'tempo-0', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'tempo-8', beat: 8, tempo: 60, curve: 'instant' },
            ],
        });

        setLoopRegion(8, 12);

        expect(sentLoopRegion()).toEqual({ enabled: true, startSeconds: 4, endSeconds: 8 });
    });

    it('sends the region a bounds-only edit leaves behind, without asserting an enablement it did not set', () => {
        playingWithLoop({ isLooping: false });

        setLoopRegion(0, 4, false);

        expect(sentLoopRegion()).toEqual({ enabled: false, startSeconds: 0, endSeconds: 2 });
    });

    it('sends the cleared enablement when the loop is disabled from the ruler', () => {
        playingWithLoop();

        disableLooping();

        expect(sentLoopRegion()).toEqual({ enabled: false, startSeconds: 2, endSeconds: 4 });
    });

    it('sends the enablement an explicit set commits', () => {
        playingWithLoop({ isLooping: false });

        expect(setLoopEnabled(true)).toBe(true);

        expect(sentLoopRegion()).toEqual({ enabled: true, startSeconds: 2, endSeconds: 4 });
    });

    it('sends nothing for a set the transport refused', () => {
        playingWithLoop({ isLooping: false, loopStart: 8, loopEnd: 8 });

        expect(setLoopEnabled(true)).toBe(false);

        // Nothing was committed, so there is no new region to send, and a write
        // here would state an enablement the transport declined to hold.
        expect(mocks.updateTransportMaps).not.toHaveBeenCalled();
    });

    it('sends the restored region when an undo puts a loop edit back', () => {
        playingWithLoop();

        restoreLoopRegion({ loopStart: 0, loopEnd: 2, isLooping: true });

        expect(sentLoopRegion()).toEqual({ enabled: true, startSeconds: 0, endSeconds: 1 });
    });
});

describe('loop gestures while the transport is not playing', () => {
    it('send nothing, because the next play carries the region with the maps', () => {
        playingWithLoop({ isPlaying: false });

        toggleLoop();
        setLoopRegion(0, 16);
        disableLooping();
        restoreLoopRegion({ loopStart: 0, loopEnd: 4, isLooping: true });
        setLoopEnabled(true);

        // A parked engine renders no frame, so its seam is unobservable; each of
        // these would spend a bridge round trip moving a transport nobody is
        // listening to.
        expect(mocks.updateTransportMaps).not.toHaveBeenCalled();
    });
});

describe('a native session that cannot take the region', () => {
    it('contains a decline where it happens, leaving the committed loop alone', async () => {
        mocks.updateTransportMaps.mockResolvedValueOnce({
            outcome: 'declined',
            reason: 'no live native graph session',
        });
        playingWithLoop({ isLooping: false });

        toggleLoop();
        await vi.waitFor(() => {
            expect(mocks.logger.debug).toHaveBeenCalledOnce();
        });

        // Declining is the ordinary browser-build answer, so it is reported and
        // nothing else: the gesture already committed and the audible Web Audio
        // transport is looping.
        expect(mocks.logger.warn).not.toHaveBeenCalled();
        expect(transportStore.value?.isLooping).toBe(true);
    });

    it('contains a rejected round trip rather than leaving it unhandled', async () => {
        mocks.updateTransportMaps.mockRejectedValueOnce(new Error('bridge is gone'));
        playingWithLoop({ isLooping: false });

        toggleLoop();
        await vi.waitFor(() => {
            expect(mocks.logger.warn).toHaveBeenCalledOnce();
        });

        expect(transportStore.value?.isLooping).toBe(true);
    });
});
