import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeUserAppAction } from '#/modules/Command/useCases';

import { elasticCommands } from '../ElasticCommands';

vi.mock('#/modules/Command/useCases', () => ({ executeUserAppAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../selectionHelpers/getSelectedClipId', () => ({ getSelectedClipId: vi.fn() }));

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
        const { getSelectedClipId } = await import('../../selectionHelpers/getSelectedClipId');
        vi.mocked(getSelectedClipId).mockReturnValue('clip-1');
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

    it('elastic-quantize dispatches quantizeTransients for the selected clip', () => {
        runAction('elastic-quantize');

        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'quantizeTransients',
            payload: { clipId: 'clip-1' },
        });
    });

    it('dispatches nothing for any command when no clip is selected', async () => {
        const { getSelectedClipId } = await import('../../selectionHelpers/getSelectedClipId');
        vi.mocked(getSelectedClipId).mockReturnValue(null);

        runAction('elastic-detect-transients');
        runAction('elastic-open-editor');
        runAction('elastic-quantize');

        expect(executeUserAppAction).not.toHaveBeenCalled();
    });
});
