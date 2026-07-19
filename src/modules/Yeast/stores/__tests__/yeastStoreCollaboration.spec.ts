import { change, clone, from, merge, type Doc } from '@automerge/automerge';
import { afterEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';

import { createYeastAutomergeStorage } from '../yeastAutomergeStorage';
import { type YeastProcessorInfo, type YeastState } from '../yeastStore';

type RootDocument = { yeast?: unknown };
type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

function createProcessor(id: string): YeastProcessorInfo {
    return { id, type: 'groove', name: id, bypassed: false };
}

function createState(processors: YeastProcessorInfo[]): YeastState {
    return { processors, uiLevel: 1 };
}

function createPeer(initialDoc: Doc<RootDocument>): {
    getDoc: () => Doc<RootDocument>;
    replaceDoc: (doc: Doc<RootDocument>) => void;
    port: TestPort;
} {
    let doc = initialDoc;
    return {
        getDoc: () => doc,
        replaceDoc: (nextDoc) => {
            doc = nextDoc;
        },
        port: {
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: (docId) => docId === 'root',
            mutateDoc: ({ changeFn }) => {
                doc = change(doc, (draft) => changeFn(draft as unknown as Record<string, unknown>));
            },
        },
    };
}

function createStorage() {
    let localState: YeastState | null = null;
    const storage = createYeastAutomergeStorage(() => localState);
    return {
        get: () => storage.get(),
        hydrate: () => {
            const hydrated = storage.hydrate?.() ?? false;
            localState = storage.get();
            return hydrated;
        },
        set: (state: YeastState) => {
            localState = state;
            storage.set(state);
        },
    };
}

function createBaseline(state: YeastState): Doc<RootDocument> {
    const peer = createPeer(from<RootDocument>({}));
    const storage = createStorage();
    configureAutomergeStoragePort(peer.port);
    storage.set(state);
    flushAutomergeStorageWrites();
    return peer.getDoc();
}

describe('Yeast collaboration storage', () => {
    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
    });

    it('preserves concurrent first writes for different processors', () => {
        const empty = from<RootDocument>({});
        const leftPeer = createPeer(clone(empty));
        const rightPeer = createPeer(clone(empty));
        const leftStorage = createStorage();
        const rightStorage = createStorage();

        configureAutomergeStoragePort(leftPeer.port);
        leftStorage.set(createState([createProcessor('left')]));
        flushAutomergeStorageWrites();

        configureAutomergeStoragePort(rightPeer.port);
        rightStorage.set(createState([createProcessor('right')]));
        flushAutomergeStorageWrites();

        const mergedPeer = createPeer(merge(leftPeer.getDoc(), rightPeer.getDoc()));
        const mergedStorage = createStorage();
        configureAutomergeStoragePort(mergedPeer.port);

        expect(mergedStorage.hydrate()).toBe(true);
        expect(mergedStorage.get()?.processors.map((processor) => processor.id)).toEqual(['left', 'right']);
    });

    it('preserves concurrent edits to different processor entities', () => {
        const baseline = createBaseline(createState([createProcessor('left'), createProcessor('right')]));
        const leftPeer = createPeer(clone(baseline));
        const rightPeer = createPeer(clone(baseline));
        const leftStorage = createStorage();
        const rightStorage = createStorage();

        configureAutomergeStoragePort(leftPeer.port);
        leftStorage.hydrate();
        leftStorage.set(createState([{ ...createProcessor('left'), name: 'Left edited' }, createProcessor('right')]));
        flushAutomergeStorageWrites();

        configureAutomergeStoragePort(rightPeer.port);
        rightStorage.hydrate();
        rightStorage.set(createState([createProcessor('left'), { ...createProcessor('right'), bypassed: true }]));
        flushAutomergeStorageWrites();

        const mergedPeer = createPeer(merge(leftPeer.getDoc(), rightPeer.getDoc()));
        const mergedStorage = createStorage();
        configureAutomergeStoragePort(mergedPeer.port);
        mergedStorage.hydrate();

        expect(mergedStorage.get()?.processors).toEqual([
            { ...createProcessor('left'), name: 'Left edited' },
            { ...createProcessor('right'), bypassed: true },
        ]);
    });

    it('rebases a pending local edit over a newly hydrated remote processor', () => {
        const baseline = createBaseline(createState([createProcessor('local')]));
        const localPeer = createPeer(clone(baseline));
        const remotePeer = createPeer(clone(baseline));
        const localStorage = createStorage();
        const remoteStorage = createStorage();

        configureAutomergeStoragePort(remotePeer.port);
        remoteStorage.hydrate();
        remoteStorage.set(createState([createProcessor('local'), createProcessor('remote')]));
        flushAutomergeStorageWrites();

        configureAutomergeStoragePort(localPeer.port);
        localStorage.hydrate();
        localStorage.set(createState([{ ...createProcessor('local'), name: 'Pending local edit' }]));
        localPeer.replaceDoc(merge(localPeer.getDoc(), remotePeer.getDoc()));
        expect(localStorage.hydrate()).toBe(true);
        expect(localStorage.get()?.processors).toEqual([
            { ...createProcessor('local'), name: 'Pending local edit' },
            createProcessor('remote'),
        ]);

        flushAutomergeStorageWrites();
        expect(localStorage.get()?.processors.map((processor) => processor.id)).toEqual(['local', 'remote']);
    });
});
