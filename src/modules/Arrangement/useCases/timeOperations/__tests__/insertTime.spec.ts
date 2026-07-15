import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
    trackState,
    setTrackState,
    markerStoreValue,
    markerStoreSet,
    shiftAutomationAfterBeat,
    shiftTimelineMapsAfterBeat,
    shiftMidiNotesAfterBeat,
} = vi.hoisted(() => ({
    trackState: {
        value: {
            tracks: [
                {
                    id: 'track-1',
                    clips: [
                        { id: 'before', startBeat: 1, endBeat: 3 },
                        { id: 'overlap', startBeat: 2, endBeat: 5 },
                        { id: 'after', startBeat: 5, endBeat: 7 },
                    ],
                },
            ],
        },
    },
    setTrackState: vi.fn(),
    markerStoreValue: {
        value: {
            markers: [
                { id: 'marker-before', beat: 3, name: 'Before', color: '#fff' },
                { id: 'marker-at', beat: 4, name: 'At', color: '#fff' },
                { id: 'marker-after', beat: 6, name: 'After', color: '#fff' },
            ],
            sections: [],
        },
    },
    markerStoreSet: vi.fn(),
    shiftAutomationAfterBeat: vi.fn(),
    shiftTimelineMapsAfterBeat: vi.fn(),
    shiftMidiNotesAfterBeat: vi.fn(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: () => trackState.value,
}));

vi.mock('../../../repositories/track/setTrackState', () => ({
    setTrackState,
}));

vi.mock('../../../stores/markerStore', () => ({
    markerStore: {
        get value() {
            return markerStoreValue.value;
        },
        set: markerStoreSet,
    },
}));

vi.mock('#/modules/Automation/useCases', () => ({
    shiftAutomationAfterBeat,
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    shiftMidiNotesAfterBeat,
}));

import { insertTime } from '../insertTime';
import { setTimeOperationDependencies } from '../timeOperationDependencies';

describe('insertTime', () => {
    beforeEach(() => {
        trackState.value = {
            tracks: [
                {
                    id: 'track-1',
                    clips: [
                        { id: 'before', startBeat: 1, endBeat: 3 },
                        { id: 'overlap', startBeat: 2, endBeat: 5 },
                        { id: 'after', startBeat: 5, endBeat: 7 },
                    ],
                },
            ],
        };
        markerStoreValue.value = {
            markers: [
                { id: 'marker-before', beat: 3, name: 'Before', color: '#fff' },
                { id: 'marker-at', beat: 4, name: 'At', color: '#fff' },
                { id: 'marker-after', beat: 6, name: 'After', color: '#fff' },
            ],
            sections: [],
        };
        setTrackState.mockClear();
        markerStoreSet.mockClear();
        shiftAutomationAfterBeat.mockClear();
        shiftTimelineMapsAfterBeat.mockClear();
        shiftMidiNotesAfterBeat.mockClear();
        setTimeOperationDependencies({
            shiftTimelineMapsAfterBeat,
            deleteTimelineMapsTimeRange: vi.fn(),
        });
    });

    it('should shift clips, markers, automation, timeline maps, and MIDI after the insertion beat', () => {
        insertTime(4, 2);

        expect(setTrackState).toHaveBeenCalledWith({
            tracks: [
                {
                    id: 'track-1',
                    clips: [
                        { id: 'before', startBeat: 1, endBeat: 3 },
                        { id: 'overlap', startBeat: 2, endBeat: 7 },
                        { id: 'after', startBeat: 7, endBeat: 9 },
                    ],
                },
            ],
        });
        expect(markerStoreSet).toHaveBeenCalledWith({
            markers: [
                { id: 'marker-before', beat: 3, name: 'Before', color: '#fff' },
                { id: 'marker-at', beat: 6, name: 'At', color: '#fff' },
                { id: 'marker-after', beat: 8, name: 'After', color: '#fff' },
            ],
            sections: [],
        });
        expect(shiftAutomationAfterBeat).toHaveBeenCalledWith({ atBeat: 4, deltaBeats: 2 });
        expect(shiftTimelineMapsAfterBeat).toHaveBeenCalledWith({ atBeat: 4, deltaBeats: 2 });
        expect(shiftMidiNotesAfterBeat).toHaveBeenCalledWith({ atBeat: 4, delta: 2 });
    });

    it('should fail before mutating state when time operation dependencies are not registered', () => {
        setTimeOperationDependencies(null);

        expect(() => insertTime(4, 2)).toThrow('Arrangement time operation dependencies are not registered');
        expect(setTrackState).not.toHaveBeenCalled();
        expect(markerStoreSet).not.toHaveBeenCalled();
        expect(shiftAutomationAfterBeat).not.toHaveBeenCalled();
        expect(shiftTimelineMapsAfterBeat).not.toHaveBeenCalled();
        expect(shiftMidiNotesAfterBeat).not.toHaveBeenCalled();
    });
});
