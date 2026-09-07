import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../../models/ProjectContext';
import { getSelectedClipReferenceIds, getUniqueSelectedClipReferenceId } from '../selectedClipReference';

function createContext(selectedClipId: string | null, selectedClipIds: string[]): ProjectContext {
    return {
        tempo: 120,
        timeSignature: [4, 4],
        isPlaying: false,
        isRecording: false,
        isLooping: false,
        loopStart: 0,
        loopEnd: 8,
        punchInEnabled: false,
        punchInBeat: 0,
        punchOutBeat: 8,
        metronomeEnabled: false,
        metronomeVolume: 0.5,
        masterGain: 1,
        tracks: [
            {
                id: 'track-1',
                name: 'Track 1',
                kind: 'audio',
                muted: false,
                soloed: false,
                soloSafe: false,
                armed: false,
                gain: 1,
                pan: 0,
                automationMode: 'read',
                clipCount: 1,
                deviceCount: 0,
                clips: [
                    {
                        id: 'clip-1',
                        name: 'Clip 1',
                        type: 'audio',
                        startBeat: 0,
                        endBeat: 8,
                        noteCount: 0,
                    },
                ],
                devices: [],
            },
        ],
        selectedTrackId: 'track-1',
        selectedClipId,
        selectedClipIds,
        activeView: 'arrange',
        playheadPosition: 0,
    };
}

describe('selected clip references', () => {
    it.each([
        [null, ['clip-1']],
        ['clip-1', []],
        ['clip-1', ['clip-1']],
    ])('returns one existing selection from scalar and array state', (selectedClipId, selectedClipIds) => {
        const context = createContext(selectedClipId, selectedClipIds);

        expect(getSelectedClipReferenceIds(context)).toEqual(['clip-1']);
        expect(getUniqueSelectedClipReferenceId(context)).toBe('clip-1');
    });

    it.each([
        [null, []],
        ['missing-clip', []],
        ['clip-1', ['clip-1', 'missing-clip']],
    ])(
        'does not collapse missing or multiple union members into unique authority',
        (selectedClipId, selectedClipIds) => {
            const context = createContext(selectedClipId, selectedClipIds);

            expect(getUniqueSelectedClipReferenceId(context)).toBeNull();
        }
    );
});
