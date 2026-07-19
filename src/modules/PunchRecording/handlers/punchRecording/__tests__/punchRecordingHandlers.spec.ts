import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ActionExecutionContext } from '#/utils/handlerContract';

import { handleTogglePunchRecording } from '../handleTogglePunchRecording';

const mocks = vi.hoisted(() => ({
    notifyUser: vi.fn(),
    togglePunchRecordingUnderCommand: vi.fn(),
}));

vi.mock('../../../useCases/punchRecording/togglePunchRecordingUnderCommand', () => ({
    togglePunchRecordingUnderCommand: mocks.togglePunchRecordingUnderCommand,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

describe('PunchRecording Handlers', () => {
    beforeEach(() => vi.clearAllMocks());

    const context: ActionExecutionContext = {
        executeAppAction: vi.fn(),
        runCommandTransition: vi.fn(),
        runLegacyCommandMutation: vi.fn(),
    };

    it('handleTogglePunchRecording delegates to use case and notifies after settlement', async () => {
        mocks.togglePunchRecordingUnderCommand.mockResolvedValueOnce(undefined);

        await handleTogglePunchRecording.execute({ type: 'togglePunchRecording', payload: undefined }, context);

        expect(mocks.togglePunchRecordingUnderCommand).toHaveBeenCalledWith(context.runLegacyCommandMutation);
        expect(mocks.notifyUser).toHaveBeenCalledWith('Punch recording toggled');
    });

    it('propagates a nested failure without reporting success', async () => {
        const failure = new Error('punch commit failed');
        mocks.togglePunchRecordingUnderCommand.mockRejectedValueOnce(failure);

        await expect(
            handleTogglePunchRecording.execute({ type: 'togglePunchRecording', payload: undefined }, context)
        ).rejects.toBe(failure);

        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });
});
