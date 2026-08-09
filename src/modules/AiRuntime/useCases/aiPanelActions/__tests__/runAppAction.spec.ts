import { describe, it, expect, vi, beforeEach } from 'vitest';

import { runAppAction } from '../runAppAction';

const mocks = vi.hoisted(() => ({
    executeAppAction: vi.fn<typeof import('#/modules/Command/useCases').executeAppAction>(),
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
    executeAppAction: mocks.executeAppAction,
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: mocks.logger }));

describe('runAppAction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.executeAppAction.mockResolvedValue(undefined);
    });

    it('forwards the action to executeAppAction', () => {
        const action: Parameters<typeof runAppAction>[0] = { type: 'removeTrack', payload: { trackId: '123' } };
        void runAppAction(action);

        expect(mocks.executeAppAction).toHaveBeenCalledWith(action);
        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
    });

    it('awaits executeAppAction and resolves after it completes', async () => {
        mocks.executeAppAction.mockResolvedValueOnce(undefined);
        const action: Parameters<typeof runAppAction>[0] = { type: 'removeTrack', payload: { trackId: '456' } };

        const result = await runAppAction(action);
        expect(result).toBeUndefined();
        expect(mocks.executeAppAction).toHaveBeenCalledWith(action);
    });

    it.each(['setPunchIn', 'setPunchOut'] as const)(
        'rejects malformed %s payloads before handler execution or state effects',
        async (actionType) => {
            let transport_write_count = 0;
            mocks.executeAppAction.mockImplementation(() => {
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

            expect(mocks.executeAppAction).not.toHaveBeenCalled();
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

            expect(mocks.executeAppAction).not.toHaveBeenCalled();
            expect(mocks.logger.warn).toHaveBeenCalledOnce();
        }
    );
});
