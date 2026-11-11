import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commitSendEdit } from '../commitSendEdit';
import { commitSendLevel } from '../commitSendLevel';
import { restoreSendEngineFromProjectTruth } from '../restoreSendEngineFromProjectTruth';

const mocks = vi.hoisted(() => ({
    executeAppAction: vi.fn(),
    getTrackById: vi.fn(),
    engineRemoveSend: vi.fn(),
    engineSetSend: vi.fn(),
}));

// The real Routing barrel below reaches modules that import the other names, so
// the factory names them; none is called by the code under test.
vi.mock('#/modules/Command/useCases', () => ({
    commitUndoEntry: vi.fn(),
    createUndoEntry: vi.fn(),
    executeAppAction: mocks.executeAppAction,
    executeUserAppAction: vi.fn(),
    getExecutableAppActionEffect: vi.fn(),
    pushUndoEntry: vi.fn(),
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

describe('commitSendLevel', () => {
    const projectSends: { current: { busId: string; level: number; preFader: boolean }[] } = { current: [] };

    beforeEach(() => {
        projectSends.current = [{ busId: 'bus-1', level: 0.2, preFader: false }];
        mocks.getTrackById.mockImplementation(() => ({ sends: projectSends.current }));
    });

    it('applies a second step only after the first lands, guarded on the level the first wrote', async () => {
        let landFirst: () => void = () => undefined;
        mocks.executeAppAction
            .mockImplementationOnce(
                () =>
                    new Promise<void>((resolve) => {
                        landFirst = () => {
                            projectSends.current = [{ busId: 'bus-1', level: 0.3, preFader: false }];
                            resolve();
                        };
                    })
            )
            .mockResolvedValueOnce(undefined);

        const first = commitSendLevel('track-1', 'bus-1', 0.3);
        const second = commitSendLevel('track-1', 'bus-1', 0.4);
        await vi.waitFor(() => expect(mocks.executeAppAction).toHaveBeenCalledOnce());
        landFirst();
        await Promise.all([first, second]);

        expect(mocks.executeAppAction.mock.calls.map(([action]) => action)).toEqual([
            {
                type: 'setSend',
                payload: {
                    trackId: 'track-1',
                    busId: 'bus-1',
                    level: 0.3,
                    expectedLevel: 0.2,
                    expectedPreFader: false,
                },
            },
            {
                type: 'setSend',
                payload: {
                    trackId: 'track-1',
                    busId: 'bus-1',
                    level: 0.4,
                    expectedLevel: 0.3,
                    expectedPreFader: false,
                },
            },
        ]);
    });

    it('moves a send the first step created instead of adding it twice', async () => {
        projectSends.current = [];
        mocks.executeAppAction.mockImplementationOnce(async () => {
            await Promise.resolve();
            projectSends.current = [{ busId: 'bus-1', level: 0.3, preFader: false }];
        });
        mocks.executeAppAction.mockResolvedValueOnce(undefined);

        await Promise.all([commitSendLevel('track-1', 'bus-1', 0.3), commitSendLevel('track-1', 'bus-1', 0.4)]);

        expect(mocks.executeAppAction.mock.calls.map(([action]) => action.type)).toEqual(['addSend', 'setSend']);
    });

    it('writes nothing for a level the send already holds, and puts the engine back on it', async () => {
        await commitSendLevel('track-1', 'bus-1', 0.2);

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.engineSetSend).toHaveBeenCalledWith('track-1', 'bus-1', 0.2, false);
    });

    it('writes nothing for silence to a bus the track does not send to, and drops the previewed send', async () => {
        projectSends.current = [];

        await commitSendLevel('track-1', 'bus-1', 0);

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.engineRemoveSend).toHaveBeenCalledWith('track-1', 'bus-1');
    });

    it.each([
        ['moves an existing send to silence', [{ busId: 'bus-1', level: 0.2, preFader: false }], 0, 'setSend'],
        ['adds a first send at an audible level', [], 0.2, 'addSend'],
    ])('still %s', async (_case, sends, level, type) => {
        projectSends.current = sends;
        mocks.executeAppAction.mockResolvedValue(undefined);

        await commitSendLevel('track-1', 'bus-1', level);

        expect(mocks.executeAppAction).toHaveBeenCalledOnce();
        expect(mocks.executeAppAction.mock.lastCall![0]).toMatchObject({ type, payload: { level } });
    });

    it('judges a queued step against the level the step before it wrote', async () => {
        mocks.executeAppAction.mockImplementationOnce(async () => {
            await Promise.resolve();
            projectSends.current = [{ busId: 'bus-1', level: 0.3, preFader: false }];
        });
        mocks.executeAppAction.mockResolvedValueOnce(undefined);

        // The second step returns to the level the project held when both were taken.
        await Promise.all([commitSendLevel('track-1', 'bus-1', 0.3), commitSendLevel('track-1', 'bus-1', 0.2)]);

        expect(mocks.executeAppAction).toHaveBeenCalledTimes(2);
        expect(mocks.executeAppAction.mock.lastCall![0]).toMatchObject({
            type: 'setSend',
            payload: { level: 0.2, expectedLevel: 0.3 },
        });
    });

    it('still applies a later step when an earlier one is refused', async () => {
        mocks.executeAppAction.mockRejectedValueOnce(new Error('conflict')).mockResolvedValueOnce(undefined);

        await Promise.all([commitSendLevel('track-1', 'bus-1', 0.3), commitSendLevel('track-1', 'bus-1', 0.4)]);

        expect(mocks.executeAppAction).toHaveBeenCalledTimes(2);
        expect(mocks.executeAppAction.mock.lastCall![0]).toMatchObject({
            type: 'setSend',
            payload: { level: 0.4, expectedLevel: 0.2 },
        });
    });
});
