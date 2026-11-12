import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTimelineEditingState, timelineEditingStore } from '#/modules/Arrangement/stores';
import { executeUserAppAction } from '#/modules/Command/useCases';

import { elasticCommands } from '../ElasticCommands';

vi.mock('#/modules/Command/useCases', () => ({ executeUserAppAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../selectionHelpers/getSelectedClipId', () => ({ getSelectedClipId: vi.fn(() => 'clip-1') }));
vi.mock('../../selectionHelpers/getSelectedClipIdOfType', () => ({ getSelectedClipIdOfType: vi.fn() }));

function runAction(id: string): void {
    const command = elasticCommands.find((entry) => entry.id === id);
    if (!command || typeof command.action !== 'function') {
        throw new Error(`Expected a callable action for ${id}`);
    }
    command.action();
}

describe('elasticCommands', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        const { getSelectedClipIdOfType } = await import('../../selectionHelpers/getSelectedClipIdOfType');
        vi.mocked(getSelectedClipIdOfType).mockReturnValue('clip-1');
    });

    it('exposes detect-transients, open-editor, and quantize commands under the Editing category', () => {
        expect(
            elasticCommands.map((entry) => ({ id: entry.id, label: entry.label, category: entry.category }))
        ).toEqual([
            {
                id: 'elastic-detect-transients',
                label: 'Elastic: Detect Transients',
                category: 'Editing',
            },
            {
                id: 'elastic-open-editor',
                label: 'Elastic: Open Editor for Selected Clip',
                category: 'Editing',
            },
            {
                id: 'elastic-quantize',
                label: 'Elastic: Quantize Selected Clip',
                category: 'Editing',
            },
        ]);
    });

    it('elastic-detect-transients dispatches detectTransients for the selected clip', () => {
        runAction('elastic-detect-transients');

        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'detectTransients',
            payload: { clipId: 'clip-1' },
        });
    });

    it('elastic-open-editor dispatches openElasticEditor for the selected clip', () => {
        runAction('elastic-open-editor');

        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'openElasticEditor',
            payload: { clipId: 'clip-1' },
        });
    });

    it('elastic-quantize dispatches quantizeTransients for the selected clip on the snap grid', () => {
        timelineEditingStore.set({ ...defaultTimelineEditingState, snapValue: 0.25 });

        runAction('elastic-quantize');

        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'quantizeTransients',
            payload: { clipId: 'clip-1', gridSize: 0.25 },
        });
    });

    it('dispatches nothing for any command when no clip is selected', async () => {
        const { getSelectedClipIdOfType } = await import('../../selectionHelpers/getSelectedClipIdOfType');
        vi.mocked(getSelectedClipIdOfType).mockReturnValue(null);

        runAction('elastic-detect-transients');
        runAction('elastic-open-editor');
        runAction('elastic-quantize');

        expect(executeUserAppAction).not.toHaveBeenCalled();
    });

    it('blocks every Elastic command when the selected clip is MIDI', async () => {
        const { getSelectedClipIdOfType } = await import('../../selectionHelpers/getSelectedClipIdOfType');
        vi.mocked(getSelectedClipIdOfType).mockImplementation((type) => (type === 'midi' ? 'clip-1' : null));

        for (const command of elasticCommands) {
            expect(command.getInapplicabilityReason?.()).toBe('Select an audio clip first.');
            runAction(command.id);
        }

        expect(executeUserAppAction).not.toHaveBeenCalled();
    });
});
