import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { type Clip, type Track, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, resolveClipsWithComping } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, resetActionReplayAuthority, undo, redo } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { readSecondsAtBeat, readTempoAtBeat, tempoMapStore } from '#/modules/Transport/stores';

import { projectOfflineAudioClipPlaybacks } from '../projectOfflineAudioClipPlaybacks';
import { resolveTrackClipsWithComping } from '../resolveTrackClipsWithComping';

type Project = { tracks: { tracks: Track[] }; takeLanes: NonNullable<typeof takeLaneStore.value> };
const sourceClip: Clip = {
    id: 'source',
    trackId: 'track-1',
    name: 'Comp source',
    startBeat: 2,
    endBeat: 8,
    type: 'audio',
    audioBufferId: 'comp-source-buffer',
    audioOffsetSeconds: 0.5,
    audioOffsetBeats: 1,
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

const time = {
    projectBeatToSeconds: (beat: number) => readSecondsAtBeat({ beat }),
    resolveTempoAtBeat: (beat: number) => readTempoAtBeat({ beat }),
};

function snapshot() {
    const raw = getCrdtDoc<Project>('root');
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === 'track-1');
    if (!raw || !track) {
        throw new Error('split fixture requires raw document and projected track');
    }
    const live = resolveClipsWithComping(track.id, track.clips);
    const offline = resolveTrackClipsWithComping(track.id, raw.tracks.tracks[0]!.clips, raw.takeLanes, time);
    const playbacks = offline.flatMap((clip) =>
        projectOfflineAudioClipPlaybacks({
            clip,
            bufferDurationSeconds: 20,
            regionStartBeat: 0,
            regionStartSec: 0,
            durationSeconds: 20,
            compensationDelay: 0,
            ...time,
        })
    );
    return { raw, projected: { clips: track.clips, takeLanes: takeLaneStore.value }, live, offline, playbacks };
}

function spans(clips: readonly Clip[]) {
    return clips.map((clip) => [clip.startBeat, clip.endBeat]);
}
function seeks(clips: readonly Clip[]) {
    return clips.map((clip) => clip.audioOffsetSeconds);
}

describe('split comped audio #5048 typed split of a comped audio clip', () => {
    let stopProjectionBridge: () => void;
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('5048 split comp integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        stopProjectionBridge = setupProjectionBridge();
        projectCrdtToStores();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
    });
    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        stopProjectionBridge();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });
    it.each([
        { name: 'legacy beat depth', depth: { sourceOffsetBeats: 2 }, seconds: 1 },
        { name: 'canonical second depth', depth: { sourceOffsetBeats: 99, sourceOffsetSeconds: 1 }, seconds: 1 },
        { name: 'canonical zero', depth: { sourceOffsetBeats: 99, sourceOffsetSeconds: 0 }, seconds: 0 },
    ])('preserves both audible sides for $name', async ({ depth, seconds }) => {
        const entrySeconds = 0.5 + seconds;
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
                            name: 'Selected take',
                            startBeat: 2,
                            endBeat: 8,
                            selected: true,
                            ...depth,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 2, endBeat: 8, takeId: 'take-1' }],
                },
            ],
        });
        flushAutomergeStorageWrites();
        const before = snapshot();
        expect(before.raw.tracks.tracks[0]!.clips).toEqual(before.projected.clips);
        expect(before.raw.takeLanes).toEqual(before.projected.takeLanes);
        expect(spans(before.live)).toEqual([[2, 8]]);
        expect(spans(before.offline)).toEqual([[2, 8]]);
        expect(seeks(before.live)).toEqual([entrySeconds]);
        expect(seeks(before.offline)).toEqual([entrySeconds]);
        expect(
            before.playbacks.map((playback) => [playback.startSec, playback.bufferOffsetSec, playback.playDuration])
        ).toEqual([[1, entrySeconds, 5]]);
        await executeAppAction(
            { type: 'splitClip', payload: { clipId: 'source', beat: 4, rightClipId: 'right' } },
            { source: 'manual' }
        );
        flushAutomergeStorageWrites();
        const after = snapshot();
        expect(after.raw.tracks.tracks[0]!.clips).toEqual(after.projected.clips);
        expect(after.raw.takeLanes).toEqual(after.projected.takeLanes);
        expect(spans(after.projected.clips)).toEqual([
            [2, 4],
            [4, 8],
        ]);
        expect(spans(after.live)).toEqual([
            [2, 4],
            [4, 8],
        ]);
        expect(spans(after.offline)).toEqual([
            [2, 4],
            [4, 8],
        ]);
        expect(seeks(after.live)).toEqual([entrySeconds, entrySeconds + 1]);
        expect(seeks(after.offline)).toEqual([entrySeconds, entrySeconds + 1]);
        expect(
            after.playbacks.map((playback) => [playback.startSec, playback.bufferOffsetSec, playback.playDuration])
        ).toEqual([
            [1, entrySeconds, 1],
            [2, entrySeconds + 1, 4],
        ]);
        await undo();
        flushAutomergeStorageWrites();
        const restored = snapshot();
        expect(restored.raw.tracks.tracks[0]!.clips).toEqual(before.raw.tracks.tracks[0]!.clips);
        expect(restored.raw.takeLanes).toEqual(before.raw.takeLanes);
        expect(restored.projected.takeLanes).toEqual(before.projected.takeLanes);
        expect(restored.playbacks).toEqual(before.playbacks);
        await redo();
        flushAutomergeStorageWrites();
        const replayed = snapshot();
        expect(replayed.raw.tracks.tracks[0]!.clips).toEqual(after.raw.tracks.tracks[0]!.clips);
        expect(replayed.raw.takeLanes).toEqual(after.raw.takeLanes);
        expect(replayed.projected.takeLanes).toEqual(after.projected.takeLanes);
        expect(replayed.live).toEqual(after.live);
        expect(replayed.playbacks).toEqual(after.playbacks);
    });
});
