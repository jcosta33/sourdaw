import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore, trackStore, type Clip, type Track } from '#/modules/Arrangement/stores';
import {
    commitRecording,
    getArrangementHandlers,
    resolveClipsWithComping,
    stageRecordingTake,
    startRecording,
} from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { type AppAction } from '#/utils/handlerContract';

import { resolveTrackClipsWithComping } from '../resolveTrackClipsWithComping';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

const TRACK_ID = 'track-audio';
const RECORD_POINT_BEAT = 1;
const LOOP_START_BEAT = 2;
const LOOP_END_BEAT = 6;
/** Beat 1 at 120 BPM: with no pre-roll or latency the capture begins on the record point. */
const MEDIA_ORIGIN_SECONDS = 0.5;

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function armedAudioTrack(): Track {
    return {
        id: TRACK_ID,
        name: 'Audio',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: true,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
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
}

function trackClips(): Clip[] {
    return trackStore.value?.tracks[0]?.clips ?? [];
}

async function dispatch(action: AppAction): Promise<void> {
    await executeAppAction(action);
    flushAutomergeStorageWrites();
}

/**
 * Loop [2,6) recorded from beat 1: the scheduler stages Take 2 a beat into
 * the capture, at the loop start, and Take 3 a loop later, then the capture's
 * terminal commits the clip and places both passes.
 */
async function recordLoop(): Promise<void> {
    const [provisional] = startRecording(RECORD_POINT_BEAT);
    if (!provisional) {
        throw new Error('Expected a provisional recording clip');
    }
    for (const [name, sourceOffsetBeats] of [
        ['Take 2', 1],
        ['Take 3', 5],
    ] as const) {
        stageRecordingTake({
            trackId: TRACK_ID,
            clipId: provisional.id,
            name,
            startBeat: LOOP_START_BEAT,
            endBeat: LOOP_END_BEAT,
            sourceOffsetBeats,
        });
    }
    await commitRecording(
        { ...provisional, audioBufferId: 'rec-buf', startBeat: RECORD_POINT_BEAT, endBeat: 10 },
        {
            provisionalStartBeat: RECORD_POINT_BEAT,
            mediaOriginSeconds: MEDIA_ORIGIN_SECONDS,
            sourceContextOriginSeconds: MEDIA_ORIGIN_SECONDS,
        }
    );
    flushAutomergeStorageWrites();
}

/** The media position, in beats, the resolved fragments sound at timeline `beat`, or null where none plays. */
function soundingAt(fragments: readonly Clip[], beat: number): number | null {
    const fragment = fragments.find((candidate) => candidate.startBeat <= beat && beat < candidate.endBeat);
    if (!fragment) {
        return null;
    }
    return beat - fragment.startBeat + (fragment.audioOffsetBeats ?? 0);
}

describe('a later loop pass once its clip’s content is slipped later', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('slipped loop pass integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        tempoMapStore.set({ changes: [] });
        transportStore.set({
            ...transportStore.value!,
            tempo: 120,
            playheadPosition: RECORD_POINT_BEAT,
            isLooping: true,
            loopStart: LOOP_START_BEAT,
            loopEnd: LOOP_END_BEAT,
        });
        trackStore.set({ tracks: [armedAudioTrack()], selectedTrackId: TRACK_ID, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    // Slipping the content three beats later moves Take 3's lap, two and a half
    // seconds into the media, to beat 5. Before it the pass has no material of
    // its own: what lies there is Take 2's lap, so the comp sounds nothing.
    it.each([
        { name: 'live', resolve: () => resolveClipsWithComping(TRACK_ID, trackClips()) },
        { name: 'offline', resolve: () => resolveTrackClipsWithComping(TRACK_ID, trackClips()) },
    ])('sounds Take 3 from its own lap only, $name', async ({ resolve }) => {
        await recordLoop();
        const clip = trackClips()[0];
        const take = takeLaneStore.value?.lanes[0]?.takes.find((candidate) => candidate.name === 'Take 3');
        if (!clip || !take) {
            throw new Error('Expected the committed clip and its Take 3 pass');
        }

        await dispatch({ type: 'slipClipContent', payload: { clipId: clip.id, clipType: 'audio', offset: -3 } });
        await dispatch({
            type: 'setCompRegion',
            payload: { trackId: TRACK_ID, takeId: take.id, startBeat: LOOP_START_BEAT, endBeat: LOOP_END_BEAT },
        });
        const fragments = resolve();

        expect([2, 3, 4, 4.99].map((beat) => soundingAt(fragments, beat))).toEqual([null, null, null, null]);
        expect(soundingAt(fragments, 5)).toBeCloseTo(5, 9);
        expect(soundingAt(fragments, 5.5)).toBeCloseTo(5.5, 9);
    });
});
