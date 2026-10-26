import * as Automerge from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, normalizeTrack, resolveClipsWithComping } from '#/modules/Arrangement/useCases';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    executeAppActionBatch,
    isAppActionConflictError,
    redo,
    registerProductionCommandHandlers,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    getDrumPreviewBranchHandlers,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    mutateCrdtDoc,
    projectCrdtToStores,
    replaceCrdtDocInLineage,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { getYeastHandlers } from '#/modules/Yeast/useCases';
import { projectAudioLoopPassSegments } from '#/utils/audioSourceTime';
import { type AppAction } from '#/utils/handlerContract';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { readSecondsAtBeat } from '../../../stores/readSecondsAtBeat';
import { readTempoAtBeat } from '../../../stores/readTempoAtBeat';
import { tempoMapStore } from '../../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../../stores/timeSignatureMapStore';
import { restoreTimelineMapSnapshot } from '../../restoreTimelineMapSnapshot';
import { defaultTransportState, transportStore } from '../../../stores/transportStore';
import { getTransportHandlers } from '../../getTransportHandlers';
import { addTempoChange } from '../addTempoChange';
import { removeTempoChange } from '../removeTempoChange';
import { replaceTempoMap } from '../replaceTempoMap';
import { updateTempoChange } from '../updateTempoChange';

function sourceEntry(): number {
    const clip = resolveClipsWithComping('audio', trackStore.value!.tracks[0]!.clips)[0];
    if (!clip) {
        throw new Error('Expected the actual audio programme');
    }
    const segment = projectAudioLoopPassSegments({
        clip,
        loopLengthBeats: clip.endBeat - clip.startBeat,
        iterationStartBeat: clip.startBeat,
        iterationEndBeat: clip.endBeat,
        stretchRatio: 1,
        tempoAtClipStart: readTempoAtBeat({ beat: clip.startBeat }),
        secondsAtBeat: (beat) => readSecondsAtBeat({ beat }),
    })[0];
    if (!segment) {
        throw new Error('Expected an audible source interval');
    }
    return segment.sourceStartSeconds;
}

describe('public tempo-map musical commands', () => {
    let disposeProjection: (() => void) | undefined;
    beforeEach(() => {
        Container.clear();
        setNotificationEventBus(
            createEventBus<{ 'ui.notify': NotifyPayload; 'ui.confirm': ConfirmPayload; 'ui.prompt': PromptPayload }>()
        );
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('tempo-map commands');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        clearUndoHistory();
        sessionStorage.removeItem('sourdaw-undo-session');
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        tempoMapStore.set({ changes: [] });
        takeLaneStore.set({ lanes: [] });
        trackStore.set({
            tracks: [
                normalizeTrack({
                    id: 'audio',
                    name: 'Audio',
                    kind: 'audio',
                    clips: [
                        {
                            id: 'source',
                            trackId: 'audio',
                            name: 'Distinct bursts',
                            type: 'audio',
                            startBeat: 0,
                            endBeat: 12,
                            audioBufferId: 'bursts',
                            audioOffsetBeats: 8,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                            gain: 1,
                            color: '',
                            locked: false,
                            muted: false,
                        },
                    ],
                }),
            ],
            selectedTrackId: 'audio',
            ghostClips: [],
        });
        flushAutomergeStorageWrites();
        disposeProjection = setupProjectionBridge();
        registerProductionCommandHandlers([
            getArrangementHandlers(),
            getAudioRenderingHandlers(),
            getAutomationHandlers(),
            getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
            getMidiNoteTransformHandlers(),
            getTransportHandlers(),
            getYeastHandlers(),
        ]);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        disposeProjection?.();
        disposeProjection = undefined;
        clearUndoHistory();
        clearHandlerRegistry();
        takeLaneStore.set({ lanes: [] });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        tempoMapStore.set({ changes: [] });
        transportStore.set(structuredClone(defaultTransportState));
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        Container.clear();
    });

    it.each(['add', 'update', 'remove', 'replace'] as const)(
        '%s publishes one row edit and preserves source through the real command owner',
        async (operation) => {
            if (operation === 'update' || operation === 'remove') {
                tempoMapStore.set({
                    changes: [
                        { id: 'head', beat: 0, tempo: 120, curve: 'instant' },
                        { id: 'tail', beat: 8, tempo: 240, curve: 'linear' },
                    ],
                });
            }
            flushAutomergeStorageWrites();
            const beforeRows = structuredClone(tempoMapStore.value!.changes);
            const beforeTracks = structuredClone(trackStore.value!.tracks);
            const beforeSource = sourceEntry();
            expect(beforeSource).toBe(4);
            if (operation === 'add') {
                await addTempoChange(0, 240, 'linear');
            } else if (operation === 'update') {
                await updateTempoChange('head', 240);
            } else if (operation === 'remove') {
                await removeTempoChange('head');
            } else {
                await replaceTempoMap({
                    changes: [
                        { beat: 16, tempo: 90, curve: 'linear' },
                        { beat: 0, tempo: 240, curve: 'instant' },
                    ],
                });
            }
            flushAutomergeStorageWrites();
            expect(getCrdtDoc('root')).toMatchObject({ tempoMap: tempoMapStore.value });
            expect.soft(undoHistoryStore.value?.past).toHaveLength(1);
            expect.soft(sourceEntry()).toBe(beforeSource);
            if (operation === 'add') {
                expect(tempoMapStore.value!.changes).toMatchObject([{ beat: 0, tempo: 240, curve: 'linear' }]);
            } else if (operation === 'update') {
                expect(tempoMapStore.value!.changes[0]).toEqual({ id: 'head', beat: 0, tempo: 240, curve: 'instant' });
            } else if (operation === 'remove') {
                expect(tempoMapStore.value!.changes.map((row) => row.id)).toEqual(['tail']);
            } else {
                expect(tempoMapStore.value!.changes.map((row) => row.beat)).toEqual([16, 0]);
            }
            const afterRows = structuredClone(tempoMapStore.value!.changes);
            const afterTracks = structuredClone(trackStore.value!.tracks);
            await vi.waitFor(() =>
                expect(JSON.parse(sessionStorage.getItem('sourdaw-undo-session') ?? '{}').past).toHaveLength(1)
            );
            const document = getCrdtDoc('root');
            if (!document) {
                throw new Error('Expected the real committed row edit');
            }
            replaceCrdtDocInLineage({ id: 'root', doc: Automerge.load(Automerge.save(document)) });
            projectCrdtToStores({ resetProjections: true });
            clearHandlerRegistry();
            registerProductionCommandHandlers([
                getArrangementHandlers(),
                getAudioRenderingHandlers(),
                getAutomationHandlers(),
                getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
                getMidiNoteTransformHandlers(),
                getTransportHandlers(),
                getYeastHandlers(),
            ]);
            expect(undoHistoryStore.value?.past).toHaveLength(1);
            expect((await undo()).headConsumed).toBe(true);
            // Cross-beat list order is not inverse authority; equal-beat order is.
            expect([...tempoMapStore.value!.changes].sort((a, b) => a.beat - b.beat)).toEqual(
                [...beforeRows].sort((a, b) => a.beat - b.beat)
            );
            expect(trackStore.value!.tracks).toEqual(beforeTracks);
            expect(sourceEntry()).toBe(beforeSource);
            await redo();
            expect(tempoMapStore.value!.changes).toEqual(afterRows);
            expect(trackStore.value!.tracks).toEqual(afterTracks);
            expect(sourceEntry()).toBe(beforeSource);
            expect(getCrdtDoc('root')).toMatchObject({ tempoMap: tempoMapStore.value });
        }
    );

    it('replays an actual negative-zero Add through the saved session without reminting its row', async () => {
        await addTempoChange(-0, 240);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        const rows = structuredClone(tempoMapStore.value!.changes);
        expect(rows).toHaveLength(1);
        await vi.waitFor(() =>
            expect(JSON.parse(sessionStorage.getItem('sourdaw-undo-session') ?? '{}').past).toHaveLength(1)
        );
        const document = getCrdtDoc('root');
        if (!document) {
            throw new Error('Expected the actual Add document');
        }
        replaceCrdtDocInLineage({ id: 'root', doc: Automerge.load(Automerge.save(document)) });
        projectCrdtToStores({ resetProjections: true });
        clearHandlerRegistry();
        registerProductionCommandHandlers([
            getArrangementHandlers(),
            getAudioRenderingHandlers(),
            getAutomationHandlers(),
            getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
            getMidiNoteTransformHandlers(),
            getTransportHandlers(),
            getYeastHandlers(),
        ]);
        expect((await undo()).headConsumed).toBe(true);
        expect(tempoMapStore.value!.changes).toEqual([]);
        await redo();
        expect(tempoMapStore.value!.changes).toEqual(rows);
        expect(sourceEntry()).toBe(4);
    });

    it.each([
        'coincident-clock',
        'owned-to',
        'owned-source-to',
        'owned-input',
        'late-legacy',
        'empty-late-legacy',
        'harmless',
    ] as const)('authenticates raw row and source FROM before a %s peer change', async (kind) => {
        const originalLegacy = structuredClone(trackStore.value!.tracks[0]!.clips[0]!);
        if (kind === 'empty-late-legacy') {
            const state = trackStore.value!;
            trackStore.set({
                ...state,
                tracks: state.tracks.map((track) => ({
                    ...track,
                    clips: track.clips.map((clip) => ({
                        ...clip,
                        audioOffsetSeconds: 4,
                        audioUnwrappedOffsetSeconds: 4,
                    })),
                })),
            });
        }
        tempoMapStore.set({ changes: [{ id: 'head', beat: 0, tempo: 120, curve: 'instant' }] });
        flushAutomergeStorageWrites();
        const legacy = originalLegacy;
        const set = tempoMapStore.set.bind(tempoMapStore);
        let peerDocument: ReturnType<typeof getCrdtDoc>;
        vi.spyOn(tempoMapStore, 'set').mockImplementationOnce((value) => {
            set(value);
            mutateCrdtDoc<{
                tempoMap: NonNullable<typeof tempoMapStore.value>;
                tracks: {
                    tracks: {
                        name: string;
                        clips: NonNullable<typeof trackStore.value>['tracks'][number]['clips'];
                    }[];
                };
            }>({
                id: 'root',
                changeFn: (doc) => {
                    if (kind === 'coincident-clock') {
                        doc.tempoMap.changes.push({ id: 'peer', beat: 0, tempo: 240, curve: 'instant' });
                    } else if (kind === 'owned-to') {
                        doc.tempoMap.changes[0]!.tempo = 240;
                    } else if (kind === 'owned-source-to') {
                        doc.tracks.tracks[0]!.clips[0]!.audioOffsetSeconds = 4;
                        doc.tracks.tracks[0]!.clips[0]!.audioUnwrappedOffsetSeconds = 4;
                    } else if (kind === 'owned-input') {
                        doc.tracks.tracks[0]!.clips[0]!.audioOffsetBeats = 10;
                    } else if (kind === 'late-legacy' || kind === 'empty-late-legacy') {
                        doc.tracks.tracks[0]!.clips.push({ ...structuredClone(legacy), id: 'late' });
                    } else {
                        doc.tempoMap.changes.push({ id: 'peer', beat: 20, tempo: 90, curve: 'linear' });
                        doc.tracks.tracks[0]!.name = 'Peer title';
                    }
                },
            });
            peerDocument = getCrdtDoc('root');
        });
        let failure: unknown;
        try {
            await updateTempoChange('head', 240);
        } catch (error) {
            failure = error;
        }
        if (kind === 'harmless') {
            expect(failure).toBeUndefined();
            expect(undoHistoryStore.value?.past).toHaveLength(1);
            expect(sourceEntry()).toBe(4);
            expect(tempoMapStore.value!.changes).toEqual([
                { id: 'head', beat: 0, tempo: 240, curve: 'instant' },
                { id: 'peer', beat: 20, tempo: 90, curve: 'linear' },
            ]);
            expect(trackStore.value!.tracks[0]!.name).toBe('Peer title');
        } else {
            expect(isAppActionConflictError(failure)).toBe(true);
            expect(getCrdtDoc('root')).toBe(peerDocument!);
            expect(undoHistoryStore.value?.past).toHaveLength(0);
            if (kind === 'empty-late-legacy' || kind === 'owned-source-to') {
                expect(trackStore.value!.tracks[0]!.clips[0]!.audioOffsetSeconds).toBe(4);
            } else {
                expect(trackStore.value!.tracks[0]!.clips[0]).not.toHaveProperty('audioOffsetSeconds');
            }
        }
        await vi.waitFor(() => {
            flushAutomergeStorageWrites();
            expect(getCrdtDoc('root')).toMatchObject({ tempoMap: tempoMapStore.value });
        });
    });
    it('keeps EPS arrival/head ordering, the default curve and unrelated rows through real Add', async () => {
        const rows = [
            { id: 'ramp', beat: 0, tempo: 100, curve: 'linear' as const },
            { id: 'arrival', beat: 4, tempo: 140, curve: 'instant' as const },
            { id: 'head', beat: 4, tempo: 160, curve: 'linear' as const },
            { id: 'end', beat: 8, tempo: 200, curve: 'instant' as const },
        ];
        tempoMapStore.set({ changes: rows });
        flushAutomergeStorageWrites();
        const entry = sourceEntry();
        await addTempoChange(4 + 1e-9, 150);
        expect(tempoMapStore.value!.changes).toEqual([
            rows[0],
            rows[1],
            { ...rows[2], tempo: 150, curve: 'instant' },
            rows[3],
        ]);
        expect(sourceEntry()).toBe(entry);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect((await undo()).headConsumed).toBe(true);
        expect(tempoMapStore.value!.changes).toEqual(rows);
    });

    it.each([
        [5, 20],
        [9999, 999],
        [90, 90],
    ])('retains update bounds %s→%s and unrelated row ownership', async (requested, expected) => {
        const tail = { id: 'tail', beat: 20, tempo: 140, curve: 'linear' as const };
        tempoMapStore.set({ changes: [{ id: 'head', beat: 0, tempo: 120, curve: 'instant' }, tail] });
        flushAutomergeStorageWrites();
        await updateTempoChange('head', requested);
        expect(tempoMapStore.value!.changes).toEqual([
            { id: 'head', beat: 0, tempo: expected, curve: 'instant' },
            tail,
        ]);
        expect(sourceEntry()).toBe(4);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
    });

    it('makes unchanged, missing-target and empty replacement gestures no-ops without history', async () => {
        tempoMapStore.set({ changes: [{ id: 'head', beat: 0, tempo: 120, curve: 'instant' }] });
        flushAutomergeStorageWrites();
        const original = getCrdtDoc('root');
        await addTempoChange(0, 120);
        await updateTempoChange('head', 120);
        await updateTempoChange('missing', 140);
        await removeTempoChange('missing');
        expect(getCrdtDoc('root')).toBe(original);
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        await removeTempoChange('head');
        expect(tempoMapStore.value!.changes).toEqual([]);
        expect((await undo()).headConsumed).toBe(true);
        expect(tempoMapStore.value!.changes).toEqual([{ id: 'head', beat: 0, tempo: 120, curve: 'instant' }]);
        clearUndoHistory();
        tempoMapStore.set({ changes: [] });
        flushAutomergeStorageWrites();
        await replaceTempoMap({ changes: [] });
        expect(undoHistoryStore.value?.past).toHaveLength(0);
    });

    it('refuses a mixed row batch before either row or scalar effect', async () => {
        const before = getCrdtDoc('root');
        const result = await executeAppActionBatch([
            { type: 'editTempoMap', payload: { edit: { type: 'add', beat: 0, tempo: 240 } } },
            { type: 'setTempo', payload: { bpm: 180 } },
        ]);
        expect(result.status).toBe('rejected');
        expect(result.actions).toEqual([]);
        expect(getCrdtDoc('root')).toBe(before);
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        expect(sourceEntry()).toBe(4);
    });

    it('derives fresh caller captures and preserves captured guards on Redo', async () => {
        const forgedAction: unknown = {
            type: 'editTempoMap',
            payload: {
                edit: { type: 'add', beat: 0, tempo: 240 },
                audioSourcePromotion: { clips: [], takes: [], regions: [], gaps: [] },
            },
        };
        await executeAppAction(forgedAction as AppAction);
        expect(sourceEntry()).toBe(4);
        expect((await undo()).headConsumed).toBe(true);
        const state = trackStore.value!;
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((clip) => ({ ...clip, audioOffsetBeats: 10 })),
            })),
        });
        flushAutomergeStorageWrites();
        const document = getCrdtDoc('root');
        const history = structuredClone(undoHistoryStore.value);
        await redo();
        expect(getCrdtDoc('root')).toBe(document);
        expect(undoHistoryStore.value).toEqual(history);
        expect(sourceEntry()).toBe(5);
    });

    it('restores target timeline maps without history or promoting outgoing legacy audio', () => {
        const meter = { changes: [{ id: 'target-meter', beat: 0, numerator: 6, denominator: 8 }] };
        restoreTimelineMapSnapshot({
            tempoMap: { changes: [{ id: 'target-row', beat: 0, tempo: 240, curve: 'linear' }] },
            timeSignatureMap: meter,
        });
        flushAutomergeStorageWrites();
        expect(timeSignatureMapStore.value).toEqual(meter);
        expect(tempoMapStore.value!.changes).toEqual([{ id: 'target-row', beat: 0, tempo: 240, curve: 'linear' }]);
        expect(trackStore.value!.tracks[0]!.clips[0]).not.toHaveProperty('audioOffsetSeconds');
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        expect(sourceEntry()).toBe(2);
    });

    it('leaves raw source, clock and history untouched if row ID construction throws', async () => {
        const document = getCrdtDoc('root');
        const uuid = vi
            .spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('12345678-1234-4123-8123-123456789abc')
            .mockImplementationOnce(() => {
                throw new Error('UUID failure');
            });
        await expect(
            replaceTempoMap({
                changes: [
                    { beat: 0, tempo: 90, curve: 'instant' },
                    { beat: 8, tempo: 72, curve: 'linear' },
                ],
            })
        ).rejects.toThrow('UUID failure');
        uuid.mockRestore();
        expect(getCrdtDoc('root')).toBe(document);
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        expect(sourceEntry()).toBe(4);
    });
});
