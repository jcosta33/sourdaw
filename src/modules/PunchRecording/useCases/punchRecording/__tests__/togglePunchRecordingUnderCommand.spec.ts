import { describe, expect, it } from 'vitest';

import { type CommitLegacyCommandUndo } from '#/utils/handlerContract';

import { commitTogglePunchRecording } from '../commitTogglePunchRecording';
import { togglePunchRecordingUnderCommand } from '../togglePunchRecordingUnderCommand';

describe('togglePunchRecordingUnderCommand', () => {
    it('returns the owning runner promise so failure stays attached to the outer command', async () => {
        const failure = new Error('punch commit failed');
        let received_mutation: unknown;
        function run_legacy_mutation<Output>(
            mutation: (commitUndo: CommitLegacyCommandUndo) => Promise<Output> | Output
        ): Promise<Output> {
            received_mutation = mutation;
            return Promise.reject(failure);
        }

        const toggling = togglePunchRecordingUnderCommand(run_legacy_mutation);

        await expect(toggling).rejects.toBe(failure);
        expect(received_mutation).toBe(commitTogglePunchRecording);
    });
});
