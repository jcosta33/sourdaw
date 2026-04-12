import { describe, it, expect, vi } from 'vitest';
import { type AppAction } from '#/modules/Command';
import { executeAppAction } from '../executeAppAction';
import { logger } from '#/infra/logger/appLogger';

vi.mock('#/infra/logger/appLogger', () => ({
    logger: {
        error: vi.fn(),
    },
}));

describe('executeAppAction', () => {
    it('should log error and return when no handler exists for action type', async () => {
        const action = { type: '__no_handler_registered__', payload: {} } as unknown as AppAction;

        await executeAppAction(action);

        expect(logger.error).toHaveBeenCalledWith(expect.any(Error));
    });
});
