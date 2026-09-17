import { describe, it, expect, vi } from 'vitest';

import { startMainThreadLongTaskObserver } from '../../repositories/engineDiagnostics/observeMainThreadLongTasks';
import { startMainThreadLongTaskObservation } from '../startMainThreadLongTaskObservation';

vi.mock('../../repositories/engineDiagnostics/observeMainThreadLongTasks', () => ({
    startMainThreadLongTaskObserver: vi.fn(() => () => {}),
}));

describe('startMainThreadLongTaskObservation', () => {
    it('should register the main-thread long-task observer exactly once', () => {
        startMainThreadLongTaskObservation();

        expect(startMainThreadLongTaskObserver).toHaveBeenCalledTimes(1);
    });
});
