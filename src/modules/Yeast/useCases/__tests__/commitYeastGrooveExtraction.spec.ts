import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    getGrooveExtractionActionErrorCode: vi.fn(),
}));

import { executeAppAction } from '#/modules/Command/useCases';
import { getGrooveExtractionActionErrorCode } from '#/modules/MIDI/useCases';

import { commitYeastGrooveExtraction } from '../commitYeastGrooveExtraction';

const mockedExecute = vi.mocked(executeAppAction);
const mockedGetErrorCode = vi.mocked(getGrooveExtractionActionErrorCode);

const baseInput = {
    clipId: 'c1',
    sourceName: 'Source',
    subdivision: '1/16',
    templateId: 'g1',
    proposal: { id: 'g1', name: 'Test', subdivision: '1/16', slots: [] } as never,
    sourceRevision: 'rev1',
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('commitYeastGrooveExtraction — success', () => {
    it('returns committed status on successful executeAppAction', async () => {
        mockedExecute.mockResolvedValue(undefined);
        const result = await commitYeastGrooveExtraction(baseInput);
        expect(result).toEqual({ status: 'committed' });
        expect(mockedExecute).toHaveBeenCalledWith({
            type: 'extractGroove',
            payload: {
                clipId: 'c1',
                sourceName: 'Source',
                subdivision: '1/16',
                templateId: 'g1',
                proposal: expect.anything(),
                sourceRevision: 'rev1',
            },
        });
    });
});

describe('commitYeastGrooveExtraction — rejection', () => {
    it('returns rejected status with reason on known error code', async () => {
        mockedExecute.mockRejectedValue(new Error('empty-source'));
        mockedGetErrorCode.mockReturnValue('empty-source');
        const result = await commitYeastGrooveExtraction(baseInput);
        expect(result).toEqual({ status: 'rejected', reason: 'empty-source' });
    });

    it('rethrows unknown errors without a recognized code', async () => {
        const error = new Error('unexpected');
        mockedExecute.mockRejectedValue(error);
        mockedGetErrorCode.mockReturnValue(null);
        await expect(commitYeastGrooveExtraction(baseInput)).rejects.toThrow('unexpected');
    });
});
