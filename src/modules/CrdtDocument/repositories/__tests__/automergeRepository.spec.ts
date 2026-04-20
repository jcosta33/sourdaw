import * as Automerge from '@automerge/automerge';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { automergeRepository } from '../automergeRepository';

vi.mock('@automerge/automerge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@automerge/automerge')>();
    return {
        ...actual,
        init: vi.fn(() => ({})),
        change: vi.fn((doc, _msg, cb) => {
            if (typeof _msg === 'function') {
                _msg(doc);
            } else if (cb) {
                cb(doc);
            }
            return { ...doc };
        }),
        getActorId: vi.fn(() => 'mock-actor'),
    };
});

// Mock Worker
vi.stubGlobal(
    'Worker',
    vi.fn(() => ({
        postMessage: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        terminate: vi.fn(),
    }))
);

describe('AutomergeRepository', () => {
    beforeEach(() => {
        automergeRepository.reset();
        vi.clearAllMocks();
    });

    it('should have a default rootId', () => {
        expect(automergeRepository.getRootId()).toBe('root');
    });

    it('should create a new project', () => {
        const rootId = automergeRepository.createProject('New Project');
        expect(rootId).toBe('root');
        expect(automergeRepository.hasDoc('root')).toBe(true);
        expect(Automerge.init).toHaveBeenCalled();
    });

    it('should create a child document', () => {
        const docId = automergeRepository.createChildDoc('child-1' as any);
        expect(docId).toBe('child-1');
        expect(automergeRepository.hasDoc('child-1' as any)).toBe(true);
    });

    it('should insert a document', () => {
        const mockDoc = { some: 'data' };
        automergeRepository.insertDoc('manual-1' as any, mockDoc as any);
        expect(automergeRepository.getDoc('manual-1' as any)).toBe(mockDoc);
    });

    it('should notify listeners on changeDoc', () => {
        automergeRepository.createProject('test');
        const listener = vi.fn();
        automergeRepository.onChange(listener);

        automergeRepository.changeDoc('root' as any, (doc: any) => {
            doc.foo = 'bar';
        });

        expect(listener).toHaveBeenCalled();
        expect(Automerge.change).toHaveBeenCalled();
    });

    it('should remove a document', () => {
        automergeRepository.createChildDoc('to-remove' as any);
        expect(automergeRepository.hasDoc('to-remove' as any)).toBe(true);

        automergeRepository.removeDoc('to-remove' as any);
        expect(automergeRepository.hasDoc('to-remove' as any)).toBe(false);
    });

    it('should reset state', () => {
        automergeRepository.createProject('test');
        automergeRepository.createChildDoc('child' as any);

        automergeRepository.reset();

        expect(automergeRepository.getDocIds()).toHaveLength(0);
        expect(automergeRepository.getRootId()).toBe('root');
    });
});
