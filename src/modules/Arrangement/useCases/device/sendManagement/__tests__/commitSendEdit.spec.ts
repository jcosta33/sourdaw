import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commitSendEdit } from '../commitSendEdit';
import { restoreSendEngineFromProjectTruth } from '../restoreSendEngineFromProjectTruth';

const mocks = vi.hoisted(() => ({
    executeAppAction: vi.fn(),
    getTrackById: vi.fn(),
    engineRemoveSend: vi.fn(),
    engineSetSend: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
}));
vi.mock('../../../../repositories/track/getTrackById', () => ({
    getTrackById: mocks.getTrackById,
}));
vi.mock('#/modules/Routing/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/useCases')>()),
    removeSend: mocks.engineRemoveSend,
    setSend: mocks.engineSetSend,
}));
vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const setSendAction = {
    type: 'setSend',
    payload: { trackId: 'track-1', busId: 'bus-1', level: 0.25, expectedLevel: 0.5, expectedPreFader: true },
} as const;

beforeEach(() => {
    vi.clearAllMocks();
});

describe('restoreSendEngineFromProjectTruth', () => {
    it('puts an existing send back to its committed level and tap point', () => {
        mocks.getTrackById.mockReturnValue({ sends: [{ busId: 'bus-1', level: 0.5, preFader: true }] });

        restoreSendEngineFromProjectTruth('track-1', 'bus-1');

        expect(mocks.engineSetSend).toHaveBeenCalledWith('track-1', 'bus-1', 0.5, true);
        expect(mocks.engineRemoveSend).not.toHaveBeenCalled();
    });

    it('removes a previewed send the project does not hold', () => {
        mocks.getTrackById.mockReturnValue({ sends: [] });

        restoreSendEngineFromProjectTruth('track-1', 'bus-1');

        expect(mocks.engineRemoveSend).toHaveBeenCalledWith('track-1', 'bus-1');
        expect(mocks.engineSetSend).not.toHaveBeenCalled();
    });
});

describe('commitSendEdit', () => {
    it('dispatches the gesture action and leaves the engine alone when it commits', async () => {
        mocks.executeAppAction.mockResolvedValue(undefined);

        await commitSendEdit(setSendAction);

        expect(mocks.executeAppAction).toHaveBeenCalledWith(setSendAction);
        expect(mocks.engineSetSend).not.toHaveBeenCalled();
        expect(mocks.engineRemoveSend).not.toHaveBeenCalled();
    });

    it('restores the engine from project truth when the commit is refused', async () => {
        mocks.executeAppAction.mockRejectedValue(new Error('conflict'));
        mocks.getTrackById.mockReturnValue({ sends: [{ busId: 'bus-1', level: 0.5, preFader: true }] });

        await commitSendEdit(setSendAction);

        expect(mocks.engineSetSend).toHaveBeenCalledWith('track-1', 'bus-1', 0.5, true);
    });

    it('removes the previewed send when a first send to the bus is refused', async () => {
        mocks.executeAppAction.mockRejectedValue(new Error('conflict'));
        mocks.getTrackById.mockReturnValue({ sends: [] });

        await commitSendEdit({ type: 'addSend', payload: { trackId: 'track-1', busId: 'bus-1', level: 0.25 } });

        expect(mocks.engineRemoveSend).toHaveBeenCalledWith('track-1', 'bus-1');
    });
});
