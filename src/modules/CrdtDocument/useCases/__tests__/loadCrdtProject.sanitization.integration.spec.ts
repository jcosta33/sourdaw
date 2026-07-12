import { change, init, save } from '@automerge/automerge';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { automergeRepository } from '../../repositories/automergeRepository';
import { loadCrdtProject } from '../loadCrdtProject';

const mocks = vi.hoisted(() => ({
    loadAllFromIdb: vi.fn(),
}));

vi.mock('../../repositories/crdtPersistence/loadAllFromIdb', () => ({
    loadAllFromIdb: mocks.loadAllFromIdb,
}));

vi.stubGlobal(
    'Worker',
    vi.fn(() => {
        throw new Error('no worker in test');
    })
);

type PersistedRootDocument = {
    project: string;
    actionHistory?: {
        entries: Array<{
            id: string;
            action: { type: string };
            inverseAction: { type: string };
        }>;
    };
};

function create_persisted_bundle(): Map<string, Uint8Array> {
    let document = init<PersistedRootDocument>();
    document = change(document, (draft) => {
        draft.project = 'B';
        draft.actionHistory = {
            entries: [
                {
                    id: 'legacy-entry',
                    action: { type: 'setTempo' },
                    inverseAction: { type: 'setTempo' },
                },
            ],
        };
    });
    return new Map([['root', save(document)]]);
}

describe('loadCrdtProject persisted action-history sanitization', () => {
    beforeEach(() => {
        automergeRepository.reset();
        automergeRepository.createProject('A');
        automergeRepository.changeDoc<PersistedRootDocument>('root', (document) => {
            document.project = 'A';
        });
    });

    it('should expose only a sanitized target document on the first repository notification', async () => {
        mocks.loadAllFromIdb.mockResolvedValue(create_persisted_bundle());
        const observed_documents: Array<{ project: string; actionHistory?: unknown }> = [];
        automergeRepository.onChange(() => {
            const document = automergeRepository.getDoc<PersistedRootDocument>('root');
            if (document) {
                observed_documents.push({ project: document.project, actionHistory: document.actionHistory });
            }
        });

        const result = await loadCrdtProject({ canActivate: () => true });

        expect(result).toBe('loaded');
        expect(observed_documents).toEqual([{ project: 'B', actionHistory: undefined }]);
    });

    it('should leave the active repository and listeners untouched when sanitization fails', async () => {
        mocks.loadAllFromIdb.mockResolvedValue(new Map([['root', new Uint8Array([1, 2, 3])]]));
        const listener = vi.fn();
        automergeRepository.onChange(listener);

        const result = await loadCrdtProject({ canActivate: () => true });

        expect(result).toBe('sanitization-failed');
        expect(automergeRepository.getDoc<PersistedRootDocument>('root')?.project).toBe('A');
        expect(listener).not.toHaveBeenCalled();
    });
});
