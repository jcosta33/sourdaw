import { type Doc, change, init, save } from '@automerge/automerge';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { detectImportDecision } from '../detectImportDecision';

type TestDoc = {
    base?: boolean;
    local?: boolean;
    remote?: boolean;
};

const mocks = vi.hoisted(() => ({
    getDoc: vi.fn(),
}));

vi.mock('../../../repositories/automergeRepository', () => ({
    automergeRepository: {
        getDoc: mocks.getDoc,
    },
}));

function makeBaseDoc(): Doc<TestDoc> {
    return change(init<TestDoc>(), (draft) => {
        draft.base = true;
    });
}

function makeLocalDoc(): Doc<TestDoc> {
    return change(init<TestDoc>(), (draft) => {
        draft.local = true;
    });
}

function makeRemoteDocFrom(baseDoc: Doc<TestDoc>): Doc<TestDoc> {
    return change(baseDoc, (draft) => {
        draft.remote = true;
    });
}

describe('detectImportDecision', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns separate when the incoming bundle has no root document', () => {
        const bundle = new Map<string, Uint8Array>([['child', save(makeLocalDoc())]]);

        expect(detectImportDecision(bundle)).toBe('separate');
        expect(mocks.getDoc).not.toHaveBeenCalled();
    });

    it('returns separate when the local root document is missing', () => {
        const bundle = new Map<string, Uint8Array>([['root', save(makeLocalDoc())]]);
        mocks.getDoc.mockReturnValue(undefined);

        expect(detectImportDecision(bundle)).toBe('separate');
        expect(mocks.getDoc).toHaveBeenCalledWith('root');
    });

    it('returns merge when incoming and local roots share Automerge history', () => {
        const baseDoc = makeBaseDoc();
        const remoteDoc = makeRemoteDocFrom(baseDoc);
        const bundle = new Map<string, Uint8Array>([['root', save(remoteDoc)]]);
        mocks.getDoc.mockReturnValue(baseDoc);

        expect(detectImportDecision(bundle)).toBe('merge');
    });

    it('returns separate when incoming and local roots have unrelated histories', () => {
        const bundle = new Map<string, Uint8Array>([['root', save(makeRemoteDocFrom(makeBaseDoc()))]]);
        mocks.getDoc.mockReturnValue(makeLocalDoc());

        expect(detectImportDecision(bundle)).toBe('separate');
    });

    it('returns separate when the incoming root bytes cannot be decoded', () => {
        const bundle = new Map<string, Uint8Array>([['root', new Uint8Array([1, 2, 3])]]);
        mocks.getDoc.mockReturnValue(makeLocalDoc());

        expect(detectImportDecision(bundle)).toBe('separate');
    });
});
