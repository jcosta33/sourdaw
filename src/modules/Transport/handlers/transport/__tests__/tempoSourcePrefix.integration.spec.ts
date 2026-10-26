import * as Automerge from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { type Clip, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, normalizeTrack } from '#/modules/Arrangement/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, undoHistoryStore, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppActionBatch,
    redo,
    registerProductionCommandHandlers,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    getDrumPreviewBranchHandlers,
    mutateCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDocInLineage,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { getYeastHandlers } from '#/modules/Yeast/useCases';
import { type AppAction } from '#/utils/handlerContract';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { tempoMapStore } from '../../../stores/tempoMapStore';
import { defaultTransportState, transportStore } from '../../../stores/transportStore';
import { getTransportHandlers } from '../../../useCases/getTransportHandlers';
import { addTempoChange } from '../../../useCases/tempoMap/addTempoChange';

function source(id = 'source'): Clip {
    return {
        id,
        trackId: 'audio',
        name: 'Distinct bursts',
        type: 'audio',
        startBeat: 0,
        endBeat: 8,
        audioBufferId: 'bursts',
        audioOffsetBeats: 0,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
    };
}

function registerHandlers(): void {
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
}

function owners() {
    flushAutomergeStorageWrites();
    const tracks = structuredClone({ tracks: trackStore.value!.tracks });
    const document = getCrdtDoc('root');
    if (!document) {
        throw new Error('Expected the authoritative project');
    }
    const project = Automerge.toJS(document);
    // The owning track adapter writes `{ tracks }` through createAutomergeStorage's JSON-safe projection.
    expect(project.tracks).toEqual(tracks);
    const value = {
        tracks,
        takeLanes: structuredClone(takeLaneStore.value),
        transport: {
            tempo: transportStore.value!.tempo,
            timeSignatureNumerator: transportStore.value!.timeSignatureNumerator,
            timeSignatureDenominator: transportStore.value!.timeSignatureDenominator,
        },
        tempoMap: structuredClone(tempoMapStore.value),
    };
    expect(project).toMatchObject({
        takeLanes: value.takeLanes,
        transport: value.transport,
        tempoMap: value.tempoMap,
    });
    return value;
}

async function reopen(expectedEntries: number): Promise<void> {
    await vi.waitFor(() => {
        const saved = sessionStorage.getItem('sourdaw-undo-session');
        expect(saved).not.toBeNull();
        expect(JSON.parse(saved!).past).toHaveLength(expectedEntries);
    });
    const document = getCrdtDoc('root');
    if (!document) {
        throw new Error('Expected the real committed project');
    }
    replaceCrdtDocInLineage({ id: 'root', doc: Automerge.load(Automerge.save(document)) });
    projectCrdtToStores({ resetProjections: true });
    registerHandlers();
    expect(undoStore.value?.past).toHaveLength(expectedEntries);
}

function installCrossing(): void {
    const samples = new Float32Array(700).fill(1);
    samples.fill(-1, 251);
    const buffer: AudioBuffer = {
        getChannelData: () => samples,
        length: samples.length,
        numberOfChannels: 1,
        sampleRate: 100,
        duration: samples.length / 100,
        copyFromChannel: () => undefined,
        copyToChannel: () => undefined,
    } as AudioBuffer;
    vi.spyOn(audioBufferCache, 'get').mockReturnValue(buffer);
}

describe('ordered tempo and audio split source preparation', () => {
    beforeEach(() => {
        Container.clear();
        setNotificationEventBus(
            createEventBus<{ 'ui.notify': NotifyPayload; 'ui.confirm': ConfirmPayload; 'ui.prompt': PromptPayload }>()
        );
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('tempo split prefix');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        clearUndoHistory();
        sessionStorage.removeItem('sourdaw-undo-session');
        transportStore.set({ ...defaultTransportState, tempo: 120, playheadPosition: 0 });
        tempoMapStore.set({ changes: [] });
        takeLaneStore.set({ lanes: [] });
        trackStore.set({
            tracks: [normalizeTrack({ id: 'audio', name: 'Audio', kind: 'audio', clips: [source()] })],
            selectedTrackId: 'audio',
            ghostClips: [],
        });
        flushAutomergeStorageWrites();
        registerHandlers();
    });

    afterEach(() => {
        vi.restoreAllMocks();
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

    it('preserves source frame 4800 through a real three-row split and saved replay', async () => {
        trackStore.set({
            ...trackStore.value!,
            tracks: [
                normalizeTrack({
                    id: 'audio',
                    name: 'Audio',
                    kind: 'audio',
                    clips: [
                        {
                            ...source(),
                            endBeat: 1,
                            audioOffsetBeats: -0.2,
                            audioOffsetSeconds: -0.1,
                            audioUnwrappedOffsetSeconds: -0.1,
                        },
                    ],
                }),
            ],
        });
        flushAutomergeStorageWrites();
        await addTempoChange(0, 120);
        await addTempoChange(0.25, 240);
        await addTempoChange(0.45, 120);
        const before = owners();
        const result = await executeAppActionBatch(
            [
                {
                    type: 'splitClip',
                    payload: { clipId: 'source', beat: 0.5, resolvedBeat: 0.5, rightClipId: 'frame-right' },
                },
            ],
            { source: 'manual', requireCompensation: true }
        );
        expect(result.status).toBe('committed');
        const assertEntry = () => {
            const right = trackStore.value!.tracks[0]!.clips.find((clip) => clip.id === 'frame-right');
            const raw = getCrdtDoc<{ tracks: NonNullable<typeof trackStore.value> }>(
                'root'
            )?.tracks.tracks[0]?.clips.find((clip) => clip.id === 'frame-right');
            expect(right?.startBeat).toBe(0.5);
            expect(right?.audioOffsetSeconds).toBe(0.1);
            expect(raw?.audioOffsetSeconds).toBe(0.1);
            if (!right || right.audioOffsetSeconds === undefined) {
                throw new Error('Expected the actual physical right-fragment entry');
            }
            expect(right.audioOffsetSeconds * 48_000).toBe(4_800);
            expect(Math.floor(right.audioOffsetSeconds * 48_000)).toBe(4_800);
        };
        assertEntry();
        const after = owners();
        await reopen(4);
        assertEntry();
        expect((await undo()).headConsumed).toBe(true);
        expect(owners()).toEqual(before);
        await reopen(3);
        await redo();
        assertEntry();
        expect(owners()).toEqual(after);
    });

    it.each([
        ...['tempo-first', 'split-first'].flatMap((order) =>
            [false, true].map((grouped) => ({ order, grouped, undoClockFirst: false }))
        ),
        { order: 'tempo-first', grouped: true, undoClockFirst: true },
    ])(
        'pins geometry while preparing source at the actual prefix: $order grouped=$grouped undoClockFirst=$undoClockFirst',
        async ({ order, grouped, undoClockFirst }) => {
            installCrossing();
            const before = owners();
            const tempo: AppAction = { type: 'setTempo', payload: { bpm: 60 } };
            const split: AppAction = {
                type: 'splitClip',
                payload: { clipId: 'source', beat: 4, rightClipId: 'right' },
            };
            const actions: AppAction[] = order === 'tempo-first' ? [tempo, split] : [split, tempo];
            if (undoClockFirst) {
                actions.push({ type: 'setTimeSignature', payload: { numerator: 3, denominator: 4 } });
            }
            const result = await executeAppActionBatch(actions, {
                source: 'manual',
                requireCompensation: true,
                ...(grouped ? { groupId: 'tempo-and-split' } : {}),
            });
            expect(result.status).toBe('committed');
            const clips = trackStore.value!.tracks[0]!.clips;
            expect(clips).toMatchObject([
                { id: 'source', endBeat: 5 },
                { id: 'right', startBeat: 5, endBeat: 8 },
            ]);
            expect(clips[1]!.audioOffsetSeconds).toBe(order === 'tempo-first' ? 5 : 2.5);
            expect(transportStore.value?.tempo).toBe(60);
            const after = owners();
            await vi.waitFor(() => expect(undoStore.value?.past).toHaveLength(actions.length));
            const splitEntry = undoHistoryStore.value!.past.find(
                (entry) => entry.kind === 'action' && entry.action.type === 'splitClip'
            );
            expect(splitEntry?.kind).toBe('action');
            if (!splitEntry || splitEntry.kind !== 'action') {
                throw new Error('Expected the actual split history entry');
            }
            expect(splitEntry.inverseAction).toMatchObject({
                type: 'restoreClipSplitState',
                payload: { expected: { rightClip: clips[1] }, replacement: { rightClip: null } },
            });
            await reopen(actions.length);
            expect(owners()).toEqual(after);
            for (let count = 0; count < (grouped ? 1 : 2); count += 1) {
                expect((await undo()).headConsumed).toBe(true);
            }
            expect(owners()).toEqual(before);
            expect(trackStore.value!.tracks[0]!.clips[0]).not.toHaveProperty('audioOffsetSeconds');
            await reopen(0);
            for (let count = 0; count < (grouped ? 1 : 2); count += 1) {
                await redo();
            }
            expect(owners()).toEqual(after);
            await reopen(actions.length);
        }
    );

    it.each([false, true])('keeps an empty tempo capture complete with clock-first=%s', async (clockFirst) => {
        installCrossing();
        const before = owners();
        const actions: AppAction[] = [
            ...(clockFirst ? [{ type: 'setTimeSignature' as const, payload: { numerator: 3, denominator: 4 } }] : []),
            { type: 'splitClip', payload: { clipId: 'source', beat: 4, rightClipId: 'right' } },
            { type: 'setTempo', payload: { bpm: 60 } },
        ];
        const result = await executeAppActionBatch(actions, {
            source: 'manual',
            requireCompensation: true,
            groupId: 'empty-prefix',
        });
        expect(result.status).toBe('committed');
        expect(trackStore.value!.tracks[0]!.clips[1]).toMatchObject({
            id: 'right',
            startBeat: 5,
            audioOffsetSeconds: 2.5,
        });
        const after = owners();
        await reopen(actions.length);
        expect((await undo()).headConsumed).toBe(true);
        expect(owners()).toEqual(before);
        await redo();
        expect(owners()).toEqual(after);
    });

    it.each(['owned-source', 'tempo-to', 'late-legacy', 'late-canonical', 'cosmetic'] as const)(
        'authenticates raw %s after the real split/source capture and before commit',
        async (peer) => {
            installCrossing();
            let captured = false;
            let peerDocument: ReturnType<typeof getCrdtDoc> | undefined;
            const set = transportStore.set.bind(transportStore);
            vi.spyOn(transportStore, 'set').mockImplementation((state) => {
                const result = set(state);
                if (state?.tempo === 60) {
                    captured = true;
                }
                return result;
            });
            const result = await executeAppActionBatch(
                [
                    { type: 'setTimeSignature', payload: { numerator: 3, denominator: 4 } },
                    { type: 'splitClip', payload: { clipId: 'source', beat: 4, rightClipId: 'right' } },
                    { type: 'setTempo', payload: { bpm: 60 } },
                ],
                {
                    source: 'manual',
                    requireCompensation: true,
                    shouldExecute: () => {
                        if (captured && !peerDocument) {
                            mutateCrdtDoc<{ transport: { tempo: number }; tracks: { tracks: { clips: Clip[] }[] } }>({
                                id: 'root',
                                changeFn: (document) => {
                                    if (peer === 'tempo-to') {
                                        document.transport.tempo = 60;
                                    } else if (peer === 'owned-source') {
                                        document.tracks.tracks[0]!.clips[0]!.audioOffsetSeconds = 1;
                                        document.tracks.tracks[0]!.clips[0]!.audioUnwrappedOffsetSeconds = 1;
                                    } else if (peer === 'cosmetic') {
                                        document.tracks.tracks[0]!.clips[0]!.color = 'peer-blue';
                                    } else {
                                        document.tracks.tracks[0]!.clips.push({
                                            ...source('peer'),
                                            ...(peer === 'late-canonical'
                                                ? { audioOffsetSeconds: 0, audioUnwrappedOffsetSeconds: 0 }
                                                : {}),
                                        });
                                    }
                                },
                            });
                            peerDocument = getCrdtDoc('root');
                        }
                        return true;
                    },
                }
            );
            expect(captured).toBe(true);
            expect(peerDocument).toBeDefined();
            if (peer === 'late-canonical' || peer === 'cosmetic') {
                expect(result.status).toBe('committed');
                projectCrdtToStores({ resetProjections: true });
                if (peer === 'late-canonical') {
                    expect(trackStore.value!.tracks[0]!.clips.find((clip) => clip.id === 'peer')).toEqual({
                        ...source('peer'),
                        audioOffsetSeconds: 0,
                        audioUnwrappedOffsetSeconds: 0,
                    });
                } else {
                    expect(trackStore.value!.tracks[0]!.clips.find((clip) => clip.id === 'source')?.color).toBe(
                        'peer-blue'
                    );
                }
                owners();
            } else {
                if (peer === 'owned-source' && 'reason' in result) {
                    expect(result.reason).toContain('Audio source prefix owner changed before commit');
                }
                if (result.status === 'failed') {
                    // The existing time-signature handler declares guarded
                    // compensation but supplies no runtime compensation.
                    expect(result.reason).toContain(
                        'runtime compensation failed: Runtime compensation did not apply for setTimeSignature'
                    );
                } else {
                    expect(result.status).toBe('conflicted');
                }
                expect(getCrdtDoc('root')).toEqual(peerDocument);
                expect(undoHistoryStore.value?.past).toHaveLength(0);
                expect(undoHistoryStore.value?.future).toHaveLength(0);
                projectCrdtToStores({ resetProjections: true });
                expect(getCrdtDoc('root')).toEqual(peerDocument);
                owners();
            }
        }
    );

    it.each(['base', 'named'] as const)('captures ordered 120→240→180 against one %s target', async (target) => {
        if (target === 'named') {
            tempoMapStore.set({
                changes: [
                    { id: 'first', beat: 0, tempo: 120, curve: 'instant' },
                    { id: 'later', beat: 20, tempo: 90, curve: 'instant' },
                ],
            });
        }
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((clip) => ({ ...clip, audioOffsetBeats: 8 })),
            })),
        });
        const before = owners();
        const result = await executeAppActionBatch(
            [
                { type: 'setTempo', payload: { bpm: 240, tempoChangeId: target === 'base' ? null : 'first' } },
                { type: 'setTempo', payload: { bpm: 180, tempoChangeId: target === 'base' ? null : 'first' } },
            ],
            { source: 'manual', requireCompensation: true, groupId: 'ordered-tempo' }
        );
        expect(result.status).toBe('committed');
        const after = owners();
        expect(trackStore.value!.tracks[0]!.clips[0]!.audioOffsetSeconds).toBe(4);
        expect(target === 'base' ? transportStore.value!.tempo : tempoMapStore.value!.changes[0]!.tempo).toBe(180);
        if (target === 'named') {
            expect(tempoMapStore.value!.changes[1]).toEqual({ id: 'later', beat: 20, tempo: 90, curve: 'instant' });
        }
        await reopen(2);
        expect((await undo()).headConsumed).toBe(true);
        expect(owners()).toEqual(before);
        await reopen(0);
        await redo();
        expect(owners()).toEqual(after);
    });

    it.each(['same', 'different'] as const)(
        'retains both prepared splits for %s source owners through saved grouped replay',
        async (target) => {
            if (target === 'different') {
                trackStore.set({
                    ...trackStore.value!,
                    tracks: trackStore.value!.tracks.map((track) => ({
                        ...track,
                        clips: [
                            ...track.clips,
                            { ...source('second'), startBeat: 8, endBeat: 16, audioOffsetBeats: 4 },
                        ],
                    })),
                });
            }
            const before = owners();
            const result = await executeAppActionBatch(
                [
                    { type: 'setTempo', payload: { bpm: 60 } },
                    {
                        type: 'splitClip',
                        payload: { clipId: 'source', beat: 5, resolvedBeat: 5, rightClipId: 'right' },
                    },
                    {
                        type: 'splitClip',
                        payload: {
                            clipId: target === 'same' ? 'source' : 'second',
                            beat: target === 'same' ? 2 : 13,
                            resolvedBeat: target === 'same' ? 2 : 13,
                            rightClipId: 'other-right',
                        },
                    },
                ],
                { source: 'manual', requireCompensation: true, groupId: 'two-splits' }
            );
            expect(result.status).toBe('committed');
            expect(trackStore.value!.tracks[0]!.clips.find((clip) => clip.id === 'right')?.audioOffsetSeconds).toBe(5);
            expect(
                trackStore.value!.tracks[0]!.clips.find((clip) => clip.id === 'other-right')?.audioOffsetSeconds
            ).toBe(target === 'same' ? 2 : 7);
            const after = owners();
            await reopen(3);
            expect((await undo()).headConsumed).toBe(true);
            expect(owners()).toEqual(before);
            await reopen(0);
            await redo();
            expect(owners()).toEqual(after);
        }
    );

    it('derives a new preparation for reused forward objects after decline and a replacement root', async () => {
        const actions: AppAction[] = [
            { type: 'setTempo', payload: { bpm: 60 } },
            { type: 'splitClip', payload: { clipId: 'source', beat: 5, resolvedBeat: 5, rightClipId: 'right' } },
        ];
        const caller = structuredClone(actions);
        const before = owners();
        expect((await executeAppActionBatch(actions, { source: 'manual', shouldExecute: () => false })).status).toBe(
            'cancelled'
        );
        expect(owners()).toEqual(before);
        expect(actions).toEqual(caller);

        resetCrdtProjectAuthority('replacement prefix root');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearUndoHistory();
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        tempoMapStore.set({ changes: [] });
        takeLaneStore.set({ lanes: [] });
        trackStore.set({
            tracks: [
                normalizeTrack({
                    id: 'audio',
                    name: 'New audio owner',
                    kind: 'audio',
                    clips: [{ ...source(), audioBufferId: 'new-media', audioOffsetBeats: 6 }],
                }),
            ],
            selectedTrackId: 'audio',
            ghostClips: [],
        });
        const replacement = owners();
        expect(
            (
                await executeAppActionBatch(actions, {
                    source: 'manual',
                    requireCompensation: true,
                    groupId: 'fresh-prefix',
                })
            ).status
        ).toBe('committed');
        expect(trackStore.value!.tracks[0]!.clips.find((clip) => clip.id === 'right')).toMatchObject({
            audioBufferId: 'new-media',
            audioOffsetSeconds: 8,
        });
        expect(actions).toEqual(caller);
        await reopen(2);
        expect((await undo()).headConsumed).toBe(true);
        expect(owners()).toEqual(replacement);
    });

    it('preserves separate named scalar owners around a split and saved grouped replay', async () => {
        tempoMapStore.set({
            changes: [
                { id: 'head', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'later', beat: 8, tempo: 180, curve: 'instant' },
            ],
        });
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((clip) => ({ ...clip, audioOffsetBeats: 8 })),
            })),
        });
        const before = owners();
        const result = await executeAppActionBatch(
            [
                { type: 'setTempo', payload: { bpm: 240, tempoChangeId: 'head' } },
                { type: 'splitClip', payload: { clipId: 'source', beat: 5, resolvedBeat: 5, rightClipId: 'right' } },
                { type: 'setTempo', payload: { bpm: 90, tempoChangeId: 'later' } },
            ],
            { source: 'manual', requireCompensation: true, groupId: 'named-prefix' }
        );
        expect(result.status).toBe('committed');
        expect(trackStore.value!.tracks[0]!.clips.find((clip) => clip.id === 'right')?.audioOffsetSeconds).toBe(5.25);
        expect(tempoMapStore.value!.changes.map((row) => row.tempo)).toEqual([240, 90]);
        const after = owners();
        await reopen(3);
        expect((await undo()).headConsumed).toBe(true);
        expect(owners()).toEqual(before);
        await reopen(0);
        await redo();
        expect(owners()).toEqual(after);
    });

    it('retains the selected programme, gaps and unselected take capture across a grouped tempo/split cycle', async () => {
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane',
                    trackId: 'audio',
                    takes: [
                        {
                            id: 'selected',
                            clipId: 'source',
                            name: 'Selected',
                            startBeat: 0,
                            endBeat: 8,
                            selected: true,
                            sourceOffsetBeats: 2,
                        },
                        {
                            id: 'future',
                            clipId: 'source',
                            name: 'Future',
                            startBeat: 0,
                            endBeat: 8,
                            selected: false,
                            sourceOffsetBeats: 4,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 1, endBeat: 7, takeId: 'selected' }],
                },
            ],
        });
        const before = owners();
        const result = await executeAppActionBatch(
            [
                { type: 'setTempo', payload: { bpm: 60 } },
                { type: 'splitClip', payload: { clipId: 'source', beat: 5, resolvedBeat: 5, rightClipId: 'right' } },
            ],
            { source: 'manual', requireCompensation: true, groupId: 'comp-prefix' }
        );
        expect(result.status).toBe('committed');
        const lane = takeLaneStore.value!.lanes[0]!;
        expect(lane.takes.find((take) => take.id === 'future')?.sourceOffsetSeconds).toBe(2);
        expect(lane.activeCompRegions).toHaveLength(2);
        expect(lane.activeCompRegions.every((region) => region.audioSource !== undefined)).toBe(true);
        expect(lane.baseGapAudioSources).toHaveLength(2);
        const after = owners();
        await reopen(2);
        expect((await undo()).headConsumed).toBe(true);
        expect(owners()).toEqual(before);
        expect(undoHistoryStore.value?.future).toHaveLength(2);
        await reopen(0);
        await redo();
        expect(owners()).toEqual(after);
        expect(undoHistoryStore.value?.past).toHaveLength(2);
    });

    it('refuses an unsupported overlapping comp prefix before either owner executes', async () => {
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane',
                    trackId: 'audio',
                    takes: [
                        {
                            id: 'future',
                            clipId: 'source',
                            name: 'Future',
                            startBeat: 0,
                            endBeat: 8,
                            selected: false,
                            sourceOffsetBeats: 4,
                        },
                    ],
                    activeCompRegions: [],
                },
            ],
        });
        const before = owners();
        const comp = vi.spyOn(getArrangementHandlers().setCompRegion, 'execute');
        const tempo = vi.spyOn(getTransportHandlers().setTempo, 'execute');
        const result = await executeAppActionBatch(
            [
                { type: 'setCompRegion', payload: { trackId: 'audio', startBeat: 1, endBeat: 7, takeId: 'future' } },
                { type: 'setTempo', payload: { bpm: 60 } },
            ],
            { source: 'manual', requireCompensation: true }
        );
        expect(result.status).toBe('conflicted');
        expect(comp).not.toHaveBeenCalled();
        expect(tempo).not.toHaveBeenCalled();
        expect(owners()).toEqual(before);
        expect(undoHistoryStore.value?.past).toHaveLength(0);
    });
});
