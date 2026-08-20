import {
    init as automergeInit,
    initSyncState,
    change,
    clone,
    generateSyncMessage,
    getHeads,
    load,
    receiveSyncMessage,
    save,
    type Doc,
    type Heads,
    type SyncState,
} from '@automerge/automerge';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    subscribeToCrdtChanges,
    getCrdtDoc,
    createCrdtDoc,
    replaceCrdtDoc,
    removeCrdtDoc,
    sanitizeIncomingCrdtDocument,
    hasCrdtDoc,
    getCrdtDocIds,
} from '#/modules/CrdtDocument/useCases';
import { base64ToBytes, bytesToBase64 } from '#/utils/base64';

import { type PeerId, type PeerMessage } from '../../models/CollaborationTypes';
import { AutomergeSync } from '../automergeSync';

import { createPeerSyncMessages } from './peerSyncHandshake';

const command_mocks = vi.hoisted(() => ({
    sync_action_replay_metadata: vi.fn<(entries: readonly { id: string }[]) => void>(),
}));

const crdt_mocks = vi.hoisted(() => ({
    wait_for_document_transition: vi.fn<(docId: string) => Promise<'aborted' | 'committed'> | null>(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    syncActionReplayMetadata: command_mocks.sync_action_replay_metadata,
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    subscribeToCrdtChanges: vi.fn(),
    getCrdtDoc: vi.fn(),
    createCrdtDoc: vi.fn(),
    replaceCrdtDoc: vi.fn(),
    removeCrdtDoc: vi.fn(),
    hasCrdtDoc: vi.fn(),
    getCrdtDocIds: vi.fn().mockReturnValue([]),
    persistCrdtProject: vi.fn().mockResolvedValue(undefined),
    waitForCrdtDocumentTransition: crdt_mocks.wait_for_document_transition,
    sanitizeIncomingCrdtDocument: vi.fn((document) => document),
    DOC_PREFIX_ROOT: 'root',
    DOC_BRANCHES: '__branches__',
}));

function makePeerManager() {
    return {
        getConnectedPeerIds: vi.fn().mockReturnValue([]),
        sendCrdtSync: vi.fn(),
    };
}

/** A real base64 Automerge sync message for the `root` doc (so receiveSync's
 *  receiveSyncMessage decode succeeds and we reach replaceCrdtDoc). */
function makeRealSyncMessage(): string {
    const doc = createAmDoc();
    const [, message] = generateSyncMessage(doc, initSyncState());
    return bytesToBase64(message!);
}

// Minimal real Automerge doc helper. `@automerge/automerge` is NOT mocked, so
// this returns a genuine empty doc for receiveSyncMessage to operate on.
function createAmDoc(): Doc<unknown> {
    return automergeInit();
}

type SeededDoc = {
    actionHistory?: { entries: { id: string }[] };
    /** A slot with no store projection — stands in for ordinary project truth. */
    peerProbe?: string;
};

/**
 * A document seeded with the shared history slot, so a peer copy forked from it
 * merges against the same lineage instead of an unrelated document.
 */
function seedAmDoc(): Doc<SeededDoc> {
    return change(automergeInit<SeededDoc>('aaaaaaaaaaaaaaaa'), (draft) => {
        draft.actionHistory = { entries: [] };
    });
}

/**
 * Forks `deliverPeerSync`'s "live" and "remote" documents from one canonical
 * `seedAmDoc()` call instead of calling it twice.
 *
 * `change()` stamps every change with the wall-clock second, so two
 * independent `seedAmDoc()` calls only produce byte-identical seq-1 changes
 * when they land in the same second — under load they can straddle a
 * boundary, and Automerge then rejects the second seq 1 from actor
 * `aaaaaaaaaaaaaaaa` as ambiguous (`RangeError: duplicate seq 1 found for
 * actor aaaaaaaaaaaaaaaa`). Cloning a single genesis document is
 * deterministic regardless of timing, and giving each fork its own actor id
 * keeps them from ever colliding on a future seq of their own.
 */
function forkPeerDocs(): { live: Doc<SeededDoc>; remoteSeed: Doc<SeededDoc> } {
    const canonical = seedAmDoc();
    return {
        live: clone<SeededDoc>(canonical, 'aaaaaaaaaaaaaaaa'),
        remoteSeed: clone<SeededDoc>(canonical, 'bbbbbbbbbbbbbbbb'),
    };
}

describe('AutomergeSync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        crdt_mocks.wait_for_document_transition.mockReturnValue(null);
        // `clearAllMocks` clears calls but not queued `...Once` implementations,
        // so an unconsumed one from an earlier test would decide whether the
        // first message of a later exchange sanitizes. Reset to the passthrough
        // default instead of inheriting that.
        vi.mocked(sanitizeIncomingCrdtDocument).mockReset();
        vi.mocked(sanitizeIncomingCrdtDocument).mockImplementation((document) => document);
        // The repository doubles are stateful stand-ins in several tests, and
        // `clearAllMocks` clears calls but leaves implementations and canned
        // return values in place — so without this a stand-in keeps answering
        // for the next test, from a closure whose subject is already gone.
        vi.mocked(subscribeToCrdtChanges)
            .mockReset()
            .mockReturnValue(() => {});
        vi.mocked(getCrdtDoc).mockReset();
        vi.mocked(createCrdtDoc).mockReset();
        vi.mocked(replaceCrdtDoc).mockReset();
        vi.mocked(removeCrdtDoc).mockReset();
        vi.mocked(hasCrdtDoc).mockReset().mockReturnValue(false);
        vi.mocked(getCrdtDocIds).mockReset().mockReturnValue([]);
    });

    it('subscribes to CRDT changes on start using injected dependencies', () => {
        vi.mocked(subscribeToCrdtChanges).mockReturnValue(() => {});
        const sync = new AutomergeSync(makePeerManager());

        sync.start();

        expect(subscribeToCrdtChanges).toHaveBeenCalledTimes(1);
    });

    it('§fix-14 start() is idempotent: a second start unsubscribes the first', () => {
        const unsub = vi.fn();
        vi.mocked(subscribeToCrdtChanges).mockReturnValue(unsub);
        const sync = new AutomergeSync(makePeerManager());

        sync.start();
        sync.start();

        // The first subscription must be torn down before re-subscribing.
        expect(unsub).toHaveBeenCalledTimes(1);
        expect(subscribeToCrdtChanges).toHaveBeenCalledTimes(2);
    });

    it('§fix-5 drops a sync for an unknown docId (never mints arbitrary docs)', () => {
        const sync = new AutomergeSync(makePeerManager());

        sync.receiveSync({ peerId: 'p1', docId: 'evil-doc', syncMessageBase64: makeRealSyncMessage() });

        expect(createCrdtDoc).not.toHaveBeenCalled();
        expect(replaceCrdtDoc).not.toHaveBeenCalled();
    });

    it('§fix-5 accepts a sync for a known docId (root)', () => {
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        const sync = new AutomergeSync(makePeerManager());

        sync.receiveSync({ peerId: 'p1', docId: 'root', syncMessageBase64: makeRealSyncMessage() });

        expect(replaceCrdtDoc).toHaveBeenCalledWith(expect.objectContaining({ id: 'root' }));
    });

    it('defers an incoming branch-document sync until its owning transition releases the document', async () => {
        let releaseTransition: ((outcome: 'aborted' | 'committed') => void) | undefined;
        const transition = new Promise<'aborted' | 'committed'>((resolve) => {
            releaseTransition = resolve;
        });
        crdt_mocks.wait_for_document_transition.mockReturnValueOnce(transition).mockReturnValue(null);
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        const sync = new AutomergeSync(makePeerManager());

        sync.receiveSync({
            peerId: 'peer-1',
            docId: 'branch_candidate',
            syncMessageBase64: makeRealSyncMessage(),
        });

        expect(replaceCrdtDoc).not.toHaveBeenCalled();
        releaseTransition?.('committed');
        await transition;
        await Promise.resolve();

        expect(replaceCrdtDoc).toHaveBeenCalledWith(expect.objectContaining({ id: 'branch_candidate' }));
    });

    it('drops a deferred branch-document sync when its owning transition aborts', async () => {
        let finishTransition: ((outcome: 'aborted' | 'committed') => void) | undefined;
        const transition = new Promise<'aborted' | 'committed'>((resolve) => {
            finishTransition = resolve;
        });
        crdt_mocks.wait_for_document_transition.mockReturnValueOnce(transition).mockReturnValue(null);
        vi.mocked(getCrdtDoc).mockReturnValue(undefined);
        const sync = new AutomergeSync(makePeerManager());

        sync.receiveSync({
            peerId: 'peer-1',
            docId: 'branch_candidate',
            syncMessageBase64: makeRealSyncMessage(),
        });

        finishTransition?.('aborted');
        await transition;
        await Promise.resolve();

        expect(createCrdtDoc).not.toHaveBeenCalled();
        expect(replaceCrdtDoc).not.toHaveBeenCalled();
    });

    it.each(['root', 'branch_feature'])('sanitizes and persists an authorized peer document: %s', async (doc_id) => {
        const { persistCrdtProject } = await import('#/modules/CrdtDocument/useCases');
        const sanitized_document = createAmDoc();
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        vi.mocked(sanitizeIncomingCrdtDocument).mockReturnValueOnce(sanitized_document);
        const sync = new AutomergeSync(makePeerManager());

        sync.receiveSync({ peerId: 'editor', docId: doc_id, syncMessageBase64: makeRealSyncMessage() });

        expect(sanitizeIncomingCrdtDocument).toHaveBeenCalledTimes(1);
        expect(replaceCrdtDoc).toHaveBeenCalledWith({ id: doc_id, doc: sanitized_document });
        expect(persistCrdtProject).toHaveBeenCalledTimes(1);
    });

    /**
     * CC-3 — replay-authority invalidation is scoped to what the sync touched.
     *
     * Installs a mutable stand-in repository so a multi-round Automerge
     * handshake (the first message carries no changes) reaches `receiveSync`
     * exactly as it would in a session.
     */
    function deliverPeerSync({ docId, mutate }: { docId: string; mutate?: (draft: SeededDoc) => void }): string[] {
        const order: string[] = [];
        const { live: initial_live, remoteSeed } = forkPeerDocs();
        let live = initial_live;
        vi.mocked(getCrdtDoc).mockImplementation(() => live);
        vi.mocked(replaceCrdtDoc).mockImplementation(({ doc }) => {
            order.push('replace-document');
            live = doc;
        });
        command_mocks.sync_action_replay_metadata.mockImplementation(() => {
            order.push('reconcile-replay-metadata');
        });

        const remote = mutate ? change(remoteSeed, mutate) : remoteSeed;
        const sync = new AutomergeSync(makePeerManager());
        for (const syncMessageBase64 of createPeerSyncMessages({ remote, local: live })) {
            sync.receiveSync({ peerId: 'editor', docId, syncMessageBase64 });
        }
        return order;
    }

    it('leaves replay authority alone when a root sync applies no change', () => {
        const order = deliverPeerSync({ docId: 'root' });

        expect(order).toEqual(['replace-document']);
        expect(command_mocks.sync_action_replay_metadata).not.toHaveBeenCalled();
    });

    /**
     * Regression guard for the actor-seq collision: `seedAmDoc()` stamps its
     * change with `Math.floor(Date.now() / 1000)`, so two independent calls
     * used to only agree when they landed in the same wall-clock second. This
     * forces a straddle across that second boundary to prove `forkPeerDocs`
     * no longer depends on timing — before the fix this threw
     * `RangeError: duplicate seq 1 found for actor aaaaaaaaaaaaaaaa`.
     */
    it('stays deterministic when the underlying seed change would straddle a wall-clock second', () => {
        const now_spy = vi.spyOn(Date, 'now');
        now_spy.mockReturnValueOnce(1_700_000_000_000);
        now_spy.mockReturnValueOnce(1_700_000_001_000);
        try {
            const order = deliverPeerSync({ docId: 'root' });
            expect(order).toEqual(['replace-document']);
            expect(command_mocks.sync_action_replay_metadata).not.toHaveBeenCalled();
        } finally {
            now_spy.mockRestore();
        }
    });

    it("leaves replay authority alone when a root sync only touches a slot that isn't the action history", () => {
        const order = deliverPeerSync({
            docId: 'root',
            mutate: (draft) => {
                draft.peerProbe = 'peer edit';
            },
        });

        expect(order).toEqual(['replace-document', 'replace-document']);
        expect(command_mocks.sync_action_replay_metadata).not.toHaveBeenCalled();
    });

    it('leaves replay authority alone when the action history changes on a branch document', () => {
        const order = deliverPeerSync({
            docId: 'branch_feature',
            mutate: (draft) => {
                draft.actionHistory = { entries: [{ id: 'branch-entry' }] };
            },
        });

        expect(order).toEqual(['replace-document', 'replace-document']);
        expect(command_mocks.sync_action_replay_metadata).not.toHaveBeenCalled();
    });

    it('reconciles replay authority after installing a root sync that rewrote the action history', () => {
        const order = deliverPeerSync({
            docId: 'root',
            mutate: (draft) => {
                draft.actionHistory = { entries: [{ id: 'peer-entry' }] };
            },
        });

        // Reconciliation must run against the *projected* post-sync history, so
        // it can only happen after the document is installed.
        expect(order).toEqual(['replace-document', 'replace-document', 'reconcile-replay-metadata']);
        expect(command_mocks.sync_action_replay_metadata).toHaveBeenCalledTimes(1);
    });

    /**
     * A live peer endpoint, so a sanitation failure can be driven through a
     * real bidirectional exchange rather than a single canned message.
     * `receiveSyncMessage` outdates the document it is handed, so the peer's
     * copy is reloaded from bytes and never aliases a document under test.
     */
    function makePeerEndpoint(doc: Doc<unknown>) {
        let peer_doc = load<unknown>(save(doc));
        let peer_state: SyncState = initSyncState();
        return {
            /** The next payload this peer wants to send, or null once settled. */
            send(): Uint8Array | null {
                const [next_state, message] = generateSyncMessage(peer_doc, peer_state);
                peer_state = next_state;
                return message;
            },
            receive(message: Uint8Array): void {
                [peer_doc, peer_state] = receiveSyncMessage(peer_doc, peer_state, message);
            },
        };
    }

    /** Let the per-(peer, doc) send queues drain; they settle off the microtask queue. */
    async function settleSends(): Promise<void> {
        await new Promise((resolve) => {
            setTimeout(resolve, 0);
        });
    }

    const PEER_EDIT = 'peer edit';

    type LiveExchangeOptions = {
        docId?: string;
        /** Start with no local document under `docId`, so `createCrdtDoc` runs. */
        absentLocally?: boolean;
    };

    /**
     * A stand-in repository plus a live peer, wired so both directions of the
     * Automerge sync protocol actually run.
     *
     * Driving one direction is not enough to exercise anything about merged
     * content: Automerge's first sync message is a handshake (heads and a
     * bloom filter) carrying no changes, and `generate_sync_message` then
     * suppresses further sends until a reply arrives. A fixture that only
     * pushes payloads at the receiver therefore never merges a peer edit and
     * never reaches a second delivery, whatever the receiver does. So the
     * receiver's own outbound generation is handed straight back to the peer
     * here, exactly as a transport would.
     */
    function setupLiveExchange(options: LiveExchangeOptions = {}) {
        const doc_id = options.docId ?? 'root';
        const { live: initial_live, remoteSeed } = forkPeerDocs();
        let live: Doc<SeededDoc> | undefined = options.absentLocally ? undefined : initial_live;

        let change_cb: ((docId?: string) => void) | undefined;
        vi.mocked(subscribeToCrdtChanges).mockImplementation((cb) => {
            change_cb = cb;
            return () => {};
        });
        vi.mocked(getCrdtDoc).mockImplementation(() => live);
        vi.mocked(createCrdtDoc).mockImplementation(() => {
            live = automergeInit();
        });
        vi.mocked(replaceCrdtDoc).mockImplementation(({ doc }) => {
            live = doc;
            // The real repository notifies subscribers on a replace; the
            // isApplyingRemoteSync guard is what keeps that from echoing.
            change_cb?.(doc_id);
        });
        vi.mocked(removeCrdtDoc).mockImplementation(() => {
            live = undefined;
            change_cb?.(doc_id);
        });

        const peer_document = change(remoteSeed, (draft) => {
            draft.peerProbe = PEER_EDIT;
        });
        const peer = makePeerEndpoint(peer_document);

        const sendCrdtSync = vi.fn((input: { peerId: PeerId; message: PeerMessage }): void => {
            const { message } = input;
            if (message.type !== 'crdt-sync' || message.docId !== doc_id) {
                return;
            }
            peer.receive(base64ToBytes(message.data));
        });
        const peerManager = {
            getConnectedPeerIds: vi.fn<() => PeerId[]>().mockReturnValue(['editor']),
            sendCrdtSync,
        };
        const onSyncQuarantine = vi.fn();
        const onSyncQuarantineLifted = vi.fn();
        const sync = new AutomergeSync(peerManager, { onSyncQuarantine, onSyncQuarantineLifted });
        sync.start();

        /** Announce this node to the peer, the way handlePeerConnected does. */
        async function connect(): Promise<void> {
            sync.addPeer('editor');
            await settleSends();
        }

        /**
         * Deliver one payload from the peer and let this node's own outbound
         * generation reach it. Returns false once the peer has nothing to send.
         */
        async function deliverOne(): Promise<boolean> {
            const message = peer.send();
            if (!message) {
                return false;
            }
            sync.receiveSync({ peerId: 'editor', docId: doc_id, syncMessageBase64: bytesToBase64(message) });
            // A live session keeps editing while it syncs, and it is the
            // repository's change notification that generates the reply.
            change_cb?.(doc_id);
            await settleSends();
            return true;
        }

        async function deliver(rounds: number): Promise<void> {
            for (let round = 0; round < rounds; round++) {
                const delivered = await deliverOne();
                if (!delivered) {
                    return;
                }
            }
        }

        /**
         * A payload the peer would send after re-negotiating from scratch.
         * Built from a fresh SyncState so it owes nothing to Automerge's
         * in-flight suppression — this is a delivery that genuinely arrives,
         * whatever the receiver did with the last one.
         */
        function resendFromPeer(): string {
            const resend = makePeerEndpoint(peer_document);
            return bytesToBase64(resend.send()!);
        }

        function deliverResend(): void {
            sync.receiveSync({ peerId: 'editor', docId: doc_id, syncMessageBase64: resendFromPeer() });
        }

        /** The repository announcing a local edit, and the sends it triggers. */
        async function notifyLocalChange(): Promise<void> {
            change_cb?.(doc_id);
            await settleSends();
        }

        return {
            sync,
            peer,
            peerDocument: peer_document,
            docId: doc_id,
            onSyncQuarantine,
            onSyncQuarantineLifted,
            peerManager,
            connect,
            deliverOne,
            deliver,
            resendFromPeer,
            deliverResend,
            notifyLocalChange,
            currentDoc: (): Doc<unknown> | undefined => live,
            currentHeads: (): Heads => {
                if (live === undefined) {
                    throw new Error('no local document to read heads from');
                }
                return getHeads(live);
            },
            probeValue: (): string | undefined => live?.peerProbe,
            /**
             * An ordinary local edit, the way the repository makes one. This
             * throws on an outdated document, which is exactly the state a
             * non-installing receiver leaves behind.
             */
            applyLocalEdit(value: string): void {
                if (live === undefined) {
                    throw new Error('no local document to edit');
                }
                live = change(live, (draft) => {
                    draft.peerProbe = value;
                });
            },
        };
    }

    /**
     * Drive a channel past {@link MAX_SANITATION_FAILURES} failed deliveries.
     *
     * The first delivery carries the peer's actual edit; the rest are fresh
     * re-negotiations, because Automerge suppresses a peer's resend while its
     * own send is in flight and would otherwise decide when this stops.
     */
    async function driveToQuarantine(exchange: ReturnType<typeof setupLiveExchange>): Promise<void> {
        await exchange.deliverOne();
        exchange.deliverResend();
        exchange.deliverResend();
    }

    /**
     * Turns red on: the `replaceCrdtDoc({ id: docId, doc: restored_doc })`
     * rollback in `rollBackSyncedDocument`. Without it the repository keeps
     * the document `receiveSyncMessage` merged the peer's changes into and
     * then outdated, so it is no longer at its pre-sync heads.
     */
    it('should abort install and persistence when CrdtDocument sanitation fails', async () => {
        const { persistCrdtProject } = await import('#/modules/CrdtDocument/useCases');
        const exchange = setupLiveExchange();
        await exchange.connect();
        const heads_before_failure = exchange.currentHeads();
        // Recorded inside the sanitizer, so the test can say what the merge
        // had actually done by the time it failed.
        let merged_heads: Heads | null = null;
        vi.mocked(sanitizeIncomingCrdtDocument).mockImplementation((document) => {
            merged_heads = getHeads(document);
            throw new Error('sanitation failed');
        });

        await exchange.deliverOne();

        // The delivery genuinely merged the peer's edit — this is not an
        // empty handshake round that never moved the document.
        expect(merged_heads).not.toEqual(heads_before_failure);
        expect(command_mocks.sync_action_replay_metadata).not.toHaveBeenCalled();
        expect(persistCrdtProject).not.toHaveBeenCalled();
        // ...and that merge never becomes project truth: the document is back
        // at the heads it had before the peer's changes arrived.
        expect(exchange.currentHeads()).toEqual(heads_before_failure);
        expect(exchange.probeValue()).toBeUndefined();
        // Heads alone cannot tell a rollback from a receiver that installed
        // nothing: the pre-merge handle still reports pre-merge heads even
        // after `receiveSyncMessage` outdated it. Only a write discriminates.
        expect(() => exchange.applyLocalEdit('after rollback')).not.toThrow();
    });

    /**
     * Turns red on: the `for (let attempt = 0; attempt <
     * SANITATION_ATTEMPTS_PER_DELIVERY; ...)` loop in `receiveSync`. With a
     * single attempt the delivery is rolled back and the peer's edit is gone,
     * because Automerge will not re-offer changes it believes it delivered.
     *
     * The retry exists because the only reachable failure is a wasm
     * allocation fault inside a project-sized save/load — a property of the
     * moment. One of those must cost an extra attempt, not the peer's edit.
     */
    it('retries sanitation on the merged document in hand instead of dropping the delivery', async () => {
        const exchange = setupLiveExchange();
        await exchange.connect();
        vi.mocked(sanitizeIncomingCrdtDocument).mockImplementationOnce(() => {
            throw new Error('transient allocation fault');
        });

        await exchange.deliverOne();

        expect(vi.mocked(sanitizeIncomingCrdtDocument).mock.calls.length).toBe(2);
        expect(exchange.onSyncQuarantine).not.toHaveBeenCalled();
        expect(exchange.probeValue()).toBe(PEER_EDIT);
    });

    /**
     * Turns red on: `this.sanitationFailures.delete(...)` on the success path
     * of `receiveSync`. Without the reset the streak survives working
     * traffic, so isolated faults spread across a session accumulate into a
     * close that nothing recoverable caused.
     */
    it('clears the failure streak after a delivery that sanitizes', async () => {
        const exchange = setupLiveExchange();
        await exchange.connect();
        // Two failed deliveries — one short of the bound.
        vi.mocked(sanitizeIncomingCrdtDocument).mockImplementation(() => {
            throw new Error('sanitation failed');
        });
        await exchange.deliverOne();
        exchange.deliverResend();
        expect(exchange.onSyncQuarantine).not.toHaveBeenCalled();

        // One that works, then two more failures. Without the reset the
        // second of those would be the third in a row and close the channel.
        vi.mocked(sanitizeIncomingCrdtDocument).mockImplementation((document) => document);
        exchange.deliverResend();
        vi.mocked(sanitizeIncomingCrdtDocument).mockImplementation(() => {
            throw new Error('sanitation failed');
        });
        exchange.deliverResend();
        exchange.deliverResend();

        expect(exchange.onSyncQuarantine).not.toHaveBeenCalled();
    });

    /**
     * Turns red on: the `this.closeSyncChannel({ peerId, docId, error })` call
     * that fires once `failures >= MAX_SANITATION_FAILURES`. Without it the
     * channel never closes and a document this node cannot read costs a merge
     * and a project-sized save/load on every payload for the rest of the
     * session.
     */
    it('quarantines the channel once the sanitation bound is spent, leaving the document at its pre-sync heads', async () => {
        const exchange = setupLiveExchange();
        await exchange.connect();
        const pre_sync_heads = exchange.currentHeads();
        vi.mocked(sanitizeIncomingCrdtDocument).mockImplementation(() => {
            throw new Error('sanitation failed');
        });

        await exchange.deliverOne();
        expect(exchange.onSyncQuarantine).not.toHaveBeenCalled();
        expect(exchange.currentHeads()).toEqual(pre_sync_heads);
        exchange.deliverResend();
        expect(exchange.onSyncQuarantine).not.toHaveBeenCalled();
        expect(exchange.currentHeads()).toEqual(pre_sync_heads);
        exchange.deliverResend();

        expect(exchange.onSyncQuarantine).toHaveBeenCalledTimes(1);
        // Three deliveries, each given its two in-hand attempts.
        expect(vi.mocked(sanitizeIncomingCrdtDocument).mock.calls.length).toBe(6);
        // Never left outdated, and never carrying the content that failed.
        expect(exchange.currentHeads()).toEqual(pre_sync_heads);
        expect(() => exchange.applyLocalEdit('still editable')).not.toThrow();
    });

    /**
     * Turns red on: the `this.hooks.onSyncQuarantine?.(...)` call in
     * `closeSyncChannel`. A divergence nobody is told about is the outcome
     * this whole path exists to prevent, so a log line is not enough.
     */
    it('reports a quarantine as a session-level fault instead of only logging it', async () => {
        const exchange = setupLiveExchange();
        await exchange.connect();
        const failure = new Error('sanitation failed');
        vi.mocked(sanitizeIncomingCrdtDocument).mockImplementation(() => {
            throw failure;
        });

        await driveToQuarantine(exchange);

        expect(exchange.onSyncQuarantine).toHaveBeenCalledWith({ peerId: 'editor', docId: 'root', error: failure });
    });

    /**
     * Turns red on: the `if (this.quarantinedChannels.has(...)) { return; }`
     * drop at the top of `receiveSync`.
     *
     * The resend is built from a fresh SyncState on purpose. A payload the
     * peer generates mid-protocol is suppressed while a send is in flight, so
     * asserting on "the peer stops sending" would pass with the drop deleted.
     * This one is a delivery that genuinely arrives — proved by handing the
     * identical bytes to a peer that is not quarantined.
     */
    it('drops a further delivery on a quarantined channel before any Automerge work', async () => {
        const exchange = setupLiveExchange();
        await exchange.connect();
        vi.mocked(sanitizeIncomingCrdtDocument).mockImplementation(() => {
            throw new Error('sanitation failed');
        });
        await driveToQuarantine(exchange);
        expect(exchange.onSyncQuarantine).toHaveBeenCalledTimes(1);

        const attempts_before = vi.mocked(sanitizeIncomingCrdtDocument).mock.calls.length;
        const resend = exchange.resendFromPeer();
        exchange.sync.receiveSync({ peerId: 'editor', docId: 'root', syncMessageBase64: resend });

        expect(vi.mocked(sanitizeIncomingCrdtDocument).mock.calls.length).toBe(attempts_before);
        expect(exchange.onSyncQuarantine).toHaveBeenCalledTimes(1);

        // The same bytes from an open channel do reach sanitation, so the
        // assertion above is about the quarantine and not about a dead payload.
        exchange.sync.receiveSync({ peerId: 'healthy-peer', docId: 'root', syncMessageBase64: resend });
        expect(vi.mocked(sanitizeIncomingCrdtDocument).mock.calls.length).toBeGreaterThan(attempts_before);
    });

    /**
     * A closed channel is closed both ways — we stop generating for it too.
     *
     * Turns red on: the `if (this.quarantinedChannels.has(key)) { return; }`
     * guard at the top of `queueDocSyncToPeer`.
     */
    it('generates no further sync for a quarantined channel', async () => {
        const exchange = setupLiveExchange();
        await exchange.connect();
        vi.mocked(sanitizeIncomingCrdtDocument).mockImplementation(() => {
            throw new Error('sanitation failed');
        });
        await driveToQuarantine(exchange);
        expect(exchange.onSyncQuarantine).toHaveBeenCalledTimes(1);

        exchange.applyLocalEdit('work continues');
        exchange.peerManager.sendCrdtSync.mockClear();
        await exchange.notifyLocalChange();

        expect(exchange.peerManager.sendCrdtSync).not.toHaveBeenCalled();
    });

    /**
     * The control for the test above: an open channel does generate a sync
     * from the same local edit, so that assertion is about the quarantine.
     */
    it('still generates sync for an open channel after a local edit', async () => {
        const exchange = setupLiveExchange();
        await exchange.connect();

        exchange.applyLocalEdit('work continues');
        exchange.peerManager.sendCrdtSync.mockClear();
        await exchange.notifyLocalChange();

        expect(exchange.peerManager.sendCrdtSync).toHaveBeenCalled();
    });

    /**
     * Turns red on: `removePeer` no longer clearing `quarantinedChannels`.
     *
     * `handlePeerDisconnected` calls `removePeer` from the immediate path,
     * which also fires on the transient ICE `disconnected` state. Lifting the
     * quarantine there means every Wi-Fi flap replays the failing exchange —
     * a full merge plus a project-sized save/load on the main thread — and
     * re-arms the quarantine.
     */
    it('keeps a quarantine through a transient disconnect and reconnect', async () => {
        const exchange = setupLiveExchange();
        await exchange.connect();
        vi.mocked(sanitizeIncomingCrdtDocument).mockImplementation(() => {
            throw new Error('sanitation failed');
        });
        await driveToQuarantine(exchange);
        const attempts_before = vi.mocked(sanitizeIncomingCrdtDocument).mock.calls.length;

        // ICE drops and recovers without the peer ever going away.
        exchange.sync.removePeer('editor');
        exchange.sync.addPeer('editor');
        await settleSends();
        exchange.sync.receiveSync({
            peerId: 'editor',
            docId: 'root',
            syncMessageBase64: exchange.resendFromPeer(),
        });

        expect(vi.mocked(sanitizeIncomingCrdtDocument).mock.calls.length).toBe(attempts_before);
        expect(exchange.onSyncQuarantine).toHaveBeenCalledTimes(1);
        expect(exchange.onSyncQuarantineLifted).not.toHaveBeenCalled();
    });

    /**
     * Turns red on: the `this.quarantinedChannels.delete(key)` loop in
     * `forgetPeer`. Rejoining is the documented way out, so a peer that
     * really went away and came back must sync again.
     */
    it('lifts the quarantine when the peer is really gone, and syncs again after it rejoins', async () => {
        const exchange = setupLiveExchange();
        await exchange.connect();
        vi.mocked(sanitizeIncomingCrdtDocument).mockImplementation(() => {
            throw new Error('sanitation failed');
        });
        await driveToQuarantine(exchange);

        exchange.sync.forgetPeer('editor');
        vi.mocked(sanitizeIncomingCrdtDocument).mockImplementation((document) => document);
        // A rejoin is a fresh exchange on both sides, so the peer's edit is
        // offered again from scratch.
        const rejoin = createPeerSyncMessages({
            remote: exchange.peerDocument,
            local: exchange.currentDoc()!,
        });
        for (const syncMessageBase64 of rejoin) {
            exchange.sync.receiveSync({ peerId: 'editor', docId: 'root', syncMessageBase64 });
        }

        expect(exchange.onSyncQuarantineLifted).toHaveBeenCalledWith({ peerId: 'editor' });
        expect(exchange.probeValue()).toBe(PEER_EDIT);
    });

    /**
     * The document-death proof, from the local musician's side.
     *
     * `receiveSyncMessage` outdates the document it is handed, so a receiver
     * that returns without installing anything leaves the repository holding
     * an outdated handle — and every later `change()` against it throws
     * `RangeError: Attempting to change an outdated document`. One failed
     * message from one peer would stop the user editing their own project.
     *
     * Turns red on: the `replaceCrdtDoc` rollback in `rollBackSyncedDocument`.
     */
    it('keeps the document writable after a peer fails sanitation', async () => {
        const exchange = setupLiveExchange();
        await exchange.connect();
        vi.mocked(sanitizeIncomingCrdtDocument).mockImplementation(() => {
            throw new Error('sanitation failed');
        });

        await exchange.deliverOne();

        expect(() => exchange.applyLocalEdit('still editable')).not.toThrow();
        expect(exchange.probeValue()).toBe('still editable');
    });

    /**
     * The document-death proof, from the session's side.
     *
     * An outdated handle left in the repository kills every later sync for
     * that document, from any peer, inside `receiveSyncMessage`.
     *
     * Turns red on: the `replaceCrdtDoc` rollback in `rollBackSyncedDocument`.
     */
    it('keeps the document syncable by other peers after one peer fails sanitation', async () => {
        const exchange = setupLiveExchange();
        await exchange.connect();
        vi.mocked(sanitizeIncomingCrdtDocument).mockImplementation(() => {
            throw new Error('sanitation failed');
        });
        await exchange.deliverOne();

        // A second, well-behaved peer now syncs the same document.
        vi.mocked(sanitizeIncomingCrdtDocument).mockImplementation((document) => document);
        const current = exchange.currentDoc() as Doc<SeededDoc>;
        const healthy = change(clone<SeededDoc>(current, 'cccccccccccccccc'), (draft) => {
            draft.peerProbe = 'healthy edit';
        });
        const before_heads = exchange.currentHeads();
        for (const syncMessageBase64 of createPeerSyncMessages({ remote: healthy, local: current })) {
            exchange.sync.receiveSync({ peerId: 'healthy-peer', docId: 'root', syncMessageBase64 });
        }

        expect(exchange.currentHeads()).not.toEqual(before_heads);
        expect(exchange.probeValue()).toBe('healthy edit');
    });

    /**
     * Turns red on: the `beforeHeads.length === 0 && docId !== DOC_PREFIX_ROOT`
     * branch in `rollBackSyncedDocument` that calls `removeCrdtDoc`.
     *
     * A branch content document this sync minted has no pre-sync heads, so
     * `clone(view(mergedDoc, []))` installs a *real empty document* under that
     * branch id. It then appears in `getCrdtDocIds()`, is swept out to every
     * other peer, and is written to IndexedDB and the saved bundle by the next
     * persist — the branch exists, opens empty, and is saved that way.
     */
    it('rolls a document this sync created back to absence, not to an empty document', async () => {
        const exchange = setupLiveExchange({ docId: 'branch_feature', absentLocally: true });
        await exchange.connect();
        // The handshake round mints the document; the round that carries the
        // peer's content is the one that fails.
        vi.mocked(sanitizeIncomingCrdtDocument)
            .mockImplementationOnce((document) => document)
            .mockImplementation(() => {
                throw new Error('sanitation failed');
            });

        await exchange.deliver(4);

        expect(createCrdtDoc).toHaveBeenCalledWith('branch_feature');
        expect(removeCrdtDoc).toHaveBeenCalledWith('branch_feature');
        expect(exchange.currentDoc()).toBeUndefined();
    });

    it('drops a sync the canApplySync hook rejects', () => {
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        const canApplySync = vi.fn().mockReturnValue(false);
        const sync = new AutomergeSync(makePeerManager(), { canApplySync });

        sync.receiveSync({ peerId: 'peer-1', docId: 'root', syncMessageBase64: makeRealSyncMessage() });

        expect(canApplySync).toHaveBeenCalledWith('peer-1', 'root');
        expect(replaceCrdtDoc).not.toHaveBeenCalled();
    });

    it('applies a sync the canApplySync hook accepts', () => {
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        const canApplySync = vi.fn().mockReturnValue(true);
        const sync = new AutomergeSync(makePeerManager(), { canApplySync });

        sync.receiveSync({ peerId: 'peer-1', docId: 'root', syncMessageBase64: makeRealSyncMessage() });

        expect(replaceCrdtDoc).toHaveBeenCalled();
    });

    it('§fix-4 does not re-broadcast the repository change triggered while applying a remote sync', () => {
        // Capture the change callback registered on start().
        let changeCb: ((docId?: string) => void) | undefined;
        vi.mocked(subscribeToCrdtChanges).mockImplementation((cb) => {
            changeCb = cb;
            return () => {};
        });
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        // replaceCrdtDoc re-enters the change subscription synchronously, the
        // way the real repository does on a doc replace.
        vi.mocked(replaceCrdtDoc).mockImplementation(() => {
            changeCb?.('root');
        });

        const peerManager = { getConnectedPeerIds: vi.fn().mockReturnValue(['p2']), sendCrdtSync: vi.fn() };
        const sync = new AutomergeSync(peerManager);
        sync.start();

        sync.receiveSync({ peerId: 'p1', docId: 'root', syncMessageBase64: makeRealSyncMessage() });

        // The guard must suppress the echo: no sync generated back to peers
        // during the apply.
        expect(peerManager.sendCrdtSync).not.toHaveBeenCalled();
    });

    it('§fix-6 surfaces a persist failure via onPersistError', async () => {
        const { persistCrdtProject } = await import('#/modules/CrdtDocument/useCases');
        vi.mocked(persistCrdtProject).mockRejectedValueOnce(new Error('idb full'));
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        const onPersistError = vi.fn();
        const sync = new AutomergeSync(makePeerManager(), { onPersistError });

        sync.receiveSync({ peerId: 'p1', docId: 'root', syncMessageBase64: makeRealSyncMessage() });
        // Let the rejected persist promise settle.
        await Promise.resolve();
        await Promise.resolve();

        expect(onPersistError).toHaveBeenCalled();
    });

    it('stop() unsubscribes from changes and clears sync state', () => {
        const unsub = vi.fn();
        vi.mocked(subscribeToCrdtChanges).mockReturnValue(unsub);
        const sync = new AutomergeSync(makePeerManager());
        sync.start();

        sync.stop();

        expect(unsub).toHaveBeenCalledTimes(1);
    });

    it('stop() is safe to call before start()', () => {
        const sync = new AutomergeSync(makePeerManager());
        expect(() => sync.stop()).not.toThrow();
    });

    it('creates a known-but-absent doc before applying the received sync', () => {
        const doc = createAmDoc();
        vi.mocked(getCrdtDoc).mockReturnValueOnce(undefined).mockReturnValue(doc);
        const sync = new AutomergeSync(makePeerManager());

        sync.receiveSync({ peerId: 'editor', docId: 'root', syncMessageBase64: makeRealSyncMessage() });

        expect(createCrdtDoc).toHaveBeenCalledWith('root');
        expect(replaceCrdtDoc).toHaveBeenCalledWith({ id: 'root', doc });
    });

    it('drops a malformed sync message from a peer without throwing', () => {
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        const sync = new AutomergeSync(makePeerManager());
        const garbage = bytesToBase64(new Uint8Array([1, 2, 3]));

        expect(() => sync.receiveSync({ peerId: 'editor', docId: 'root', syncMessageBase64: garbage })).not.toThrow();
        expect(replaceCrdtDoc).not.toHaveBeenCalled();
    });

    it('handlePeerMessage forwards a crdt-sync message to receiveSync', () => {
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        const sync = new AutomergeSync(makePeerManager());

        sync.handlePeerMessage({
            peerId: 'editor',
            message: { type: 'crdt-sync', docId: 'root', data: makeRealSyncMessage() },
        });

        expect(replaceCrdtDoc).toHaveBeenCalledWith(expect.objectContaining({ id: 'root' }));
    });

    it('handlePeerMessage ignores non crdt-sync message types', () => {
        const sync = new AutomergeSync(makePeerManager());

        expect(() =>
            sync.handlePeerMessage({ peerId: 'p2', message: { type: 'peer-leave', peerId: 'p2' } })
        ).not.toThrow();
        expect(replaceCrdtDoc).not.toHaveBeenCalled();
    });

    it('addPeer sends the initial sync for the root doc to the new peer', async () => {
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        const peerManager = makePeerManager();
        const sync = new AutomergeSync(peerManager);

        sync.addPeer('p1');

        // Sends are ordered against actual delivery, so they settle on the
        // microtask queue rather than inside addPeer.
        await vi.waitFor(() => {
            expect(peerManager.sendCrdtSync).toHaveBeenCalledWith({
                peerId: 'p1',
                message: { type: 'crdt-sync', docId: 'root', data: expect.any(String) },
            });
        });
    });

    it('addPeer also syncs the branch metadata doc when it exists', async () => {
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        vi.mocked(hasCrdtDoc).mockReturnValue(true);
        const peerManager = makePeerManager();
        const sync = new AutomergeSync(peerManager);

        sync.addPeer('p1');

        await vi.waitFor(() => {
            const syncedDocIds = peerManager.sendCrdtSync.mock.calls.map((call: unknown[]) => {
                const [{ message }] = call as [{ message: { docId: string } }];
                return message.docId;
            });
            expect(syncedDocIds).toContain('__branches__');
        });
    });

    it('addPeer syncs branch content docs, skipping ids that are not branch-prefixed', async () => {
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        vi.mocked(getCrdtDocIds).mockReturnValue(['branch_a', 'other_doc']);
        const peerManager = makePeerManager();
        const sync = new AutomergeSync(peerManager);

        sync.addPeer('p1');

        await vi.waitFor(() => {
            const syncedDocIds = peerManager.sendCrdtSync.mock.calls.map((call: unknown[]) => {
                const [{ message }] = call as [{ message: { docId: string } }];
                return message.docId;
            });
            expect(syncedDocIds).toContain('branch_a');
        });
        const syncedDocIds = peerManager.sendCrdtSync.mock.calls.map((call: unknown[]) => {
            const [{ message }] = call as [{ message: { docId: string } }];
            return message.docId;
        });
        expect(syncedDocIds).not.toContain('other_doc');
    });

    it('addPeer is a no-op for a doc that does not exist locally yet', () => {
        vi.mocked(getCrdtDoc).mockReturnValue(undefined);
        const peerManager = makePeerManager();
        const sync = new AutomergeSync(peerManager);

        sync.addPeer('p1');

        expect(peerManager.sendCrdtSync).not.toHaveBeenCalled();
    });

    it('removePeer clears state for a peer without throwing, including for an unknown peer', () => {
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        const sync = new AutomergeSync(makePeerManager());
        sync.addPeer('p1');

        expect(() => sync.removePeer('p1')).not.toThrow();
        expect(() => sync.removePeer('ghost')).not.toThrow();
    });

    it('a bulk change with no docId hint syncs every connected peer via the full sweep', async () => {
        let changeCb: ((docId?: string) => void) | undefined;
        vi.mocked(subscribeToCrdtChanges).mockImplementation((cb) => {
            changeCb = cb;
            return () => {};
        });
        vi.mocked(getCrdtDoc).mockReturnValue(createAmDoc());
        const peerManager = { getConnectedPeerIds: vi.fn().mockReturnValue(['p2']), sendCrdtSync: vi.fn() };
        const sync = new AutomergeSync(peerManager);
        sync.start();

        changeCb?.(undefined);

        await vi.waitFor(() => {
            expect(peerManager.sendCrdtSync).toHaveBeenCalledWith({
                peerId: 'p2',
                message: expect.objectContaining({ docId: 'root' }),
            });
        });
    });
});
