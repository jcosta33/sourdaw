import { beforeEach, describe, expect, it, vi } from 'vitest';

import { automergeRepository } from '../automergeRepository';
import { clearActionHistoryInActiveDocument } from '../clearActionHistoryInActiveDocument';

vi.mock('../automergeRepository', () => ({
    automergeRepository: {
        changeDoc: vi.fn(),
    },
}));

describe('clearActionHistoryInActiveDocument', () => {
    beforeEach(() => {
        vi.mocked(automergeRepository.changeDoc).mockReset();
    });

    it('should replace legacy executable history atomically in the active document', () => {
        const document = {
            actionHistory: {
                entries: [{ action: { type: 'setTempo' }, inverseAction: { type: 'setTempo' } }],
            },
        };
        vi.mocked(automergeRepository.changeDoc).mockImplementation((_id, change_fn) => {
            change_fn(document);
        });

        clearActionHistoryInActiveDocument();

        expect(document).toEqual({ actionHistory: { entries: [] } });
    });

    it('should propagate active-document mutation failure', () => {
        const failure = new Error('active document write failed');
        vi.mocked(automergeRepository.changeDoc).mockImplementation(() => {
            throw failure;
        });

        expect(() => clearActionHistoryInActiveDocument()).toThrow(failure);
    });
});
