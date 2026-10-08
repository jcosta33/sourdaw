import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { type Clip, type Track, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import {
    getArrangementHandlers,
    isTempoAudioSourceTransition,
    prepareAudioSourcesForTempoChange,
    setTimeOperationDependencies,
} from '#/modules/Arrangement/useCases';
import { prepareAutomationTimeOperation, prepareAutomationTimeStateRestore } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, redo, resetActionReplayAuthority, undo } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { prepareMidiGlobalTimeTransaction, prepareMidiTimeStateRestore } from '#/modules/MIDI/useCases';
import { readSecondsAtBeat, readTempoAtBeat, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import {
    getTransportHandlers,
    prepareTimelineMapStateRestore,
    prepareTimelineMapTimeOperation,
    tempoSourceDependencies,
} from '#/modules/Transport/useCases';

import { projectOfflineAudioClipPlaybacks } from '../projectOfflineAudioClipPlaybacks';
import { resolveTrackClipsWithComping } from '../resolveTrackClipsWithComping';

type Project = {
    tracks: { tracks: Track[] };
    takeLanes: NonNullable<typeof takeLaneStore.value>;
};

const sourceClip: Clip = {
    id: 'source',
    trackId: 'track-1',
    name: 'Source',
    startBeat: 2,
    endBeat: 8,
    type: 'audio',
    audioBufferId: 'source-buffer',
    audioOffsetBeats: 99,
    audioOffsetSeconds: 0,
    fadeInBeats: 0,
    fadeOutBeats: 0,
    gain: 1,
    color: '#000',
    locked: false,
    muted: false,
};

const sourceTrack: Track = {
    id: 'track-1',
    name: 'Track',
    kind: 'audio',
    muted: false,
    soloed: false,
    armed: false,
    gain: 0.8,
    pan: 0,
    color: '#000',
    clips: [sourceClip],
    devices: [],
    sends: [],
    frozen: false,
    freezeState: { status: 'unfrozen' },
    parentId: null,
    collapsed: false,
    inputMonitoring: 'auto',
    hidden: false,
    disabled: false,
    height: 80,
    outputId: 'master',
    automationMode: 'read',
    groupId: null,
    soloSafe: false,
    notes: '',
    inputId: null,
    activeAlternativeId: 'alt-1',
    alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
    vcaGroupId: null,
    midiOutputTrackId: null,
    followChordTrack: false,
    midiFx: [],
};

describe('offline projection of inserted audio source', () => {
    let stopProjectionBridge: () => void;

    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('offline inserted audio source');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        stopProjectionBridge = setupProjectionBridge();
        projectCrdtToStores();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getTransportHandlers());
        tempoSourceDependencies.set({
            prepare: prepareAudioSourcesForTempoChange,
            isTransition: isTempoAudioSourceTransition,
        });
        clearUndoHistory();
        resetActionReplayAuthority();
        setTimeOperationDependencies({
            prepareAutomationTimeOperation,
            prepareAutomationTimeStateRestore,
            prepareMidiGlobalTimeTransaction,
            prepareMidiTimeStateRestore,
            prepareTimelineMapTimeOperation,
            prepareTimelineMapStateRestore,
        });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        stopProjectionBridge();
        configureAutomergeStoragePort(null);
        setTimeOperationDependencies(null);
        tempoSourceDependencies.set(null);
        removeCrdtDoc('root');
    });

    it('keeps the operation-produced comp media seek through base tempo Undo/Redo', async () => {
        tempoMapStore.set({ changes: [] });
        transportStore.set({ ...transportStore.value!, tempo: 120 });
        const { audioOffsetSeconds: _removed, ...legacy } = sourceClip;
        trackStore.set({
            tracks: [{ ...sourceTrack, clips: [{ ...legacy, audioOffsetBeats: 2 }] }],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    takes: [
                        {
                            id: 'take-1',
                            clipId: 'source',
                            name: 'Take',
                            startBeat: 2,
                            endBeat: 8,
                            selected: true,
                            sourceOffsetBeats: 2,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 2, endBeat: 8, takeId: 'take-1' }],
                },
            ],
        });
        flushAutomergeStorageWrites();

        const projectedSeek = (): number | undefined => {
            flushAutomergeStorageWrites();
            const raw = getCrdtDoc<Project>('root');
            expect(raw?.tracks.tracks[0]?.clips).toEqual(trackStore.value?.tracks[0]?.clips);
            expect(raw?.takeLanes).toEqual(takeLaneStore.value);
            const beatToSeconds = (beat: number): number => readSecondsAtBeat({ beat });
            const tempoAtBeat = (beat: number): number => readTempoAtBeat({ beat });
            const clip = resolveTrackClipsWithComping('track-1', raw!.tracks.tracks[0]!.clips, raw!.takeLanes, {
                projectBeatToSeconds: beatToSeconds,
                resolveTempoAtBeat: tempoAtBeat,
            })[0];
            expect(clip).toBeDefined();
            return projectOfflineAudioClipPlaybacks({
                clip: clip!,
                bufferDurationSeconds: 20,
                regionStartBeat: 0,
                regionStartSec: 0,
                durationSeconds: 20,
                compensationDelay: 0,
                projectBeatToSeconds: beatToSeconds,
                resolveTempoAtBeat: tempoAtBeat,
            })[0]?.bufferOffsetSec;
        };

        expect(projectedSeek()).toBe(2);
        await executeAppAction({ type: 'setTempo', payload: { bpm: 60 } });
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioOffsetSeconds).toBe(1);
        expect(takeLaneStore.value?.lanes[0]?.takes[0]?.sourceOffsetSeconds).toBe(1);
        expect(projectedSeek()).toBe(2);
        await undo();
        expect(trackStore.value?.tracks[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
        expect(takeLaneStore.value?.lanes[0]?.takes[0]).not.toHaveProperty('sourceOffsetSeconds');
        expect(projectedSeek()).toBe(2);
        await redo();
        expect(projectedSeek()).toBe(2);
    });

    it('keeps the operation-produced comp media seek through a tempo-map event edit', async () => {
        tempoMapStore.set({ changes: [] });
        transportStore.set({ ...transportStore.value!, tempo: 120 });
        const { audioOffsetSeconds: _removed, ...legacy } = sourceClip;
        trackStore.set({
            tracks: [{ ...sourceTrack, clips: [{ ...legacy, audioOffsetBeats: 2 }] }],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    takes: [
                        {
                            id: 'take-1',
                            clipId: 'source',
                            name: 'Take',
                            startBeat: 2,
                            endBeat: 8,
                            selected: true,
                            sourceOffsetBeats: 2,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 2, endBeat: 8, takeId: 'take-1' }],
                },
            ],
        });
        flushAutomergeStorageWrites();

        const projectedSeek = (): number | undefined => {
            flushAutomergeStorageWrites();
            const raw = getCrdtDoc<Project>('root');
            expect(raw?.tracks.tracks[0]?.clips).toEqual(trackStore.value?.tracks[0]?.clips);
            expect(raw?.takeLanes).toEqual(takeLaneStore.value);
            const beatToSeconds = (beat: number): number => readSecondsAtBeat({ beat });
            const tempoAtBeat = (beat: number): number => readTempoAtBeat({ beat });
            const clip = resolveTrackClipsWithComping('track-1', raw!.tracks.tracks[0]!.clips, raw!.takeLanes, {
                projectBeatToSeconds: beatToSeconds,
                resolveTempoAtBeat: tempoAtBeat,
            })[0];
            expect(clip).toBeDefined();
            return projectOfflineAudioClipPlaybacks({
                clip: clip!,
                bufferDurationSeconds: 20,
                regionStartBeat: 0,
                regionStartSec: 0,
                durationSeconds: 20,
                compensationDelay: 0,
                projectBeatToSeconds: beatToSeconds,
                resolveTempoAtBeat: tempoAtBeat,
            })[0]?.bufferOffsetSec;
        };

        expect(projectedSeek()).toBe(2);
        await executeAppAction({ type: 'addTempoMapChange', payload: { beat: 1, tempo: 60, curve: 'instant' } });
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioOffsetSeconds).toBe(1);
        expect(takeLaneStore.value?.lanes[0]?.takes[0]?.sourceOffsetSeconds).toBe(1);
        expect(projectedSeek()).toBe(2);
        await undo();
        expect(trackStore.value?.tracks[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
        expect(projectedSeek()).toBe(2);
        await redo();
        expect(projectedSeek()).toBe(2);
    });

    it.each([
        { name: 'Insert Time', action: { type: 'insertTime' as const, payload: { atBeat: 4, durationBeats: 2 } } },
        {
            name: 'Duplicate Time',
            action: { type: 'duplicateTimeRange' as const, payload: { startBeat: 2, endBeat: 4 } },
        },
    ])('$name carries the operation-produced right take into the offline buffer seek', async ({ action }) => {
        tempoMapStore.set({
            changes: [
                { id: 'fast', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'slow', beat: 4, tempo: 60, curve: 'instant' },
            ],
        });
        trackStore.set({ tracks: [sourceTrack], selectedTrackId: 'track-1', ghostClips: [] });
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    takes: [
                        {
                            id: 'take-1',
                            clipId: 'source',
                            name: 'Take',
                            startBeat: 2,
                            endBeat: 8,
                            selected: true,
                            sourceOffsetBeats: 2,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 2, endBeat: 8, takeId: 'take-1' }],
                },
            ],
        });
        flushAutomergeStorageWrites();

        await executeAppAction(action);
        flushAutomergeStorageWrites();
        const raw = getCrdtDoc<Project>('root');
        expect(raw?.tracks.tracks[0]?.clips).toEqual(trackStore.value?.tracks[0]?.clips);
        expect(raw?.takeLanes).toEqual(takeLaneStore.value);
        expect(raw?.tracks.tracks[0]?.clips.map((clip) => [clip.startBeat, clip.endBeat])).toEqual([
            [2, 4],
            [6, 10],
        ]);
        expect(tempoMapStore.value?.changes.map((change) => [change.beat, change.tempo])).toEqual([
            [0, 120],
            [6, 60],
        ]);
        const beatToSeconds = (beat: number): number => readSecondsAtBeat({ beat });
        const tempoAtBeat = (beat: number): number => readTempoAtBeat({ beat });
        const right = resolveTrackClipsWithComping('track-1', raw!.tracks.tracks[0]!.clips, raw!.takeLanes, {
            projectBeatToSeconds: beatToSeconds,
            resolveTempoAtBeat: tempoAtBeat,
        }).find((clip) => clip.startBeat === 6);
        expect(right?.audioOffsetSeconds).toBe(2);
        const playback = projectOfflineAudioClipPlaybacks({
            clip: right!,
            bufferDurationSeconds: 20,
            regionStartBeat: 0,
            regionStartSec: 0,
            durationSeconds: 20,
            compensationDelay: 0,
            projectBeatToSeconds: beatToSeconds,
            resolveTempoAtBeat: tempoAtBeat,
        });
        expect(playback[0]?.bufferOffsetSec).toBe(2);
    });
});
