import { describe, expect, it } from 'vitest';

import {
    AutomergeStorageWriteConflictError,
    configureAutomergeStoragePort,
    createAutomergeStorage,
    resetAutomergeStorageProjections,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';

import { decodeExactTakeLaneSnapshots, sanitize_take_lane_store_state } from '../takeLaneStore';
import {
    captureCompSelection,
    captureTakeLaneWriteJournal,
    replayTakeLaneWriteJournal,
    appendTakeLaneWriteJournal,
    runWithTakeLaneWriteIntent,
} from '../takeLaneWriteJournal';

const audioSource = {
    startBeat: 1,
    audioOffsetSeconds: 2.5,
    audioLoopStartSeconds: 2.5,
    audioLoopPassEntrySeconds: 2.5,
    audioLoopPassOriginBeat: 1,
    loopOriginBeat: 1,
    loopLength: 4,
};
const region = { startBeat: 1, endBeat: 11, takeId: 'selected', audioSource };
const lane = {
    id: 'lane',
    trackId: 'audio',
    takes: [
        {
            id: 'selected',
            clipId: 'source',
            name: 'Selected',
            startBeat: 0,
            endBeat: 12,
            selected: false,
            sourceOffsetBeats: 4,
        },
    ],
    activeCompRegions: [region],
};

describe('audio comp source value snapshots', () => {
    it('journals complete base-gap source values and refuses a peer source edit atomically', () => {
        const before = { lanes: [{ ...lane, takes: [], activeCompRegions: [] }] };
        const after = {
            lanes: [
                {
                    ...before.lanes[0]!,
                    baseGapAudioSources: [{ clipId: 'source', startBeat: 1, endBeat: 11, audioSource }],
                },
            ],
        };
        const journalWire = JSON.stringify(captureTakeLaneWriteJournal({ beforeValue: before, nextValue: after }));
        expect(journalWire).toContain('"kind":"replace-base-gap-audio-sources"');
        expect(journalWire).toContain('"replacement":');
        expect(journalWire).toContain('"audioOffsetSeconds":2.5');
        const journal = JSON.parse(journalWire);
        expect(replayTakeLaneWriteJournal(before, journal)).toEqual({ status: 'applied', value: after });
        const inverse = captureTakeLaneWriteJournal({ beforeValue: after, nextValue: before });
        expect(replayTakeLaneWriteJournal(after, inverse)).toEqual({ status: 'applied', value: before });
        const peer = structuredClone(after);
        peer.lanes[0]!.baseGapAudioSources[0]!.audioSource.audioOffsetSeconds = 19;
        const untouched = structuredClone(peer);
        expect(replayTakeLaneWriteJournal(peer, inverse).status).toBe('conflict');
        expect(peer).toEqual(untouched);
    });

    it('replays only changed gap tiles while retaining a later independent peer tile and its array presence', () => {
        const owned = { clipId: 'source', startBeat: 1, endBeat: 11, audioSource };
        const peer = {
            clipId: 'peer-source',
            startBeat: 20,
            endBeat: 24,
            audioSource: { ...audioSource, startBeat: 20 },
        };
        const before = { lanes: [{ ...lane, baseGapAudioSources: [owned] }] };
        const after = { lanes: [lane] };
        const removal = captureTakeLaneWriteJournal({ beforeValue: before, nextValue: after });
        const authority = { lanes: [{ ...lane, baseGapAudioSources: [peer, owned] }] };
        const untouched = structuredClone(authority);
        const removed = { lanes: [{ ...lane, baseGapAudioSources: [peer] }] };
        expect(replayTakeLaneWriteJournal(authority, removal)).toEqual({ status: 'applied', value: removed });
        const inverse = captureTakeLaneWriteJournal({ beforeValue: after, nextValue: before });
        expect(replayTakeLaneWriteJournal(removed, inverse)).toEqual({ status: 'applied', value: authority });
        expect(authority).toEqual(untouched);
    });

    it('refuses a private comp intent borrowed by a sibling mutation owner before its real storage set', () => {
        const before = { lanes: [structuredClone(lane)] };
        const doc = { takeLanes: before };
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => changeFn(doc),
        });
        const storage = createAutomergeStorage<typeof before, ReturnType<typeof captureTakeLaneWriteJournal>>(
            'source-intent-owner',
            'takeLanes',
            {
                writeMetadata: {
                    capture: captureTakeLaneWriteJournal,
                    reduce: ({ current, captured }) => appendTakeLaneWriteJournal(current, captured),
                },
            }
        );
        try {
            expect(storage.hydrate?.()).toBe(true);
            const next = {
                lanes: [{ ...lane, takes: lane.takes.map((take) => ({ ...take, name: 'Borrowed write' })) }],
            };
            const outer = runWithAutomergeStorageTransaction(undefined, () =>
                runWithTakeLaneWriteIntent(
                    {
                        kind: 'comp-region-interval',
                        patch: {
                            laneId: lane.id,
                            trackId: lane.trackId,
                            startBeat: 1,
                            endBeat: 2,
                            expected: [],
                            replacement: [],
                        },
                        sourceAuthorizations: [],
                    },
                    () => runWithAutomergeStorageTransaction(undefined, () => storage.set(next))
                )
            );
            expect(outer.status).toBe('returned');
            if (outer.status !== 'returned') {
                throw new Error('Expected the outer owner to remain valid');
            }
            const sibling = outer.value;
            expect(sibling.status).toBe('threw');
            if (sibling.status !== 'threw') {
                throw new Error('Expected the borrowed capture to refuse synchronously');
            }
            expect(sibling.error).toBeInstanceOf(AutomergeStorageWriteConflictError);
            sibling.abort();
            outer.commit();
            expect(doc.takeLanes).toEqual(before);
            expect(storage.get()).toEqual(before);
        } finally {
            resetAutomergeStorageProjections('source-intent-owner');
            configureAutomergeStoragePort(null);
        }
    });

    it('retains source-bound base-gap tiles even when no takes or selections remain', () => {
        const tiled = {
            ...lane,
            takes: [],
            activeCompRegions: [],
            baseGapAudioSources: [{ clipId: 'source', startBeat: 1, endBeat: 11, audioSource }],
        };
        expect(decodeExactTakeLaneSnapshots([tiled])).toEqual([tiled]);
        expect(sanitize_take_lane_store_state({ lanes: [tiled] })).toEqual({ lanes: [tiled] });
    });

    it('preserves absent and explicitly empty base-gap tile arrays as different saved shapes', () => {
        const empty = { ...lane, baseGapAudioSources: [] };
        expect(decodeExactTakeLaneSnapshots([empty])).toEqual([empty]);
        expect(sanitize_take_lane_store_state({ lanes: [empty] })).toEqual({ lanes: [empty] });
        expect(decodeExactTakeLaneSnapshots([lane])).toEqual([lane]);
    });

    it('keeps an atomic original media origin on a placed pass through exact decode and projection', () => {
        const placed = {
            ...lane,
            activeCompRegions: [],
            takes: [
                {
                    ...lane.takes[0]!,
                    startBeat: 17,
                    endBeat: 29,
                    passAnchorSeconds: 10.5,
                    passDepthSeconds: 2,
                    passSourceEndSeconds: 6,
                    passOriginBeat: 17,
                    passOriginSourceSeconds: 8.5,
                },
            ],
        };
        expect(decodeExactTakeLaneSnapshots([placed])).toEqual([placed]);
        expect(sanitize_take_lane_store_state({ lanes: [placed] })).toEqual({ lanes: [placed] });
    });

    it.each([
        { passOriginBeat: 17 },
        { passOriginSourceSeconds: 8.5 },
        { passOriginBeat: 17, passOriginSourceSeconds: Number.NaN },
    ])('rejects an orphan or nonfinite placed media origin %j', (origin) => {
        const placed = {
            ...lane,
            activeCompRegions: [],
            takes: [
                { ...lane.takes[0]!, passAnchorSeconds: 10.5, passDepthSeconds: 2, passSourceEndSeconds: 6, ...origin },
            ],
        };
        expect(decodeExactTakeLaneSnapshots([placed])).toBeNull();
    });

    it('rejects a placed origin pair on a take with no physical pass placement', () => {
        expect(
            decodeExactTakeLaneSnapshots([
                { ...lane, takes: [{ ...lane.takes[0]!, passOriginBeat: 17, passOriginSourceSeconds: 8.5 }] },
            ])
        ).toBeNull();
    });

    it('retains the complete source basis through exact decode and normalized projection', () => {
        expect(decodeExactTakeLaneSnapshots([lane])).toEqual([lane]);
        expect(sanitize_take_lane_store_state({ lanes: [lane] })).toEqual({ lanes: [lane] });
    });

    it('preserves the source-entry beat when an Undo selection clips region geometry', () => {
        expect(captureCompSelection([region], 2, 3)).toEqual([{ ...region, startBeat: 2, endBeat: 3 }]);
    });

    it('keeps adjacent selections with different physical source grids separate', () => {
        const regions = [
            { ...region, endBeat: 3 },
            {
                startBeat: 3,
                endBeat: 5,
                takeId: region.takeId,
                audioSource: { ...audioSource, startBeat: 3, audioOffsetSeconds: 4, audioLoopPassOriginBeat: 3 },
            },
        ];
        expect(captureCompSelection(regions, 1, 5)).toEqual(regions);
    });

    it.each([
        'startBeat',
        'audioOffsetSeconds',
        'audioLoopStartSeconds',
        'audioLoopPassEntrySeconds',
        'audioLoopPassOriginBeat',
        'loopOriginBeat',
        'loopLength',
    ])('rejects an incomplete source value missing %s atomically', (key) => {
        const incomplete = Object.fromEntries(Object.entries(audioSource).filter(([field]) => field !== key));
        expect(
            decodeExactTakeLaneSnapshots([{ ...lane, activeCompRegions: [{ ...region, audioSource: incomplete }] }])
        ).toBeNull();
    });

    it.each([
        { ...audioSource, audioOffsetSeconds: Number.NaN },
        { ...audioSource, loopLength: 0 },
        { ...audioSource, audioLoopPassOriginBeat: Number.POSITIVE_INFINITY },
        { ...audioSource, foreign: 1 },
    ])('rejects a malformed source value %j atomically', (malformed) => {
        expect(
            decodeExactTakeLaneSnapshots([{ ...lane, activeCompRegions: [{ ...region, audioSource: malformed }] }])
        ).toBeNull();
    });
});
