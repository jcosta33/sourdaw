import { describe, expect, it, vi } from 'vitest';

import { setTimeOperationDependencies, timeOperationDependencies } from '../timeOperationDependencies';

function createDependencies() {
    return {
        savedRestorePlanValidators: { automation: () => true, midi: () => true, timelineMap: () => true },
        prepareAutomationTimeOperation: vi.fn(),
        prepareAutomationTimeStateRestore: vi.fn(),
        prepareMidiGlobalTimeTransaction: vi.fn(),
        prepareMidiTimeStateRestore: vi.fn(),
        prepareTimelineMapTimeOperation: vi.fn(),
        prepareTimelineMapStateRestore: vi.fn(),
    };
}

describe('timeOperationDependencies', () => {
    it('refuses to read before registration and names the registrar', () => {
        expect(() => timeOperationDependencies.read('probe')).toThrow(
            /probe: .*call setTimeOperationDependencies\(\) from #\/app\/bootstrap/
        );
    });

    it('returns what was filled and lets a second fill replace it', () => {
        const first = createDependencies();
        const second = createDependencies();

        setTimeOperationDependencies(first);
        expect(timeOperationDependencies.read('probe')).toBe(first);

        setTimeOperationDependencies(second);
        expect(timeOperationDependencies.read('probe')).toBe(second);
    });
});
