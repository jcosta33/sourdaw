import { change, from, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { markerStore, trackStore } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { projectCrdtToStores } from '#/modules/CrdtDocument/useCases';
import { yeastStore } from '#/modules/Yeast/stores';

import { arrangementStore } from '../../../../stores/arrangementStore';
import { projectStore } from '../../../../stores/projectStore';
import { resetModuleStoresToDefault } from '../../../projectPersistence/helpers/resetModuleStoresToDefault';
import { createMyceliumAscendantDemo } from '../createMyceliumAscendantDemo';

type RootDocument = {
    [key: string]: unknown;
};

type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

type TestPeer = {
    getDoc: () => Doc<RootDocument>;
    port: TestPort;
};

function createPeer(): TestPeer {
    let doc = from<RootDocument>({});
    return {
        getDoc: () => doc,
        port: {
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: (docId) => docId === 'root',
            mutateDoc: ({ changeFn }) => {
                doc = change(doc, (draft) => changeFn(draft));
            },
        },
    };
}

function readDocumentSlot(peer: TestPeer, key: string): unknown {
    const value = peer.getDoc()[key];
    if (value === undefined) {
        return undefined;
    }
    return JSON.parse(JSON.stringify(value));
}

describe('Mycelium Ascendant project reload', () => {
    let armedFrames: Map<number, FrameRequestCallback>;
    let nextFrameHandle: number;

    beforeEach(() => {
        armedFrames = new Map();
        nextFrameHandle = 1;
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
            const handle = nextFrameHandle;
            nextFrameHandle += 1;
            armedFrames.set(handle, callback);
            return handle;
        });
        vi.stubGlobal('cancelAnimationFrame', (handle: number): void => {
            armedFrames.delete(handle);
        });
        configureAutomergeStoragePort(null);
        flushAutomergeStorageWrites();
        resetModuleStoresToDefault();
        flushAutomergeStorageWrites();
        armedFrames.clear();
    });

    afterEach(() => {
        configureAutomergeStoragePort(null);
        vi.unstubAllGlobals();
    });

    it('preserves canonical automation, project scale, and the active arrangement through CRDT projection reload', () => {
        const peer = createPeer();
        configureAutomergeStoragePort(peer.port);

        createMyceliumAscendantDemo();
        flushAutomergeStorageWrites();

        const canonicalAutomation = structuredClone(automationStore.value);
        const canonicalArrangementState = structuredClone(arrangementStore.value);
        const canonicalDocumentAutomation = readDocumentSlot(peer, 'automation');
        const canonicalYeast = structuredClone(yeastStore.value);
        const canonicalDocumentYeast = readDocumentSlot(peer, 'yeast');

        expect(canonicalAutomation?.lanes).toHaveLength(115);
        if (!canonicalYeast) {
            throw new Error('Expected the canonical Yeast project state');
        }
        expect(canonicalYeast.processors).toEqual([
            expect.objectContaining({
                type: 'velocity',
                name: 'Triplet Helix Dynamics',
                params: { mode: 2, compress_amount: 0.72 },
            }),
        ]);
        expect(projectStore.value?.scaleName).toBe('harmonicMinor');
        const canonicalActiveArrangement = canonicalArrangementState?.arrangements.find(
            (arrangement) => arrangement.id === canonicalArrangementState.activeArrangementId
        );
        if (!canonicalActiveArrangement) {
            throw new Error('Expected the canonical active arrangement');
        }
        expect(canonicalActiveArrangement.automation.lanes).toEqual(canonicalAutomation?.lanes);

        resetModuleStoresToDefault();
        projectCrdtToStores({ resetProjections: true });

        while (armedFrames.size > 0) {
            const due = [...armedFrames.values()];
            armedFrames.clear();
            for (const callback of due) {
                callback(100);
            }
        }

        expect(automationStore.value).toEqual(canonicalAutomation);
        expect(yeastStore.value).toEqual(canonicalYeast);
        expect(projectStore.value?.scaleName).toBe('harmonicMinor');
        const reloadedArrangementState = arrangementStore.value;
        const reloadedActiveArrangement = reloadedArrangementState?.arrangements.find(
            (arrangement) => arrangement.id === reloadedArrangementState.activeArrangementId
        );
        if (!reloadedActiveArrangement) {
            throw new Error('Expected the reloaded active arrangement');
        }
        expect(reloadedActiveArrangement.automation.lanes).toHaveLength(115);
        expect(reloadedActiveArrangement.automation.lanes).toEqual(canonicalAutomation?.lanes);
        expect(trackStore.value?.tracks).toHaveLength(43);
        expect(markerStore.value?.sections.map((section) => section.name)).toContain('Sporefall');
        expect(readDocumentSlot(peer, 'automation')).toEqual(canonicalDocumentAutomation);
        expect(readDocumentSlot(peer, 'yeast')).toEqual(canonicalDocumentYeast);
    });
});
