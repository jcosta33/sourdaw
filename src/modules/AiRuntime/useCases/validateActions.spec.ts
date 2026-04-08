import { describe, it, expect } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { validateActions } from './validateActions';
import { type Logger } from '#/helpers/Logger/Logger';
import { type AppAction } from '#/modules/Command/models/AppAction';

describe('validateActions', () => {
    it('should filter unknown action types and log a warning', () => {
        const logger = createMock<Logger>();
        injectDependencies(validateActions, { logger });

        const actions = [{ type: 'notARealAction' }] as unknown as AppAction[];
        const result = validateActions(actions);

        expect(result).toEqual([]);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Unknown action type'));
    });

    it('should reject invalid setTempo bpm', () => {
        const logger = createMock<Logger>();
        injectDependencies(validateActions, { logger });

        const actions = [{ type: 'setTempo', payload: { bpm: 5 } }] as unknown as AppAction[];
        expect(validateActions(actions)).toEqual([]);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid tempo'));
    });

    it('should keep valid actions', () => {
        const logger = createMock<Logger>();
        injectDependencies(validateActions, { logger });

        const valid = [{ type: 'setTempo', payload: { bpm: 120 } }] as unknown as AppAction[];
        expect(validateActions(valid)).toEqual(valid);
    });
});
