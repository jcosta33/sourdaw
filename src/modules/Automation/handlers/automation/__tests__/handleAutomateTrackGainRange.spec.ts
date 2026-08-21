import { beforeEach, describe, expect, it } from 'vitest';

import { markerStore, trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { automationStore } from '../../../stores/automationStore';
import { handleAutomateTrackGainRange } from '../handleAutomateTrackGainRange';

const SECTION_ID = 'section-1';

function makeTrack(gain: number) {
    return { ...createTrack({ name: 'Bus', kind: 'bus' }), id: 'track-1', gain, kind: 'bus' as const };
}

function primeStores(gain: number) {
    const track = makeTrack(gain);
    trackStore.set({ tracks: [track], selectedTrackId: null });
    markerStore.set({
        markers: [],
        sections: [{ id: SECTION_ID, startBeat: 0, endBeat: 16, name: 'Verse', color: '#000000' }],
    });
    automationStore.set({ lanes: [] });
    return track;
}

function makeAction(gainDb: number, track: ReturnType<typeof makeTrack>) {
    return {
        type: 'automateTrackGainRange' as const,
        payload: {
            trackIds: [track.id],
            sectionName: 'Verse',
            gainDb,
            sectionId: SECTION_ID,
            startBeat: 0,
            endBeat: 16,
            expectedTracks: [
                {
                    trackId: track.id,
                    trackName: track.name,
                    gain: track.gain,
                    automationMode: track.automationMode,
                    frozen: track.frozen,
                },
            ],
            expectedSection: { name: 'Verse', startBeat: 0, endBeat: 16 },
        },
    };
}

describe('handleAutomateTrackGainRange — execute', () => {
    beforeEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null });
        markerStore.set({ markers: [], sections: [] });
        automationStore.set({ lanes: [] });
    });

    it('accepts a make-up gain lift that lands between unity and the fader ceiling', () => {
        // Base gain 1.0 (unity) lifted by the largest dB step that still lands
        // at or below FADER_MAX_GAIN (+6 dB headroom) — this is exactly the
        // make-up gain a human can already dial in by hand on the fader.
        const track = primeStores(1);
        const action = makeAction(5, track); // 1.0 * 10^(5/20) ≈ 1.7783, below FADER_MAX_GAIN (≈1.9953)

        const result = handleAutomateTrackGainRange.execute(action);

        expect(result).toEqual({ status: 'written' });
        const lane = automationStore.value?.lanes.find((candidate) => candidate.trackId === track.id);
        expect(lane).toBeDefined();
        expect(lane?.points.some((point) => point.value > 1)).toBe(true);
        expect(lane?.points.every((point) => point.value <= FADER_MAX_GAIN)).toBe(true);
    });

    it('rejects a lift that would exceed the fader ceiling as a conflict', () => {
        const track = primeStores(1);
        const action = makeAction(10, track); // 1.0 * 10^(10/20) ≈ 3.162, well past FADER_MAX_GAIN

        const result = handleAutomateTrackGainRange.execute(action);

        expect(result).toEqual({ status: 'conflict' });
        expect(automationStore.value?.lanes).toHaveLength(0);
    });
});
