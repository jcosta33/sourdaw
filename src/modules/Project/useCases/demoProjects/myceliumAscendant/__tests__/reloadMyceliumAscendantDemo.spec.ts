import { change, from, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
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

/**
 * Build the demo through the same storage-transaction boundary production uses.
 *
 * The `demo-mycelium-ascendant` template declares `executionBoundary:
 * 'app-action'`, so it only ever reaches the document via
 * `handleCreateProjectFromTemplate` inside `executeAppAction`, which wraps the
 * handler in `runWithAutomergeStorageTransaction`. Every store write the
 * hydration makes therefore shares one commit owner and lands as a single
 * Automerge `change()`.
 *
 * Calling `createMyceliumAscendantDemo()` bare instead leaves each of the 18
 * store adapters on its own unscoped commit owner, so the demo commits as 18
 * separate `change()` calls against a document that grows with each one. That
 * is both slower than production and a write shape production never performs.
 */
function createMyceliumAscendantDemoInTransaction(): void {
    const transaction = runWithAutomergeStorageTransaction(undefined, () => {
        createMyceliumAscendantDemo();
    });
    if (transaction.status === 'threw') {
        transaction.abort();
        throw transaction.error;
    }
    transaction.commit();
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

    /*
     * Explicit timeout — measured 2026-08-07, not a convenience bump.
     *
     * Profiled per phase, 96% of this test is one thing: writing the demo into
     * a real Automerge document. Building the demo's stores costs ~44ms and the
     * whole reload half (`resetModuleStoresToDefault` + `projectCrdtToStores` +
     * every assertion) costs ~150ms; the document write costs the rest.
     *
     * That write is the subject of the test, so it cannot be mocked away, and
     * the fixture size is the regression this test exists to catch — 115
     * automation lanes, 43 tracks, and the active arrangement's nested copy of
     * the same lanes. Shrinking it would delete the coverage.
     *
     * What was reducible has been reduced: routing the build through
     * `runWithAutomergeStorageTransaction` (see above) collapsed 18 Automerge
     * `change()` calls into 1 and cut ~25% off the write. Interleaved A/B in
     * one process, three pairs, under three concurrent suites:
     *   bare 6858ms / 6187ms / 6583ms  vs  transactional 4637ms / 5248ms / 4887ms
     * The remainder is Automerge materializing the payload, which is real work.
     *
     * The reason a timeout is still needed after that cut is variance, not the
     * mean. Repeated runs of this one test swung between 1.79s and 6.44s purely
     * with how many sibling suites shared the machine — the 5000ms default sits
     * inside that band, so ordinary load rather than any defect reddened two
     * unrelated PRs on 2026-08-07 and cost both lanes real time proving the
     * failure was not theirs. 30s is ~4.7x the slowest run observed, so load
     * spikes cannot red it, while a genuinely hung projection still fails fast.
     */
    it('preserves canonical automation, project scale, and the active arrangement through CRDT projection reload', () => {
        const peer = createPeer();
        configureAutomergeStoragePort(peer.port);

        createMyceliumAscendantDemoInTransaction();
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
    }, 30000);
});
