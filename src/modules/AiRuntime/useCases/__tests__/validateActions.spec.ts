import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateActions } from '../validateActions';
import { type RuntimeAction } from '../../models/RuntimeAction';

const { mockLogger } = vi.hoisted(() => ({
    mockLogger: {
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: mockLogger,
}));

describe('validateActions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should filter unknown action types and log a warning', () => {
        const actions = [{ type: 'notARealAction' }] as unknown as RuntimeAction[];
        const result = validateActions(actions);

        expect(result).toEqual([]);
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Unknown action type'));
    });

    it('should reject invalid setTempo bpm', () => {
        const actions = [{ type: 'setTempo', payload: { bpm: 5 } }] as unknown as RuntimeAction[];
        expect(validateActions(actions)).toEqual([]);
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid tempo'));
    });

    it('should keep valid actions', () => {
        const valid = [{ type: 'setTempo', payload: { bpm: 120 } }] as unknown as RuntimeAction[];
        expect(validateActions(valid)).toEqual(valid);
    });
});
