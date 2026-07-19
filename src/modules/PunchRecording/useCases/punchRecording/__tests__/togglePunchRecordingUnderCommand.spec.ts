import { describe, expect, it } from 'vitest';

import { type CommitLegacyCommandUndo } from '#/utils/handlerContract';

import { commitTogglePunchRecording } from '../commitTogglePunchRecording';
import { togglePunchRecordingUnderCommand } from '../togglePunchRecordingUnderCommand';

describe('togglePunchRecordingUnderCommand', () => {
    it('returns the owning runner promise so failure stays attached to the outer command', async () => {
        const failure = new Error('punch commit failed');
        let receivedMutation: unknown;
        function runLegacyMutation<Output>(
            mutation: (commitUndo: CommitLegacyCommandUndo) => Promise<Output> | Output
        ): Promise<Output> {
            receivedMutation = mutation;
            return Promise.reject(failure);
        }

        const toggling = togglePunchRecordingUnderCommand(runLegacyMutation);

        await expect(toggling).rejects.toBe(failure);
        expect(receivedMutation).toBe(commitTogglePunchRecording);
    });
});
