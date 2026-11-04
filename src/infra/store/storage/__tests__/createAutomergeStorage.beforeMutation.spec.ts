import { change, from, getChangesMetaSince, getHeads, toJS } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    runWithAutomergeStorageTransaction,
} from '../createAutomergeStorage';

function seed() {
    return from({ state: { count: 0 }, peer: 0 });
}

describe('opt-in published-document validation before an atomic candidate', () => {
    let document = seed();
    let calls: string[] = [];
    let candidateCalls = 0;
    let injectPeer = false;
    let forwardHook = true;
    beforeEach(() => {
        document = seed();
        calls = [];
        candidateCalls = 0;
        injectPeer = false;
        forwardHook = true;
        configureAutomergeStoragePort({
            getDoc: () => document,
            hasDoc: () => true,
            getSemanticMessage: () => undefined,
            mutateDoc: ({ beforeChange, changeFn }) => {
                if (injectPeer) {
                    document = change(document, (candidate) => {
                        candidate.peer = 1;
                    });
                    calls.push('peer');
                }
                if (forwardHook) {
                    beforeChange?.(document);
                }
                document = change(document, (candidate) => {
                    candidateCalls += 1;
                    calls.push('candidate');
                    changeFn(candidate);
                });
            },
        });
    });
    afterEach(() => configureAutomergeStoragePort(null));
    function pending() {
        const storage = createAutomergeStorage<{ count: number }>('root', 'state');
        storage.hydrate?.();
        return runWithAutomergeStorageTransaction(undefined, () => storage.set({ count: 1 }));
    }

    it('certifies the actual late-peer frontier before candidate operations open', () => {
        const basis = getHeads(document);
        injectPeer = true;
        const transaction = pending();
        transaction.validateDocument(
            'root',
            (candidate) => {
                calls.push('prospective');
                expect(candidate.state).toEqual({ count: 1 });
                return null;
            },
            (published) => {
                calls.push('before');
                expect(published).toBe(document);
                expect(published.peer).toBe(1);
                expect(getChangesMetaSince(document, basis)).toHaveLength(1);
                expect(document.state.count).toBe(0);
                return null;
            }
        );
        transaction.commit();
        expect(calls).toEqual(['peer', 'before', 'candidate', 'prospective']);
        expect(document.state.count).toBe(1);
        expect(toJS(document).state.count).toBe(1);
    });

    it('refuses before any candidate write and preserves the actual peer', () => {
        injectPeer = true;
        const transaction = pending();
        transaction.validateDocument(
            'root',
            () => null,
            () => 'Controlled raw owner refusal'
        );
        expect(() => transaction.commit()).toThrow('Controlled raw owner refusal');
        transaction.abort();
        expect(candidateCalls).toBe(0);
        expect(document.state.count).toBe(0);
        expect(toJS(document)).toEqual({ state: { count: 0 }, peer: 1 });
    });

    it.each([false, true])('also validates a document with no coalesced write, refuse=%s', (refuse) => {
        const transaction = runWithAutomergeStorageTransaction(undefined, () => undefined);
        transaction.validateDocument(
            'root',
            () => {
                calls.push('prospective');
                return null;
            },
            () => {
                calls.push('before');
                return refuse ? 'Controlled empty-owner refusal' : null;
            }
        );
        if (refuse) {
            expect(() => transaction.commit()).toThrow('Controlled empty-owner refusal');
            transaction.abort();
            expect(calls).toEqual(['before']);
        } else {
            transaction.commit();
            expect(calls).toEqual(['before', 'prospective']);
        }
        expect(candidateCalls).toBe(0);
        expect(toJS(document)).toEqual({ state: { count: 0 }, peer: 0 });
    });

    it('fails closed when a port ignores the hook after the early certificate becomes stale', () => {
        forwardHook = false;
        injectPeer = true;
        const certificate = { document };
        const transaction = pending();
        transaction.validateCommit(() => {
            certificate.document = document;
            return null;
        });
        transaction.validateDocument(
            'root',
            () => (document === certificate.document ? null : 'Stale raw certificate'),
            (published) => {
                expect(published).toBe(document);
                certificate.document = document;
                return null;
            }
        );
        expect(() => transaction.commit()).toThrow('Stale raw certificate');
        transaction.abort();
        expect(toJS(document)).toEqual({ state: { count: 0 }, peer: 1 });
        expect(document.state.count).toBe(0);
    });

    it('keeps ports and handlers without an opt-in hook compatible', () => {
        forwardHook = false;
        const transaction = pending();
        transaction.validateDocument('root', () => null);
        transaction.commit();
        expect(document.state.count).toBe(1);
        expect(toJS(document).state.count).toBe(1);
    });
});
