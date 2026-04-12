import { describe, it, expect } from 'vitest';
import { AUTOMATION_SUB_LANE_HEIGHT } from '../automationConstants';

describe('automationConstants', () => {
    it('defines AUTOMATION_SUB_LANE_HEIGHT as 40', () => {
        expect(AUTOMATION_SUB_LANE_HEIGHT).toBe(40);
    });
});
