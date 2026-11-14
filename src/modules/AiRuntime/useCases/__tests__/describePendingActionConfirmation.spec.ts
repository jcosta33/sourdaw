import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../models/ProjectContext';
import { describePendingActionConfirmation } from '../describePendingActionConfirmation';
import { describePlannedAction } from '../describePlannedAction';

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 0,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

describe('describePendingActionConfirmation', () => {
    it('words an action type with no exact reading as its planned-action description', () => {
        const action = { type: 'togglePlayback' } as const;

        const { actionLabels } = describePendingActionConfirmation({ actions: [action], context, prompt: 'play' });

        expect(actionLabels).toEqual([describePlannedAction({ action, context })]);
    });

    it('words a created bus exactly, and as planned when it carries no identity', () => {
        const { actionLabels } = describePendingActionConfirmation({
            actions: [
                { type: 'createBus', payload: { busId: 'bus-1', name: 'Drum Bus' } },
                { type: 'createBus', payload: { name: 'Anonymous Bus' } },
            ],
            context,
            prompt: 'add buses',
        });

        expect(actionLabels[0]).toBe('Create bus "Drum Bus" (bus-1)');
        expect(actionLabels[1]).toBe(
            describePlannedAction({ action: { type: 'createBus', payload: { name: 'Anonymous Bus' } }, context })
        );
    });
});
