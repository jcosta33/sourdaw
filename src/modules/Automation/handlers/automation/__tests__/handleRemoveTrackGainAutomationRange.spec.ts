import { beforeEach, describe, expect, it } from 'vitest';

import { markerStore, trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { buildTrackGainAutomationRangeLane } from '../../../services/buildTrackGainAutomationRangeLane';
import { automationStore } from '../../../stores/automationStore';
import { handleRemoveTrackGainAutomationRange } from '../handleRemoveTrackGainAutomationRange';

const SECTION_ID = 'section-1';
const TRACK_ID = 'track-1';

function primeStores(laneMaxValue: number) {
    const track = { ...createTrack({ name: 'Bus', kind: 'bus' }), id: TRACK_ID, gain: 1, kind: 'bus' as const };
    trackStore.set({ tracks: [track], selectedTrackId: null });
    markerStore.set({
        markers: [],
        sections: [{ id: SECTION_ID, startBeat: 0, endBeat: 16, name: 'Verse', color: '#000000' }],
    });
    const lane = buildTrackGainAutomationRangeLane({
        trackId: track.id,
        trackName: track.name,
        baseGain: track.gain,
        startBeat: 0,
        endBeat: 16,
        gainDb: 5,
    });
    // The document is the only thing that varies between these cases: the same
    // lift recorded before the fader widened stored `1` here.
    automationStore.set({ lanes: [{ ...lane, maxValue: laneMaxValue }] });
    return track;
}

function makeAction(track: ReturnType<typeof primeStores>) {
    return {
        type: 'removeTrackGainAutomationRange' as const,
        payload: {
            trackIds: [track.id],
            sectionName: 'Verse',
            gainDb: 5,
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

/**
 * `actionHistoryStore` is a slot of the synced root document, so an undo entry
 * outlives the session that recorded it. This handler is the inverse of
 * "lift the section by N dB": it rebuilds the lane the lift would have written
 * and refuses unless the document still holds exactly that. Widening the
 * builder's `maxValue` therefore stranded every entry recorded before the
 * change — the rebuilt expectation says `FADER_MAX_GAIN`, the stored lane says
 * `1`, and the user's undo stops working on a project that never changed.
 */
describe('handleRemoveTrackGainAutomationRange — undo across the widened ceiling', () => {
    beforeEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null });
        markerStore.set({ markers: [], sections: [] });
        automationStore.set({ lanes: [] });
    });

    it('undoes a lift recorded before the fader widened, whose lane still stores unity', () => {
        const track = primeStores(1);

        expect(
            handleRemoveTrackGainAutomationRange.validate?.(makeAction(track), { actions: [], actionIndex: 0 })
        ).toBe(true);
        expect(handleRemoveTrackGainAutomationRange.execute(makeAction(track))).toEqual({ status: 'written' });
        expect(automationStore.value?.lanes).toHaveLength(0);
    });

    it('undoes a lift recorded after it, whose lane stores the fader ceiling', () => {
        const track = primeStores(FADER_MAX_GAIN);

        expect(handleRemoveTrackGainAutomationRange.execute(makeAction(track))).toEqual({ status: 'written' });
        expect(automationStore.value?.lanes).toHaveLength(0);
    });

    it('still refuses when the lane in the document is not the one the lift wrote', () => {
        const track = primeStores(FADER_MAX_GAIN);
        const lane = automationStore.value!.lanes[0]!;
        // A ceiling neither side of the change ever produced, and one the
        // derivation cannot fold into either — so the guard must still bite.
        automationStore.set({ lanes: [{ ...lane, maxValue: 4 }] });

        expect(handleRemoveTrackGainAutomationRange.execute(makeAction(track))).toEqual({ status: 'conflict' });
        expect(automationStore.value?.lanes).toHaveLength(1);
    });
});
