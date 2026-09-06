import { describe, it, expect, vi, beforeEach } from 'vitest';

import { runAppAction } from '../runAppAction';

const mocks = vi.hoisted(() => ({
    executeUserAppAction: vi.fn<typeof import('#/modules/Command/useCases').executeUserAppAction>(),
    logger: {
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

type RunAppActionInput = Parameters<typeof runAppAction>[0];

function create_malformed_punch_action(type: 'setPunchIn' | 'setPunchOut', payload: unknown): RunAppActionInput {
    const action: RunAppActionInput =
        type === 'setPunchIn'
            ? { type: 'setPunchIn', payload: { beat: 0 } }
            : { type: 'setPunchOut', payload: { beat: 0 } };
    Reflect.set(action, 'payload', payload);
    return action;
}

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn(),
    executeAppActionBatch: vi.fn(),
    executeUserAppAction: mocks.executeUserAppAction,
    REDO_NOT_APPLIED: Symbol('REDO_NOT_APPLIED'),
    isAppActionCommittedError: vi.fn(() => false),
    pushUndoEntry: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
    syncActionReplayMetadata: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: mocks.logger }));

describe('runAppAction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.executeUserAppAction.mockResolvedValue(undefined);
    });

    it('forwards the action to executeUserAppAction', () => {
        const action: Parameters<typeof runAppAction>[0] = { type: 'removeTrack', payload: { trackId: '123' } };
        void runAppAction(action);

        expect(mocks.executeUserAppAction).toHaveBeenCalledWith(action);
        expect(mocks.executeUserAppAction).toHaveBeenCalledTimes(1);
    });

    it('awaits executeUserAppAction and resolves after it completes', async () => {
        mocks.executeUserAppAction.mockResolvedValueOnce(undefined);
        const action: Parameters<typeof runAppAction>[0] = { type: 'removeTrack', payload: { trackId: '456' } };

        const result = await runAppAction(action);
        expect(result).toBeUndefined();
        expect(mocks.executeUserAppAction).toHaveBeenCalledWith(action);
    });

    it.each(['setPunchIn', 'setPunchOut'] as const)(
        'rejects malformed %s payloads before handler execution or state effects',
        async (actionType) => {
            let transport_write_count = 0;
            mocks.executeUserAppAction.mockImplementation(() => {
                transport_write_count += 1;
                return Promise.resolve();
            });

            for (const payload of [
                '4',
                undefined,
                null,
                {},
                { beat: '4' },
                { beat: null },
                { beat: Number.NaN },
                { beat: Number.POSITIVE_INFINITY },
                { beat: Number.NEGATIVE_INFINITY },
                { beat: 4, extra: true },
            ]) {
                await runAppAction(create_malformed_punch_action(actionType, payload));
            }

            expect(mocks.executeUserAppAction).not.toHaveBeenCalled();
            expect(transport_write_count).toBe(0);
            expect(mocks.logger.warn).toHaveBeenCalledTimes(10);
        }
    );

    it.each(['setPunchIn', 'setPunchOut'] as const)(
        'rejects negative %s beats before owner normalization',
        async (actionType) => {
            const action: RunAppActionInput =
                actionType === 'setPunchIn'
                    ? { type: 'setPunchIn', payload: { beat: -4 } }
                    : { type: 'setPunchOut', payload: { beat: -4 } };

            await runAppAction(action);

            expect(mocks.executeUserAppAction).not.toHaveBeenCalled();
            expect(mocks.logger.warn).toHaveBeenCalledOnce();
        }
    );
});
