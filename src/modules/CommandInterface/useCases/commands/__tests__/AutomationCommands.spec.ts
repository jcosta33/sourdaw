import { beforeEach, describe, expect, it, vi } from 'vitest';

import { automationStore } from '#/modules/Automation/stores';
import { executeUserAppAction } from '#/modules/Command/useCases';

import { automationCommands } from '../AutomationCommands';

vi.mock('#/modules/Command/useCases', () => ({ executeUserAppAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('#/modules/Automation/stores', () => ({
    automationStore: { value: { lanes: [{ id: 'lane-1' }] } },
}));

function runAction(id: string): void {
    const command = automationCommands.find((entry) => entry.id === id);
    if (!command || typeof command.action !== 'function') {
        throw new Error(`Expected a callable action for ${id}`);
    }
    command.action();
}

describe('automationCommands', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('exposes scale, invert, and thin automation commands under the Automation category', () => {
        expect(
            automationCommands.map((entry) => ({ id: entry.id, label: entry.label, category: entry.category }))
        ).toEqual([
            { id: 'scale-automation', label: 'Scale Automation', category: 'Automation' },
            { id: 'invert-automation', label: 'Invert Automation', category: 'Automation' },
            { id: 'thin-automation', label: 'Thin Automation Points', category: 'Automation' },
        ]);
    });

    it('scale-automation dispatches scaleAutomation for the first lane with a 1.2x factor', () => {
        runAction('scale-automation');

        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'scaleAutomation',
            payload: { laneId: 'lane-1', factor: 1.2 },
        });
    });

    it('invert-automation dispatches invertAutomation for the first lane', () => {
        runAction('invert-automation');

        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'invertAutomation',
            payload: { laneId: 'lane-1' },
        });
    });

    it('thin-automation dispatches thinAutomation for the first lane', () => {
        runAction('thin-automation');

        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'thinAutomation',
            payload: { laneId: 'lane-1' },
        });
    });

    it('dispatches nothing for any command when there is no automation lane to target', () => {
        const automationState = automationStore.value;
        if (!automationState) {
            throw new Error('Expected the mocked automation store to have a value');
        }
        const originalLanes = automationState.lanes;
        automationState.lanes = [];

        runAction('scale-automation');
        runAction('invert-automation');
        runAction('thin-automation');

        expect(executeUserAppAction).not.toHaveBeenCalled();

        automationState.lanes = originalLanes;
    });
});
