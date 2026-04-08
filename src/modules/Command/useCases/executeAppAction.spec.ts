import { describe, it, expect } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { executeAppAction } from './executeAppAction';
import { type Logger } from '#/helpers/Logger/Logger';
import { type AppAction } from '#/modules/Command/models/AppAction';

describe('executeAppAction', () => {
    it('should log error and return when no handler exists for action type', async () => {
        const logger = createMock<Logger>();
        injectDependencies(executeAppAction, { logger });

        const action = { type: '__no_handler_registered__', payload: {} } as unknown as AppAction;

        await executeAppAction(action);

        expect(logger.error).toHaveBeenCalledWith(expect.any(Error));
    });
});
