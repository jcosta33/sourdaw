import { setImmediate } from 'node:timers/promises';

import { type Doc, change, clone, decodeSyncMessage, getHeads, init as automergeInit } from '@automerge/automerge';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { base64ToBytes } from '#/utils/base64';

type ProjectDocument = {
    edits: string[];
};

type SyncConstructor = typeof import('../automergeSync').AutomergeSync;
type SyncInstance = InstanceType<SyncConstructor>;

type WireEvent = {
    from: string;
    to: string;
    data: string;
    complete: () => void;
    completed: Promise<void>;
};

type Endpoint = {
    id: string;
    AutomergeSync: SyncConstructor;
    sync: SyncInstance;
    readDocument: () => Doc<ProjectDocument>;
};

type WireLog = {
    direction: string;
    phase: 'queued' | 'sent' | 'delivered';
    changes: number;
};

type TestWire = {
    wire: WireEvent[];
    events: WireLog[];
    outbound: (input: { from: string; to: string; data: string }) => Promise<void>;
};

const ROOT_DOCUMENT_ID = 'root';
const TRANSPORT_SAFETY_CEILING = 64;

function sortedHeads(document: Doc<unknown>): string[] {
    return [...getHeads(document)].map(String).toSorted();
}

function describeWireLog(events: readonly WireLog[]): string {
    return JSON.stringify(events);
}

/**
 * Loads one production AutomergeSync module with a repository closure that no
 * other endpoint can access. `vi.resetModules()` is deliberate: production
 * imports its CrdtDocument use-case barrel directly, so one module context
 * would otherwise turn two apparent endpoints into one repository.
 */
async function createEndpoint({
    id,
    peerIds,
    initialDocument,
    outbound,
    connectedPeerIds,
    persistProject,
    prepareSyncPersistence,
}: {
    id: string;
    peerIds: readonly string[];
    initialDocument: Doc<ProjectDocument>;
    outbound: (input: { from: string; to: string; data: string }) => Promise<void>;
    connectedPeerIds?: () => readonly string[];
    persistProject?: () => Promise<void>;
    prepareSyncPersistence?: () => Promise<undefined>;
}): Promise<Endpoint> {
    let document = initialDocument;
    const subscribers = new Set<(docId?: string) => void>();
    const persistCurrentProject = persistProject ?? (async () => undefined);

    vi.resetModules();
    vi.doMock('#/modules/Command/useCases', () => ({
        syncActionReplayMetadata: vi.fn(),
    }));
    vi.doMock('#/modules/CrdtDocument/useCases', () => ({
        subscribeToCrdtChanges: (subscriber: (docId?: string) => void) => {
            subscribers.add(subscriber);
            return () => subscribers.delete(subscriber);
        },
        getCrdtDoc: (docId: string) => (docId === ROOT_DOCUMENT_ID ? document : undefined),
        createCrdtDoc: () => {
            document = automergeInit<ProjectDocument>();
        },
        replaceCrdtDocInLineage: ({ id: docId, doc }: { id: string; doc: Doc<ProjectDocument> }) => {
            if (docId !== ROOT_DOCUMENT_ID) {
                throw new Error(`unexpected document replacement: ${docId}`);
            }
            document = doc;
            for (const subscriber of subscribers) {
                subscriber(docId);
            }
        },
        removeCrdtDoc: () => {
            throw new Error('the receive-progress fixture does not remove the root document');
        },
        hasCrdtDoc: () => false,
        getCrdtDocIds: () => [],
        persistCrdtProject: persistCurrentProject,
        runCrdtPersistenceBarrier: async (
            operation: (input: {
                persistCurrentProject: (expectedRootHeads?: readonly string[]) => Promise<unknown>;
            }) => Promise<void>
        ) => {
            let invoked = false;
            let result: unknown;
            await operation({
                persistCurrentProject: async (expectedRootHeads) => {
                    invoked = true;
                    try {
                        await persistCurrentProject();
                        result = {
                            status: 'settled',
                            mode: expectedRootHeads ? 'exact' : 'ordinary',
                            ...(expectedRootHeads ? { expectedRootHeads: [...expectedRootHeads] } : {}),
                            durable: {
                                write: 'noop',
                                authority: { epoch: 'test', revision: 1, rootLineage: 'main' },
                            },
                        };
                    } catch (error) {
                        result = { status: 'failed', durable: { write: 'none' }, error };
                    }
                    return result;
                },
            });
            return invoked ? result : { status: 'skipped', reason: 'operation-declined', durable: { write: 'none' } };
        },
        sanitizeIncomingCrdtDocument: (incoming: Doc<ProjectDocument>) => incoming,
        waitForCrdtDocumentTransition: () => null,
        DOC_PREFIX_ROOT: ROOT_DOCUMENT_ID,
        DOC_BRANCHES: '__branches__',
    }));

    const { AutomergeSync } = await import('../automergeSync');
    const sync = new AutomergeSync(
        {
            getConnectedPeerIds: () => [...(connectedPeerIds?.() ?? peerIds)],
            sendCrdtSync: ({ peerId: recipient, message }) => {
                if (message.type !== 'crdt-sync' || message.docId !== ROOT_DOCUMENT_ID) {
                    throw new Error('unexpected outbound collaboration message');
                }
                return outbound({ from: id, to: recipient, data: message.data });
            },
        },
        { prepareSyncPersistence }
    );
    sync.start();

    return {
        id,
        AutomergeSync,
        sync,
        readDocument: () => document,
    };
}

function createTestWire(): TestWire {
    const wire: WireEvent[] = [];
    const events: WireLog[] = [];
    return {
        wire,
        events,
        outbound: ({ from, to, data }) => {
            const deferred = Promise.withResolvers<void>();
            const changes = decodeSyncMessage(base64ToBytes(data)).changes.length;
            events.push({ direction: `${from}->${to}`, phase: 'queued', changes });
            wire.push({ from, to, data, complete: deferred.resolve, completed: deferred.promise });
            return deferred.promise;
        },
    };
}

async function drainTransport({
    endpoints,
    wire,
    events,
}: {
    endpoints: readonly Endpoint[];
    wire: WireEvent[];
    events: WireLog[];
}): Promise<void> {
    const endpointById = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));
    for (let delivery = 0; delivery < TRANSPORT_SAFETY_CEILING; delivery++) {
        // Persistence is the only public receive-completion signal. It does
        // not drain send queues, so one deterministic task checkpoint follows
        // it. This fixture controls every transport and persistence promise
        // and production generation has no timer, making the checkpoint a
        // drain of current promise continuations rather than a timing retry.
        await Promise.all(endpoints.map((endpoint) => endpoint.sync.flushPersistence()));
        await setImmediate();
        const next = wire.shift();
        if (!next) {
            return;
        }

        // `sendDocSyncToPeer` commits the generated SyncState after its
        // transport await. Complete the send before delivering it, as a data
        // channel does on its later receive task, so a reply cannot be
        // overwritten by the sender's stale post-await state.
        next.complete();
        await next.completed;
        const recipient = endpointById.get(next.to);
        if (!recipient) {
            throw new Error(`wire addressed an unknown endpoint: ${next.to}`);
        }
        const changes = decodeSyncMessage(base64ToBytes(next.data)).changes.length;
        events.push({ direction: `${next.from}->${next.to}`, phase: 'sent', changes });
        events.push({ direction: `${next.from}->${next.to}`, phase: 'delivered', changes });
        recipient.sync.receiveSync({ peerId: next.from, docId: ROOT_DOCUMENT_ID, syncMessageBase64: next.data });
    }
    throw new Error(
        `AutomergeSync transport did not settle within ${TRANSPORT_SAFETY_CEILING} deliveries: ${describeWireLog(events)}`
    );
}

describe('AutomergeSync receive progress', () => {
    afterEach(() => {
        vi.doUnmock('#/modules/Command/useCases');
        vi.doUnmock('#/modules/CrdtDocument/useCases');
        vi.resetModules();
    });

    it('advances two independently hosted documents after receiving their concurrent edits', async () => {
        const { wire, events, outbound } = createTestWire();

        const genesis = change(automergeInit<ProjectDocument>('aaaaaaaaaaaaaaaa'), (draft) => {
            draft.edits = [];
        });
        const left = await createEndpoint({
            id: 'left',
            peerIds: ['right'],
            initialDocument: change(clone(genesis, 'bbbbbbbbbbbbbbbb'), (draft) => {
                draft.edits.push('left edit');
            }),
            outbound,
        });
        const right = await createEndpoint({
            id: 'right',
            peerIds: ['left'],
            initialDocument: change(clone(genesis, 'cccccccccccccccc'), (draft) => {
                draft.edits.push('right edit');
            }),
            outbound,
        });

        try {
            expect(left.AutomergeSync).not.toBe(right.AutomergeSync);

            left.sync.addPeer('right');
            right.sync.addPeer('left');

            await drainTransport({ endpoints: [left, right], wire, events });

            const leftDocument = left.readDocument();
            const rightDocument = right.readDocument();
            expect(sortedHeads(leftDocument), `wire events: ${describeWireLog(events)}`).toEqual(
                sortedHeads(rightDocument)
            );
            expect([...leftDocument.edits].toSorted(), `wire events: ${describeWireLog(events)}`).toEqual([
                'left edit',
                'right edit',
            ]);
            expect([...rightDocument.edits].toSorted(), `wire events: ${describeWireLog(events)}`).toEqual([
                'left edit',
                'right edit',
            ]);
        } finally {
            left.sync.stop();
            right.sync.stop();
        }
    });

    it('relays a persisted sender edit to a survivor after the sender disconnects', async () => {
        const { wire, events, outbound } = createTestWire();
        const genesis = change(automergeInit<ProjectDocument>('aaaaaaaaaaaaaaaa'), (draft) => {
            draft.edits = [];
        });
        let hostPeerIds = ['sender', 'survivor'];
        const hostPersistenceEntered = Promise.withResolvers<void>();
        const releaseHostPersistence = Promise.withResolvers<void>();
        const host = await createEndpoint({
            id: 'host',
            peerIds: ['sender', 'survivor'],
            connectedPeerIds: () => hostPeerIds,
            initialDocument: clone(genesis, 'bbbbbbbbbbbbbbbb'),
            persistProject: async () => {
                if (host.readDocument().edits.includes('sender edit')) {
                    hostPersistenceEntered.resolve();
                    await releaseHostPersistence.promise;
                }
            },
            prepareSyncPersistence: async () => undefined,
            outbound,
        });
        const survivor = await createEndpoint({
            id: 'survivor',
            peerIds: ['host'],
            initialDocument: clone(genesis, 'cccccccccccccccc'),
            outbound,
        });
        const sender = await createEndpoint({
            id: 'sender',
            peerIds: ['host'],
            initialDocument: change(clone(genesis, 'dddddddddddddddd'), (draft) => {
                draft.edits.push('sender edit');
            }),
            outbound,
        });

        try {
            host.sync.addPeer('survivor');
            survivor.sync.addPeer('host');
            await drainTransport({ endpoints: [host, survivor], wire, events });
            expect(sortedHeads(host.readDocument())).toEqual(sortedHeads(survivor.readDocument()));

            host.sync.addPeer('sender');
            sender.sync.addPeer('host');
            let senderEditDelivered = false;
            for (let delivery = 0; delivery < TRANSPORT_SAFETY_CEILING; delivery++) {
                await Promise.all([
                    host.sync.flushPersistence(),
                    survivor.sync.flushPersistence(),
                    sender.sync.flushPersistence(),
                ]);
                await setImmediate();
                const next = wire.shift();
                if (!next) {
                    throw new Error(`sender edit never reached host: ${describeWireLog(events)}`);
                }
                next.complete();
                await next.completed;
                const recipient = new Map([
                    [host.id, host],
                    [survivor.id, survivor],
                    [sender.id, sender],
                ]).get(next.to);
                if (!recipient) {
                    throw new Error(`wire addressed an unknown endpoint: ${next.to}`);
                }
                const changes = decodeSyncMessage(base64ToBytes(next.data)).changes.length;
                events.push({ direction: `${next.from}->${next.to}`, phase: 'sent', changes });
                events.push({ direction: `${next.from}->${next.to}`, phase: 'delivered', changes });
                if (next.from === 'sender' && next.to === 'host' && changes > 0) {
                    senderEditDelivered = true;
                }
                recipient.sync.receiveSync({
                    peerId: next.from,
                    docId: ROOT_DOCUMENT_ID,
                    syncMessageBase64: next.data,
                });
                await setImmediate();
                if (senderEditDelivered && host.readDocument().edits.includes('sender edit')) {
                    break;
                }
            }
            expect(senderEditDelivered, `wire events: ${describeWireLog(events)}`).toBe(true);
            await hostPersistenceEntered.promise;

            hostPeerIds = ['survivor'];
            host.sync.removePeer('sender');
            const eventCountAtRelease = events.length;
            releaseHostPersistence.resolve();
            await drainTransport({ endpoints: [host, survivor, sender], wire, events });

            expect(sortedHeads(host.readDocument()), `wire events: ${describeWireLog(events)}`).toEqual(
                sortedHeads(survivor.readDocument())
            );
            expect(host.readDocument().edits).toEqual(['sender edit']);
            expect(survivor.readDocument().edits).toEqual(['sender edit']);
            expect(
                events
                    .slice(eventCountAtRelease)
                    .filter((event) => event.direction === 'host->sender' && event.phase === 'queued')
            ).toEqual([]);
        } finally {
            host.sync.stop();
            survivor.sync.stop();
            sender.sync.stop();
        }
    });

    it('relays an accepted joiner edit through the host to the other joiner', async () => {
        const { wire, events, outbound } = createTestWire();
        const genesis = change(automergeInit<ProjectDocument>('aaaaaaaaaaaaaaaa'), (draft) => {
            draft.edits = [];
        });
        const host = await createEndpoint({
            id: 'host',
            peerIds: ['joiner-a', 'joiner-b'],
            initialDocument: change(clone(genesis, 'bbbbbbbbbbbbbbbb'), (draft) => {
                draft.edits.push('host edit');
            }),
            outbound,
        });
        const joinerA = await createEndpoint({
            id: 'joiner-a',
            peerIds: ['host'],
            initialDocument: change(clone(genesis, 'cccccccccccccccc'), (draft) => {
                draft.edits.push('joiner-a edit');
            }),
            outbound,
        });
        const joinerB = await createEndpoint({
            id: 'joiner-b',
            peerIds: ['host'],
            initialDocument: change(clone(genesis, 'dddddddddddddddd'), (draft) => {
                draft.edits.push('joiner-b edit');
            }),
            outbound,
        });

        try {
            host.sync.addPeer('joiner-a');
            host.sync.addPeer('joiner-b');
            joinerA.sync.addPeer('host');
            joinerB.sync.addPeer('host');
            await drainTransport({ endpoints: [host, joinerA, joinerB], wire, events });

            const expectedEdits = ['host edit', 'joiner-a edit', 'joiner-b edit'];
            const hostHeads = sortedHeads(host.readDocument());
            expect(sortedHeads(joinerA.readDocument()), `wire events: ${describeWireLog(events)}`).toEqual(hostHeads);
            expect(sortedHeads(joinerB.readDocument()), `wire events: ${describeWireLog(events)}`).toEqual(hostHeads);
            expect([...host.readDocument().edits].toSorted(), `wire events: ${describeWireLog(events)}`).toEqual(
                expectedEdits
            );
            expect([...joinerA.readDocument().edits].toSorted(), `wire events: ${describeWireLog(events)}`).toEqual(
                expectedEdits
            );
            expect([...joinerB.readDocument().edits].toSorted(), `wire events: ${describeWireLog(events)}`).toEqual(
                expectedEdits
            );
        } finally {
            host.sync.stop();
            joinerA.sync.stop();
            joinerB.sync.stop();
        }
    });
});
