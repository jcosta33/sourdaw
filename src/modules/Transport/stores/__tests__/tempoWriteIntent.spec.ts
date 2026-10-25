import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Container } from '#/infra/di/Container';
import {
    AutomergeStorageWriteConflictError,
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    resetAutomergeStorageProjections,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';

import { setTempo } from '../../useCases/setTempo';
import { tempoMapStore, type TempoMapStoreState } from '../tempoMapStore';
import { defaultTransportState, transportStore, type TransportState } from '../transportStore';
import {
    captureTempoWriteMetadata,
    runWithTempoSourcePreservation,
    runWithTempoWriteIntent,
    tempoWriteIntentsMatch,
} from '../tempoWriteIntent';
import { type TempoAudioSourcePromotionSnapshot } from '#/utils/handlerContract';

let document: Record<string, unknown> & { transport: TransportState; tempoMap: TempoMapStoreState };
const legacyPromotion: TempoAudioSourcePromotionSnapshot = {
    version: 1,
    clips: [
        {
            trackId: 'audio',
            collection: 'active',
            alternativeId: 'main',
            clipId: 'source',
            inputs: { startBeat: 0, endBeat: 12, audioOffsetBeats: 8, audioBufferId: 'buffer' },
            before: {},
            after: { audioOffsetSeconds: 4, audioUnwrappedOffsetSeconds: 4 },
        },
    ],
    takes: [],
    regions: [],
    gaps: [],
    gapFieldPresence: [],
};
function installLegacySource(): void {
    document.tracks = {
        tracks: [
            {
                id: 'audio',
                activeAlternativeId: 'main',
                alternatives: [],
                clips: [
                    {
                        id: 'source',
                        trackId: 'audio',
                        type: 'audio',
                        startBeat: 0,
                        endBeat: 12,
                        audioOffsetBeats: 8,
                        audioBufferId: 'buffer',
                    },
                ],
            },
        ],
    };
}

describe('private tempo scalar write intent', () => {
    beforeEach(() => {
        Container.clear();
        document = {
            transport: { ...defaultTransportState, tempo: 120 },
            tempoMap: {
                changes: [
                    { id: 'a', beat: 0, tempo: 120, curve: 'instant' },
                    { id: 'b', beat: 8, tempo: 150, curve: 'instant' },
                ],
            },
        };
        configureAutomergeStoragePort({
            getDoc: () => document,
            hasDoc: () => true,
            getSemanticMessage: () => undefined,
            mutateDoc: ({ changeFn }) => {
                const draft = structuredClone(document);
                changeFn(draft);
                document = draft;
            },
        });
        // Drop the module constructor's pre-backend seed before installing this document.
        resetAutomergeStorageProjections('root');
        transportStore.hydrate();
        tempoMapStore.hydrate();
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        Container.clear();
    });

    it.each(['transport-first', 'map-first'] as const)(
        'authenticates ordered repeated and different target writes with %s slot order',
        (order) => {
            const unrelatedTransport = () => transportStore.set({ ...transportStore.value!, countInBars: 2 });
            const unrelatedMap = () =>
                tempoMapStore.set({
                    changes: [...tempoMapStore.value!.changes, { id: 'peer', beat: 20, tempo: 95, curve: 'instant' }],
                });
            const transaction = runWithAutomergeStorageTransaction(undefined, () => {
                if (order === 'transport-first') {
                    unrelatedTransport();
                    unrelatedMap();
                } else {
                    unrelatedMap();
                    unrelatedTransport();
                }
                setTempo({ bpm: 240, tempoChangeId: null });
                setTempo({ bpm: 180, tempoChangeId: null });
                setTempo({ bpm: 130, tempoChangeId: 'a' });
                setTempo({ bpm: 160, tempoChangeId: 'b' });
                setTempo({ bpm: 140, tempoChangeId: 'a' });
            });
            transaction.commit();
            expect(document.transport).toMatchObject({ tempo: 180, countInBars: 2 });
            expect(document.tempoMap.changes).toEqual([
                { id: 'a', beat: 0, tempo: 140, curve: 'instant' },
                { id: 'b', beat: 8, tempo: 160, curve: 'instant' },
                { id: 'peer', beat: 20, tempo: 95, curve: 'instant' },
            ]);
            expect(tempoMapStore.value).toEqual(document.tempoMap);
            expect(transportStore.value?.tempo).toBe(180);
        }
    );

    it.each([undefined, null, '120', Number.NaN, 0, -120])(
        'refuses malformed raw base tempo %j without a default',
        (tempo) => {
            expect(
                tempoWriteIntentsMatch(
                    { transport: { tempo } },
                    [{ tempoChangeId: null, expectedBpm: 120, bpm: 240 }],
                    'transport'
                )
            ).toBe(false);
        }
    );

    it('refuses absent and duplicate named raw targets', () => {
        const intent = [{ tempoChangeId: 'a', expectedBpm: 120, bpm: 240 }];
        expect(tempoWriteIntentsMatch({ tempoMap: { changes: [] } }, intent, 'tempoMap')).toBe(false);
        expect(
            tempoWriteIntentsMatch(
                {
                    tempoMap: {
                        changes: [
                            { id: 'a', tempo: 120 },
                            { id: 'a', tempo: 120 },
                        ],
                    },
                },
                intent,
                'tempoMap'
            )
        ).toBe(false);
    });

    it('consumes no-op and throwing scopes without lending intent to a later ordinary write', () => {
        const intent = { tempoChangeId: null, expectedBpm: 99, bpm: 240 };
        runWithTempoWriteIntent(intent, () => undefined);
        expect(() =>
            runWithTempoWriteIntent(intent, () => {
                throw new Error('stop');
            })
        ).toThrow('stop');
        expect(captureTempoWriteMetadata('transport')).toBeNull();
        transportStore.set({ ...transportStore.value!, countInBars: 3 });
        flushAutomergeStorageWrites();
        expect(document.transport).toMatchObject({ tempo: 120, countInBars: 3 });
    });

    it('refuses capture by a sibling mutation owner and clears the pending intent', () => {
        runWithTempoWriteIntent({ tempoChangeId: null, expectedBpm: 120, bpm: 240 }, () => {
            const sibling = runWithAutomergeStorageTransaction(undefined, () => captureTempoWriteMetadata('transport'));
            expect(sibling.status).toBe('threw');
            if (sibling.status === 'threw') {
                expect(sibling.error).toBeInstanceOf(AutomergeStorageWriteConflictError);
            }
            sibling.abort();
        });
        expect(captureTempoWriteMetadata('transport')).toBeNull();
        expect(document.transport.tempo).toBe(120);
    });

    it('refuses capture at the wrong scalar slot without authorizing a later write', () => {
        expect(() =>
            runWithTempoWriteIntent({ tempoChangeId: null, expectedBpm: 120, bpm: 240 }, () =>
                captureTempoWriteMetadata('tempoMap')
            )
        ).toThrow(AutomergeStorageWriteConflictError);
        expect(captureTempoWriteMetadata('transport')).toBeNull();
    });

    it('reuses the existing root projection fence to discard a captured outgoing-project scalar write', () => {
        const transaction = runWithAutomergeStorageTransaction(undefined, () =>
            setTempo({ bpm: 240, tempoChangeId: null })
        );
        document = { transport: { ...defaultTransportState, tempo: 90 }, tempoMap: { changes: [] } };
        const incoming = document;
        resetAutomergeStorageProjections('root');
        transportStore.hydrate();
        tempoMapStore.hydrate();
        transaction.commit();
        expect(document).toBe(incoming);
        expect(transportStore.value?.tempo).toBe(90);
        expect(tempoMapStore.value).toEqual({ changes: [] });
        expect(captureTempoWriteMetadata('transport')).toBeNull();
    });

    it('never certifies raw legacy sources when the actual scalar writer has no admitted source context', () => {
        installLegacySource();
        const before = document;
        const transaction = runWithAutomergeStorageTransaction(undefined, () =>
            setTempo({ bpm: 240, tempoChangeId: null })
        );
        try {
            expect(() => transaction.commit()).toThrow(AutomergeStorageWriteConflictError);
        } finally {
            transaction.abort();
        }
        expect(document).toBe(before);
        expect(transportStore.value?.tempo).toBe(120);
    });

    it('binds private source context to the actual mutation owner and consumes no-op and thrown scopes', () => {
        const context = { promotion: legacyPromotion, direction: 'promote' as const, ownerWitness: { rows: [] } };
        runWithTempoSourcePreservation(context, () => undefined);
        expect(() =>
            runWithTempoSourcePreservation(context, () => {
                throw new Error('stop');
            })
        ).toThrow('stop');
        runWithTempoSourcePreservation(context, () => {
            const sibling = runWithAutomergeStorageTransaction(undefined, () =>
                setTempo({ bpm: 240, tempoChangeId: null })
            );
            expect(sibling.status).toBe('threw');
            if (sibling.status === 'threw') {
                expect(sibling.error).toBeInstanceOf(AutomergeStorageWriteConflictError);
            }
            sibling.abort();
        });
        expect(captureTempoWriteMetadata('transport')).toBeNull();
        expect(document.transport.tempo).toBe(120);
    });

    it('does not lend private source context across an await even to the same open mutation owner', async () => {
        installLegacySource();
        const before = document;
        const transaction = runWithAutomergeStorageTransaction(undefined, () => undefined);
        let release: () => void = () => undefined;
        const barrier = new Promise<void>((resolve) => {
            release = resolve;
        });
        const pending = transaction.scope(() =>
            runWithTempoSourcePreservation(
                { promotion: legacyPromotion, direction: 'promote', ownerWitness: { rows: [] } },
                async () => {
                    await barrier;
                    return transaction.scope(() => setTempo({ bpm: 240, tempoChangeId: null }));
                }
            )
        );
        release();
        await pending;
        try {
            expect(() => transaction.commit()).toThrow(AutomergeStorageWriteConflictError);
        } finally {
            transaction.abort();
        }
        expect(document).toBe(before);
        expect(transportStore.value?.tempo).toBe(120);
    });

    it.each(['transport', 'map'] as const)(
        'preserves ordinary %s unscoped-write supersession when there is no tempo intent',
        (slot) => {
            const write = (value: number) => {
                if (slot === 'transport') {
                    transportStore.set({ ...transportStore.value!, countInBars: value });
                } else {
                    tempoMapStore.set({
                        changes: tempoMapStore.value!.changes.map((change) =>
                            change.id === 'a' ? { ...change, beat: value } : change
                        ),
                    });
                }
            };
            const transaction = runWithAutomergeStorageTransaction(undefined, () => write(2));
            write(3);
            transaction.scope(() => write(4));
            transaction.commit();
            flushAutomergeStorageWrites();
            if (slot === 'transport') {
                expect(document.transport.countInBars).toBe(4);
                expect(transportStore.value?.countInBars).toBe(4);
            } else {
                expect(document.tempoMap.changes.find((change) => change.id === 'a')?.beat).toBe(4);
                expect(tempoMapStore.value?.changes.find((change) => change.id === 'a')?.beat).toBe(4);
            }
        }
    );
});
