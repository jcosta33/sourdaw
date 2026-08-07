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
import { templates } from '../../../projectTemplates/templateDefinitions/helpers';
import { createMyceliumAscendantDemo } from '../createMyceliumAscendantDemo';

const MYCELIUM_TEMPLATE_ID = 'demo-mycelium-ascendant';

/*
 * Explicit timeout — measured 2026-08-07, not a convenience bump.
 *
 * Profiled per phase, 96% of this test is one thing: writing the demo into a
 * real Automerge document. Building the demo's stores costs ~44ms and the whole
 * reload half (`resetModuleStoresToDefault` + `projectCrdtToStores` + every
 * assertion) costs ~150ms; the document write costs the rest.
 *
 * That write is the subject of the test, so it cannot be mocked away, and the
 * fixture size is the regression this test exists to catch — 115 automation
 * lanes, 43 tracks, and the active arrangement's nested copy of the same lanes.
 * Shrinking it would delete the coverage.
 *
 * What was reducible has been reduced: routing the build through
 * `runWithAutomergeStorageTransaction` collapsed 18 Automerge `change()` calls
 * into 1. Interleaved A/B in one process, three pairs, under three concurrent
 * suites:
 *   bare 6858ms / 6187ms / 6583ms  vs  transactional 4637ms / 5248ms / 4887ms
 * Idle and alone the bare shape measured 5438.7ms against 3261.4ms
 * transactional — it exceeded the 5000ms default even with the machine quiet.
 * The remainder is Automerge materializing the payload, which is real work.
 *
 * The reason a timeout is still needed after that cut is variance, not the
 * mean. Repeated runs of this one test swung between 1.79s and 6.44s purely
 * with how many sibling suites shared the machine — the 5000ms default sits
 * inside that band, so ordinary load rather than any defect reddened two
 * unrelated PRs on 2026-08-07 and cost both lanes real time proving the failure
 * was not theirs. 30s is ~4.7x the slowest run observed, so load spikes cannot
 * red it, while a genuinely hung projection still fails fast.
 *
 * Deliberately no wall-clock budget `expect()` beside it, unlike
 * `grandBouleOfflineRenderBudget`: that spec measures an offline render whose
 * cost is bounded by the audio it renders, so a duration assertion there is
 * stable. This one is the load-sensitive case — a wall-clock budget is exactly
 * the assertion whose flakiness this PR exists to remove, and re-adding it
 * would recreate the problem one threshold down. Structural regressions stay
 * covered by the `toHaveLength(115)` / `toHaveLength(43)` assertions and by the
 * single-transaction guard below; a purely wall-clock regression is knowingly
 * not covered here.
 */
const RELOAD_TIMEOUT_MS = 30_000;

type RootDocument = {
    [key: string]: unknown;
};

type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

type TestPeer = {
    getDoc: () => Doc<RootDocument>;
    /** How many Automerge transactions the adapter has opened on this peer. */
    getMutateDocCallCount: () => number;
    port: TestPort;
};

function createPeer(): TestPeer {
    let doc = from<RootDocument>({});
    let mutateDocCallCount = 0;
    return {
        getDoc: () => doc,
        getMutateDocCallCount: () => mutateDocCallCount,
        port: {
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: (docId) => docId === 'root',
            mutateDoc: ({ changeFn }) => {
                mutateDocCallCount += 1;
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

    // The single-transaction build below is only faithful to production while
    // the template still commits through `executeAppAction`. Flipping it to
    // `project-replacement` would route the demo around that transaction and
    // silently restore the 18-write shape, so check the declaration rather than
    // leave the claim in a comment.
    it('keeps the demo template on the app-action boundary that the single-transaction build depends on', () => {
        const template = templates.find((candidate) => candidate.id === MYCELIUM_TEMPLATE_ID);
        expect(template?.executionBoundary).toBe('app-action');
    });

    it(
        'preserves canonical automation, project scale, and the active arrangement through CRDT projection reload',
        () => {
            const peer = createPeer();
            configureAutomergeStoragePort(peer.port);

            // No `flushAutomergeStorageWrites()` here: `commit()` inside the helper
            // already flushed this transaction's single write. Instrumenting the
            // port showed 1 `mutateDoc` call after `commit()` and still 1 after the
            // flush, so the call was dead weight.
            createMyceliumAscendantDemoInTransaction();

            // The production-fidelity claim, checked rather than asserted in prose.
            // One transaction is what `executeAppAction` produces; 18 is what the
            // bare call produced. This also catches the `await` failure mode the
            // boundary assertion above cannot see: per the CC-10 contract the
            // ambient transaction scope dies at the first `await`, so if the demo
            // build ever becomes async the writes silently escape the transaction
            // and this count climbs.
            expect(peer.getMutateDocCallCount()).toBe(1);

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
        },
        RELOAD_TIMEOUT_MS
    );
});
