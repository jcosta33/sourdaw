import { change, clone, init, save, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DOC_BRANCHES } from '../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../repositories/automergeRepository';
import { captureProjectIdentity } from '../captureProjectIdentity';
import { captureProjectRootIdentity } from '../captureProjectRootIdentity';

const automergeInitFault = vi.hoisted(() => ({ throwNext: false }));

vi.mock('@automerge/automerge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@automerge/automerge')>();
    return {
        ...actual,
        init: (actor?: string) => {
            if (automergeInitFault.throwNext) {
                automergeInitFault.throwNext = false;
                throw new Error('forced Automerge init failure');
            }
            return actual.init(actor);
        },
    };
});

class UnavailableWorker {
    constructor() {
        throw new Error('worker unavailable in synchronous repository test');
    }
}

vi.stubGlobal('Worker', UnavailableWorker);

function createDocument(actor: string, values: Record<string, unknown>): Doc<Record<string, unknown>> {
    return change(init<Record<string, unknown>>(actor), (document) => {
        Object.assign(document, values);
    });
}

function captureEpoch(): number {
    const parsed: unknown = JSON.parse(captureProjectRootIdentity());
    if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('rootIdentityEpoch' in parsed) ||
        typeof parsed.rootIdentityEpoch !== 'number'
    ) {
        throw new Error('Expected a serialized root identity epoch');
    }
    return parsed.rootIdentityEpoch;
}

function expectRootIdentityToMove(previous: string): string {
    const current = captureProjectRootIdentity();
    expect(current).not.toBe(previous);
    return current;
}

describe('captureProjectRootIdentity', () => {
    beforeEach(() => {
        automergeInitFault.throwNext = false;
        automergeRepository.reset();
        automergeRepository.createProject('root identity');
    });

    afterEach(() => {
        automergeRepository.reset();
    });

    it('survives ancillary document membership changes while the project-wide identity moves', () => {
        const rootIdentity = captureProjectRootIdentity();
        let projectIdentity = captureProjectIdentity();

        automergeRepository.createChildDoc('branch_preview');
        expect(captureProjectRootIdentity()).toBe(rootIdentity);
        expect(captureProjectIdentity()).not.toBe(projectIdentity);

        projectIdentity = captureProjectIdentity();
        automergeRepository.insertDoc(DOC_BRANCHES, createDocument('aaaaaaaaaaaaaaaa', { branch: true }));
        expect(captureProjectRootIdentity()).toBe(rootIdentity);
        expect(captureProjectIdentity()).not.toBe(projectIdentity);

        projectIdentity = captureProjectIdentity();
        automergeRepository.replaceDoc(DOC_BRANCHES, createDocument('bbbbbbbbbbbbbbbb', { branch: 'next' }));
        expect(captureProjectRootIdentity()).toBe(rootIdentity);
        expect(captureProjectIdentity()).not.toBe(projectIdentity);

        projectIdentity = captureProjectIdentity();
        automergeRepository.mergeRemoteDoc('branch_remote', save(createDocument('cccccccccccccccc', { remote: true })));
        expect(captureProjectRootIdentity()).toBe(rootIdentity);
        expect(captureProjectIdentity()).not.toBe(projectIdentity);

        projectIdentity = captureProjectIdentity();
        automergeRepository.removeDoc('branch_remote');
        expect(captureProjectRootIdentity()).toBe(rootIdentity);
        expect(captureProjectIdentity()).not.toBe(projectIdentity);

        const identityBeforeMissingRemoval = captureProjectIdentity();
        automergeRepository.removeDoc('missing');
        expect(captureProjectRootIdentity()).toBe(rootIdentity);
        expect(captureProjectIdentity()).toBe(identityBeforeMissingRemoval);
    });

    it('moves monotonically for every direct active-root installation route', () => {
        let previous = captureProjectRootIdentity();
        let previousEpoch = captureEpoch();
        const expectMonotonicMove = (): void => {
            previous = expectRootIdentityToMove(previous);
            expect(captureEpoch()).toBeGreaterThan(previousEpoch);
            previousEpoch = captureEpoch();
        };

        automergeRepository.createProject('same durable id');
        expectMonotonicMove();
        automergeRepository.createChildDoc('root');
        expectMonotonicMove();
        automergeRepository.insertDoc('root', createDocument('dddddddddddddddd', { installed: 'insert' }));
        expectMonotonicMove();
        automergeRepository.replaceDoc('root', createDocument('eeeeeeeeeeeeeeee', { installed: 'replace' }));
        expectMonotonicMove();
        automergeRepository.reset();
        expectMonotonicMove();
        automergeRepository.createProject('after reset');
        expectMonotonicMove();
        automergeRepository.removeDoc('root');
        expectMonotonicMove();
        automergeRepository.mergeRemoteDoc('root', save(createDocument('ffffffffffffffff', { installed: 'remote' })));
        expectMonotonicMove();
    });

    it('invalidates root identity when replacement initialization fails after clearing the installed root', () => {
        const rootIdentity = captureProjectRootIdentity();
        const projectIdentity = captureProjectIdentity();
        const mutationEpoch = automergeRepository.getMutationEpoch();
        expect(automergeRepository.hasDoc('root')).toBe(true);
        automergeInitFault.throwNext = true;

        expect(() => automergeRepository.createProject('replacement')).toThrow('forced Automerge init failure');

        expect(automergeRepository.hasDoc('root')).toBe(false);
        expect(captureProjectRootIdentity()).not.toBe(rootIdentity);
        expect(captureProjectIdentity()).toBe(projectIdentity);
        expect(automergeRepository.getMutationEpoch()).toBe(mutationEpoch);
    });

    it('preserves every identity when initialization fails without an installed root to remove', () => {
        automergeRepository.removeDoc('root');
        const rootIdentity = captureProjectRootIdentity();
        const projectIdentity = captureProjectIdentity();
        const mutationEpoch = automergeRepository.getMutationEpoch();
        automergeInitFault.throwNext = true;

        expect(() => automergeRepository.createProject('replacement')).toThrow('forced Automerge init failure');

        expect(automergeRepository.hasDoc('root')).toBe(false);
        expect(captureProjectRootIdentity()).toBe(rootIdentity);
        expect(captureProjectIdentity()).toBe(projectIdentity);
        expect(automergeRepository.getMutationEpoch()).toBe(mutationEpoch);
    });

    it('advances root identity exactly once for successful creation with or without an installed root', () => {
        let rootEpoch = captureEpoch();

        automergeRepository.createProject('replace installed root');
        expect(captureEpoch()).toBe(rootEpoch + 1);

        automergeRepository.removeDoc('root');
        rootEpoch = captureEpoch();
        automergeRepository.createProject('install absent root');
        expect(captureEpoch()).toBe(rootEpoch + 1);
    });

    it('preserves the installed-root identity for ordinary root content and lineage merges', () => {
        const rootIdentity = captureProjectRootIdentity();

        automergeRepository.changeDoc('root', (document: Record<string, unknown>) => {
            document.local = true;
        });
        const localRoot = automergeRepository.getDoc<Record<string, unknown>>('root');
        if (!localRoot) {
            throw new Error('Expected the active root');
        }
        const peer = change(clone(localRoot, { actor: '1111111111111111' }), (document) => {
            document.peer = true;
        });
        automergeRepository.mergeRemoteDoc('root', save(peer));
        automergeRepository.replaceDocInLineage('root', clone(peer, { actor: '2222222222222222' }));

        expect(captureProjectRootIdentity()).toBe(rootIdentity);
    });

    it('invalidates on successful load but preserves the token for refused and invalid loads', async () => {
        const currentBytes = automergeRepository.saveDoc('root');
        if (!currentBytes) {
            throw new Error('Expected root bytes');
        }
        const bundle = new Map([['root', currentBytes]]);
        let rootIdentity = captureProjectRootIdentity();

        await expect(automergeRepository.loadAll({ bundle, shouldCommit: () => false })).resolves.toBe(false);
        expect(captureProjectRootIdentity()).toBe(rootIdentity);

        await expect(
            automergeRepository.loadAll({ bundle: new Map([['root', new Uint8Array([1, 2, 3])]]) })
        ).rejects.toThrow();
        expect(captureProjectRootIdentity()).toBe(rootIdentity);

        await expect(
            automergeRepository.loadAll({
                bundle: new Map([
                    ['root', currentBytes],
                    ['root:incremental:1', new Uint8Array([4, 5, 6])],
                ]),
            })
        ).rejects.toThrow();
        expect(captureProjectRootIdentity()).toBe(rootIdentity);

        await expect(
            automergeRepository.loadAll({
                bundle: new Map([['branch_only', save(createDocument('3333333333333333', { branch: true }))]]),
            })
        ).rejects.toThrow(/missing the exact root/i);
        expect(captureProjectRootIdentity()).toBe(rootIdentity);

        await expect(automergeRepository.loadAll({ bundle })).resolves.toBe(true);
        rootIdentity = expectRootIdentityToMove(rootIdentity);
        expect(captureProjectRootIdentity()).toBe(rootIdentity);
    });

    it('distinguishes synchronous existing-root merges from missing-root installation', async () => {
        const root = automergeRepository.getDoc<Record<string, unknown>>('root');
        if (!root) {
            throw new Error('Expected the active root');
        }
        const peerRoot = change(clone(root, { actor: '4444444444444444' }), (document) => {
            document.peerBundle = true;
        });
        const rootIdentity = captureProjectRootIdentity();

        await automergeRepository.mergeBundle(new Map([['root', save(peerRoot)]]));
        expect(captureProjectRootIdentity()).toBe(rootIdentity);

        const projectIdentity = captureProjectIdentity();
        await automergeRepository.mergeBundle(
            new Map([['branch_new', save(createDocument('5555555555555555', { branch: true }))]])
        );
        expect(captureProjectRootIdentity()).toBe(rootIdentity);
        expect(captureProjectIdentity()).not.toBe(projectIdentity);

        automergeRepository.removeDoc('root');
        const missingRootIdentity = captureProjectRootIdentity();
        await automergeRepository.mergeBundle(new Map([['root', save(peerRoot)]]));
        expectRootIdentityToMove(missingRootIdentity);
    });

    it('preserves the token for refused and malformed bundle merges', async () => {
        const rootIdentity = captureProjectRootIdentity();
        const incoming = new Map([['root', save(createDocument('6666666666666666', { incoming: true }))]]);

        await expect(automergeRepository.mergeBundle(incoming, { shouldCommit: () => false })).resolves.toEqual({
            mergedDocIds: [],
            newDocIds: [],
        });
        expect(captureProjectRootIdentity()).toBe(rootIdentity);

        await expect(automergeRepository.mergeBundle(new Map([['root', new Uint8Array([7, 8, 9])]]))).rejects.toThrow();
        expect(captureProjectRootIdentity()).toBe(rootIdentity);
    });

    it('invalidates an explicit root snapshot restore even for the same bytes', () => {
        const rootBytes = automergeRepository.saveDoc('root');
        if (!rootBytes) {
            throw new Error('Expected root bytes');
        }
        let rootIdentity = captureProjectRootIdentity();

        automergeRepository.restoreSnapshot(new Map([['root', { state: 'present', bytes: rootBytes }]]));
        rootIdentity = expectRootIdentityToMove(rootIdentity);
        automergeRepository.restoreSnapshot(new Map([['root', { state: 'absent' }]]));
        rootIdentity = expectRootIdentityToMove(rootIdentity);
        automergeRepository.restoreSnapshot(new Map([['root', { state: 'absent' }]]));
        expect(captureProjectRootIdentity()).toBe(rootIdentity);
    });

    it('preserves the token for ancillary-only snapshot restoration', () => {
        const rootIdentity = captureProjectRootIdentity();
        const branchBytes = save(createDocument('7777777777777777', { branch: true }));

        automergeRepository.restoreSnapshot(new Map([[DOC_BRANCHES, { state: 'present', bytes: branchBytes }]]));
        automergeRepository.restoreSnapshot(new Map([[DOC_BRANCHES, { state: 'present', bytes: branchBytes }]]));
        automergeRepository.restoreSnapshot(new Map([[DOC_BRANCHES, { state: 'absent' }]]));

        expect(captureProjectRootIdentity()).toBe(rootIdentity);
    });

    it('publishes a root installation only after its new identity is observable', () => {
        const before = captureProjectRootIdentity();
        const identitiesSeenByListener: string[] = [];
        const unsubscribe = automergeRepository.onChange(() => {
            identitiesSeenByListener.push(captureProjectRootIdentity());
        });

        automergeRepository.replaceDoc('root', createDocument('8888888888888888', { replacement: true }));
        unsubscribe();

        expect(identitiesSeenByListener).toEqual([captureProjectRootIdentity()]);
        expect(identitiesSeenByListener[0]).not.toBe(before);
    });

    it('offers an explicit same-target root content replacement without weakening global identity', () => {
        const rootIdentity = captureProjectRootIdentity();
        const projectIdentity = captureProjectIdentity();
        automergeRepository.replaceRootContentPreservingIdentity(
            createDocument('9999999999999999', { mergedIntoActiveRoot: true })
        );

        expect(captureProjectRootIdentity()).toBe(rootIdentity);
        expect(captureProjectIdentity()).not.toBe(projectIdentity);

        automergeRepository.removeDoc('root');
        const missingRootIdentity = captureProjectRootIdentity();
        expect(() =>
            automergeRepository.replaceRootContentPreservingIdentity(
                createDocument('1010101010101010', { impossible: true })
            )
        ).toThrow(/document not found/i);
        expect(captureProjectRootIdentity()).toBe(missingRootIdentity);
    });
});
