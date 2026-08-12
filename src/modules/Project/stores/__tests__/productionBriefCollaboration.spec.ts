import { change, clone, from, merge, type Doc } from '@automerge/automerge';
import { afterEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';

import { createDefaultProductionBrief } from '../../models/ProductionBrief';
import { defaultProjectStoreState, type ProjectStoreState } from '../projectStore';

type RootDocument = Record<string, unknown> & { projectMeta?: unknown };
type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

function createPeer(initialDoc: Doc<RootDocument>) {
    let doc = initialDoc;
    return {
        getDoc: () => doc,
        port: {
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: (docId: string) => docId === 'root',
            mutateDoc: ({ changeFn }: Parameters<TestPort['mutateDoc']>[0]) => {
                doc = change(doc, (draft) => changeFn(draft));
            },
        },
    };
}

function editPeer(peer: ReturnType<typeof createPeer>, linkId: string, sourceRunId: string): void {
    configureAutomergeStoragePort(peer.port);
    const storage = createAutomergeStorage<ProjectStoreState>('root', 'projectMeta');
    storage.hydrate?.();
    const state = storage.get();
    if (!state) {
        throw new Error('Expected project state');
    }
    storage.set({
        ...state,
        productionBrief: {
            ...state.productionBrief,
            sourceRunLinks: [...state.productionBrief.sourceRunLinks, { id: linkId, sourceRunId, createdAt: 110 }],
        },
    });
    flushAutomergeStorageWrites();
}

afterEach(() => {
    flushAutomergeStorageWrites();
    configureAutomergeStoragePort(null);
});

describe('production brief collaboration', () => {
    it('merges concurrent source-run link rows without dropping either peer', () => {
        const baselineState: ProjectStoreState = {
            ...structuredClone(defaultProjectStoreState),
            productionBrief: createDefaultProductionBrief(100),
        };
        const baseline = from<RootDocument>({ projectMeta: baselineState });
        const peerA = createPeer(clone(baseline));
        const peerB = createPeer(clone(baseline));

        editPeer(peerA, 'source-link-a', 'run-a');
        editPeer(peerB, 'source-link-b', 'run-b');

        const merged = createPeer(merge(clone(peerA.getDoc()), peerB.getDoc()));
        configureAutomergeStoragePort(merged.port);
        const storage = createAutomergeStorage<ProjectStoreState>('root', 'projectMeta');
        storage.hydrate?.();

        expect(storage.get()?.productionBrief.sourceRunLinks).toEqual(
            expect.arrayContaining([
                { id: 'source-link-a', sourceRunId: 'run-a', createdAt: 110 },
                { id: 'source-link-b', sourceRunId: 'run-b', createdAt: 110 },
            ])
        );
    });
});
