import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { withProjectAudioStorageLock } from '#/infra/storage/withProjectAudioStorageLock';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { type Clip, type Track, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { commitRecording, getArrangementHandlers, resolveClipsWithComping } from '#/modules/Arrangement/useCases';
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

import { audioBufferCache } from '../../../stores/audioBufferCache';
import { projectOfflineAudioClipPlaybacks } from '../projectOfflineAudioClipPlaybacks';
import { renderTempoTimeline } from '../renderTempoTimeline';
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
    const offline = resolveTrackClipsWithComping(
        track.id,
        raw.tracks.tracks[0]!.clips,
        raw.takeLanes,
        renderTempoTimeline(time.projectBeatToSeconds, time.resolveTempoAtBeat)
    );
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
        const manager = createControlledLockManager();
        injectDependencies(withProjectAudioStorageLock, { resolveLockManager: () => manager.locks });
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
    afterEach(async () => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        stopProjectionBridge();
        if (audioBufferCache.has('comp-source-buffer')) {
            audioBufferCache.remove('comp-source-buffer');
            await withProjectAudioStorageLock(async () => undefined);
        }
        Container.clear();
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
        expect(after.raw.takeLanes.lanes[0]?.takes.filter((take) => take.selected).map((take) => take.id)).toEqual([
            'take-1',
        ]);
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
        expect(replayed.raw.takeLanes.lanes[0]?.takes.filter((take) => take.selected).map((take) => take.id)).toEqual([
            'take-1',
        ]);
        expect(replayed.raw.tracks.tracks[0]!.clips).toEqual(after.raw.tracks.tracks[0]!.clips);
        expect(replayed.raw.takeLanes).toEqual(after.raw.takeLanes);
        expect(replayed.projected.takeLanes).toEqual(after.projected.takeLanes);
        expect(replayed.live).toEqual(after.live);
        expect(replayed.playbacks).toEqual(after.playbacks);
    });
    it('keeps a genuinely placed later pass on both canonical stretched split fragments', async () => {
        tempoMapStore.set({
            changes: [
                { id: 'fast', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'slow', beat: 4, tempo: 60, curve: 'instant' },
            ],
        });
        const pcm = Float32Array.from({ length: 20_000 }, (_, index) => index);
        const buffer: AudioBuffer = {
            duration: 20,
            length: pcm.length,
            numberOfChannels: 1,
            sampleRate: 1000,
            getChannelData: () => pcm,
            copyFromChannel: (destination, _channel, offset = 0) =>
                destination.set(pcm.subarray(offset, offset + destination.length)),
            copyToChannel: (source, _channel, offset = 0) => pcm.set(source, offset),
        };
        audioBufferCache.set('comp-source-buffer', buffer);
        const clip: Clip = { ...sourceClip, stretchMode: 'repitch', stretchRatio: 1.5 };
        trackStore.set({ tracks: [{ ...sourceTrack, clips: [clip] }], selectedTrackId: 'track-1', ghostClips: [] });
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    takes: [
                        {
                            id: 'take-1',
                            clipId: clip.id,
                            name: 'Later recorded pass',
                            startBeat: 2,
                            endBeat: 8,
                            selected: true,
                            sourceOffsetBeats: 6,
                            sourceOffsetSeconds: 1,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 2, endBeat: 8, takeId: 'take-1' }],
                },
            ],
        });
        flushAutomergeStorageWrites();
        // The real capture terminal places the pass before the real command captures it.
        await commitRecording(clip, { provisionalStartBeat: 2, mediaOriginSeconds: 0.5 });
        flushAutomergeStorageWrites();
        projectCrdtToStores();
        expect(takeLaneStore.value?.lanes[0]?.takes[0]).toMatchObject({
            passAnchorSeconds: 0.5,
            passDepthSeconds: 5.5,
            sourceOffsetSeconds: 1,
        });
        const samplesAt = (state: ReturnType<typeof snapshot>, songSeconds: readonly number[]) =>
            songSeconds.map((second) => {
                const playback = state.playbacks.find(
                    (item) => item.startSec <= second && second < item.startSec + item.playDuration
                );
                const cached = audioBufferCache.get('comp-source-buffer');
                if (!playback || !cached) {
                    throw new Error('Expected audible cached PCM at the requested song second');
                }
                const frame = Math.round(
                    (playback.bufferOffsetSec + (second - playback.startSec) * playback.playbackRate) *
                        cached.sampleRate
                );
                return cached.getChannelData(0)[frame];
            });
        const before = snapshot();
        expect(seeks(before.live)).toEqual([5.5]);
        expect(seeks(before.offline)).toEqual([5.5]);
        expect(samplesAt(before, [1, 2, 4])).toEqual([5500, 7000, 10000]);
        clearUndoHistory();
        await executeAppAction(
            { type: 'splitClip', payload: { clipId: 'source', beat: 4, rightClipId: 'right' } },
            { source: 'manual' }
        );
        flushAutomergeStorageWrites();
        const after = snapshot();
        expect(spans(after.live)).toEqual([
            [2, 4],
            [4, 8],
        ]);
        expect(spans(after.offline)).toEqual([
            [2, 4],
            [4, 8],
        ]);
        expect(seeks(after.live)).toEqual([5.5, 7]);
        expect(seeks(after.offline)).toEqual([5.5, 7]);
        expect(samplesAt(after, [1, 2, 4])).toEqual(samplesAt(before, [1, 2, 4]));
        expect(
            after.raw.takeLanes.lanes[0]?.takes.map((take) => [take.passAnchorSeconds, take.passDepthSeconds])
        ).toEqual([
            [0.5, 5.5],
            [0.5, 5.5],
        ]);
        expect(
            after.playbacks.map((playback) => [playback.bufferOffsetSec, playback.playbackRate, playback.playDuration])
        ).toEqual([
            [5.5, 1.5, 1],
            [7, 1.5, 4],
        ]);
        await undo();
        flushAutomergeStorageWrites();
        expect(snapshot().raw.takeLanes).toEqual(before.raw.takeLanes);
        await redo();
        flushAutomergeStorageWrites();
        expect(snapshot().playbacks).toEqual(after.playbacks);
        await executeAppAction(
            { type: 'trimClipStart', payload: { clipId: 'right', newStartBeat: 5 } },
            { source: 'manual' }
        );
        flushAutomergeStorageWrites();
        const trimmed = snapshot();
        expect(seeks(trimmed.live)).toEqual([5.5, 8.5]);
        expect(seeks(trimmed.offline)).toEqual([5.5, 8.5]);
        expect(samplesAt(trimmed, [3, 4])).toEqual(samplesAt(before, [3, 4]));
        await executeAppAction(
            { type: 'moveClip', payload: { clipId: 'right', trackId: 'track-1', startBeat: 6 } },
            { source: 'manual' }
        );
        flushAutomergeStorageWrites();
        const moved = snapshot();
        expect(spans(moved.live)).toEqual([
            [2, 4],
            [6, 8],
            [8, 9],
        ]);
        expect(spans(moved.offline)).toEqual([
            [2, 4],
            [6, 8],
            [8, 9],
        ]);
        expect(seeks(moved.live)).toEqual([5.5, 8.5, 6.5]);
        expect(seeks(moved.offline)).toEqual([5.5, 8.5, 6.5]);
        expect(samplesAt(moved, [4, 5])).toEqual(samplesAt(trimmed, [3, 4]));
        expect(moved.raw.takeLanes).toEqual(trimmed.raw.takeLanes);
        await undo();
        flushAutomergeStorageWrites();
        expect(snapshot().playbacks).toEqual(trimmed.playbacks);
        await undo();
        flushAutomergeStorageWrites();
        expect(snapshot().playbacks).toEqual(after.playbacks);
    });
});
