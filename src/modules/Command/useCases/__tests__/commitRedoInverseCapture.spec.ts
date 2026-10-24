import * as Automerge from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    captureDurableDocumentWitness,
    captureProjectIdentity,
    captureProjectMutationAuthorization,
    createCrdtDoc,
    getCrdtDoc,
    getCrdtDocIds,
    mutateCrdtDoc,
    removeCrdtDoc,
    replaceCrdtDoc,
    replaceCrdtDocInLineage,
} from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type ActionUndoEntry } from '../../models/UndoEntry';
import { undoStore } from '../../stores/undoStore';
import { commitRedoInverseCapture } from '../commitRedoInverseCapture';
import { createUndoEntry } from '../createUndoEntry';

function rename(trackId: string, name: string): AppAction {
    return { type: 'renameTrack', payload: { trackId, name } };
}

describe('committed Redo inverse capture publication', () => {
    let entries: ActionUndoEntry[];
    let actions: AppAction[];
    let storage: ReturnType<typeof createAutomergeStorage<{ revision: number }>>;

    beforeEach(() => {
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        createCrdtDoc('root');
        configureAutomergeStoragePort({
            getDoc: (id) => getCrdtDoc(id),
            getDocHeads: (id) => Automerge.getHeads(getCrdtDoc(id)!),
            hasDoc: (id) => getCrdtDoc(id) !== undefined,
            getSemanticMessage: () => undefined,
            mutateDoc: ({ docId, changeFn, message, changedKeys, snapshotTransaction }) => {
                mutateCrdtDoc({ id: docId, changeFn, message, localSlots: changedKeys, snapshotTransaction });
            },
        });
        storage = createAutomergeStorage<{ revision: number }>('root', 'captureProof');
        storage.set({ revision: 0 });
        flushAutomergeStorageWrites();
        actions = [rename('first', 'After'), rename('second', 'After')];
        entries = actions.map((action, index) => createUndoEntry('Rename', action, rename(String(index), 'Before')));
        undoStore.set({ past: [], future: entries });
    });

    afterEach(() => {
        commitRedoInverseCapture({ phase: 'discard', actions });
        undoStore.set({ past: [], future: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    function stage(fresh: readonly AppAction[]) {
        return runWithAutomergeStorageTransaction(undefined, () => {
            const ownsPublication = captureProjectMutationAuthorization();
            ownsPublication();
            for (const [index, action] of actions.entries()) {
                commitRedoInverseCapture({
                    phase: 'stage',
                    action,
                    inverseAction: fresh[index]!,
                    ownsPublication,
                    publicationAuthority: {
                        captureIdentity: captureProjectIdentity,
                        captureWitness: captureDurableDocumentWitness,
                        captureCurrentGuard: () => {
                            const identity = captureProjectIdentity();
                            const documents = getCrdtDocIds().map((id) => ({
                                id,
                                heads: Automerge.getHeads(getCrdtDoc(id)!),
                            }));
                            return () =>
                                captureProjectIdentity() === identity &&
                                documents.every(({ id, heads }) => {
                                    const document = getCrdtDoc(id);
                                    return document !== undefined && Automerge.hasHeads(document, heads);
                                });
                        },
                    },
                });
            }
            storage.set({ revision: storage.get()!.revision + 1 });
        });
    }

    it.each(['clone', 'rollback', 'replacement', 'unproved', 'missing-entry', 'partial-set'] as const)(
        'settles the complete group only on its proven installed publication: %s',
        (terminal) => {
            const before = Automerge.clone(getCrdtDoc('root')!);
            const previous = entries.map((entry) => entry.inverseAction);
            const fresh = [rename('first', 'Fresh first'), rename('second', 'Fresh second')];
            const transaction = stage(fresh);
            transaction.commit();
            if (terminal === 'unproved') {
                replaceCrdtDocInLineage({ id: 'root', doc: Automerge.clone(getCrdtDoc('root')!) });
            }
            commitRedoInverseCapture({ phase: 'published', actions });
            if (terminal === 'rollback') {
                replaceCrdtDocInLineage({ id: 'root', doc: before });
            } else if (terminal === 'replacement') {
                // Same exact published heads, but a different project installation.
                replaceCrdtDoc({ id: 'root', doc: Automerge.clone(getCrdtDoc('root')!) });
            } else if (terminal === 'clone') {
                replaceCrdtDocInLineage({ id: 'root', doc: Automerge.clone(getCrdtDoc('root')!) });
            } else if (terminal === 'missing-entry') {
                undoStore.set({ past: [], future: [entries[0]!] });
            }
            const installed = getCrdtDoc('root');
            commitRedoInverseCapture({
                phase: 'settle',
                actions: terminal === 'partial-set' ? [actions[0]!] : actions,
            });
            expect(getCrdtDoc('root')).toBe(installed);
            for (const [index, entry] of entries.entries()) {
                expect(entry.inverseAction).toBe(terminal === 'clone' ? fresh[index] : previous[index]);
            }
            commitRedoInverseCapture({ phase: 'settle', actions });
            for (const [index, entry] of entries.entries()) {
                expect(entry.inverseAction).toBe(terminal === 'clone' ? fresh[index] : previous[index]);
            }
        }
    );

    it('discards an aborted intent before unrelated publication or a fresh retry', () => {
        const previous = entries.map((entry) => entry.inverseAction);
        const aborted = stage([rename('first', 'Aborted'), rename('second', 'Aborted')]);
        aborted.abort();
        commitRedoInverseCapture({ phase: 'discard', actions });
        const unrelated = runWithAutomergeStorageTransaction(undefined, () => storage.set({ revision: 1 }));
        unrelated.commit();
        commitRedoInverseCapture({ phase: 'published', actions });
        commitRedoInverseCapture({ phase: 'settle', actions });
        for (const [index, entry] of entries.entries()) {
            expect(entry.inverseAction).toBe(previous[index]);
        }

        const fresh = [rename('first', 'Retry first'), rename('second', 'Retry second')];
        stage(fresh).commit();
        commitRedoInverseCapture({ phase: 'published', actions });
        commitRedoInverseCapture({ phase: 'settle', actions });
        for (const [index, entry] of entries.entries()) {
            expect(entry.inverseAction).toBe(fresh[index]);
        }
    });

    it('retains the existing caller-proven two-argument contract', () => {
        const fresh = rename('first', 'Caller proven');
        commitRedoInverseCapture(actions[0]!, fresh);
        expect(entries[0]!.inverseAction).toBe(fresh);
    });
});
