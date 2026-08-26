import { describe, it, expect, vi, beforeEach } from 'vitest';

import { midiClipSplitStateMatches, restoreMidiClipSplitState } from '#/modules/MIDI/useCases';
import {
    type ClipSplitActionSnapshot,
    type ClipStateSnapshot,
    type MidiClipDataActionSnapshot,
} from '#/utils/handlerContract';

vi.mock('#/modules/MIDI/useCases', () => ({
    midiClipSplitStateMatches: vi.fn(),
    restoreMidiClipSplitState: vi.fn(),
}));

vi.mock('../../../stores/clipSatelliteState', () => ({
    clipSatelliteEntriesMatchSnapshot: vi.fn(),
    writeClipSatelliteEntry: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/clipSplitStateRestorable', () => ({
    clipSplitStateRestorable: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/replaceClipSplitTrackState', () => ({
    replaceClipSplitTrackState: vi.fn(),
}));

import { clipSatelliteEntriesMatchSnapshot, writeClipSatelliteEntry } from '../../../stores/clipSatelliteState';
import { clipSplitStateRestorable } from '../../../useCases/clipEditing/clipSplitStateRestorable';
import { replaceClipSplitTrackState } from '../../../useCases/clipEditing/replaceClipSplitTrackState';
import { handleRestoreClipSplitState } from '../handleRestoreClipSplitState';

const mockedRestorable = vi.mocked(clipSplitStateRestorable);
const mockedReplaceTrackState = vi.mocked(replaceClipSplitTrackState);
const mockedMidiMatches = vi.mocked(midiClipSplitStateMatches);
const mockedRestoreMidi = vi.mocked(restoreMidiClipSplitState);
const mockedSatellitesMatch = vi.mocked(clipSatelliteEntriesMatchSnapshot);
const mockedWriteSatellite = vi.mocked(writeClipSatelliteEntry);

function makeClipSnapshot(id: string): ClipStateSnapshot {
    return {
        id,
        trackId: 't1',
        name: id,
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#000',
        locked: false,
        muted: false,
    };
}

const emptyMidi: MidiClipDataActionSnapshot = {
    notes: { present: false, value: [] },
    controlChanges: { present: false, value: [] },
    pitchBends: { present: false, value: [] },
};

function makeSnapshot(overrides: Partial<ClipSplitActionSnapshot> = {}): ClipSplitActionSnapshot {
    return {
        trackId: 't1',
        leftClip: makeClipSnapshot('c1'),
        rightClip: makeClipSnapshot('c2'),
        rightClipIndex: 1,
        sourceMidi: emptyMidi,
        rightMidi: emptyMidi,
        ...overrides,
    };
}

function makeAction(expected: ClipSplitActionSnapshot, replacement: ClipSplitActionSnapshot) {
    return {
        type: 'restoreClipSplitState' as const,
        payload: { clipId: 'c1', rightClipId: 'c2', expected, replacement },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mockedRestorable.mockReturnValue(true);
    mockedReplaceTrackState.mockReturnValue(true);
    mockedMidiMatches.mockReturnValue(true);
    mockedRestoreMidi.mockReturnValue(true);
    mockedSatellitesMatch.mockReturnValue(true);
});

describe('handleRestoreClipSplitState — satellites', () => {
    it('writes every replacement satellite entry on execute', () => {
        const satellites = [
            {
                clipId: 'c1',
                gainEnvelope: {
                    clipId: 'c1',
                    enabled: true,
                    points: [{ id: 'p0', beatOffset: 0, gainDb: -3 }],
                },
                warpState: null,
            },
            { clipId: 'c2', gainEnvelope: null, warpState: null },
        ];
        const result = handleRestoreClipSplitState.execute(
            makeAction(makeSnapshot({ clipSatellites: satellites }), makeSnapshot({ clipSatellites: satellites }))
        );

        expect(result).toEqual({ status: 'written' });
        expect(mockedWriteSatellite).toHaveBeenCalledTimes(2);
        expect(mockedWriteSatellite).toHaveBeenNthCalledWith(1, satellites[0]);
        expect(mockedWriteSatellite).toHaveBeenNthCalledWith(2, satellites[1]);
    });

    it('writes no satellites for a legacy payload that predates the field', () => {
        const result = handleRestoreClipSplitState.execute(makeAction(makeSnapshot(), makeSnapshot()));

        expect(result).toEqual({ status: 'written' });
        expect(mockedWriteSatellite).not.toHaveBeenCalled();
    });

    it('does not write satellites when the MIDI restore conflicts', () => {
        mockedRestoreMidi.mockReturnValue(false);
        const satellites = [{ clipId: 'c2', gainEnvelope: null, warpState: null }];
        const result = handleRestoreClipSplitState.execute(
            makeAction(makeSnapshot(), makeSnapshot({ clipSatellites: satellites }))
        );

        expect(result).toEqual({ status: 'conflict' });
        expect(mockedWriteSatellite).not.toHaveBeenCalled();
    });

    it('validate refuses when the expected satellites no longer match the stores', () => {
        mockedSatellitesMatch.mockReturnValue(false);
        const satellites = [{ clipId: 'c1', gainEnvelope: null, warpState: null }];

        expect(
            handleRestoreClipSplitState.validate(
                makeAction(makeSnapshot({ clipSatellites: satellites }), makeSnapshot())
            )
        ).toBe(false);
        expect(mockedSatellitesMatch).toHaveBeenCalledWith(satellites);
    });

    it('validate skips the satellite check for a legacy payload', () => {
        expect(handleRestoreClipSplitState.validate(makeAction(makeSnapshot(), makeSnapshot()))).toBe(true);
        expect(mockedSatellitesMatch).not.toHaveBeenCalled();
    });
});
