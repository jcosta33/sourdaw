import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { automationStore } from '#/modules/Automation/stores';
import { createAutomationLane, getAutomationLanes } from '#/modules/Automation/useCases';
import { defaultTransportState, playheadPositionRef, transportStore } from '#/modules/Transport/stores';

import { type Clip, createTrack } from '../../../models/Track';
import { clipboardStore } from '../../../stores/clipboardStore';
import { __resetGainEnvelopesForTest, getEnvelope, setEnvelope } from '../../../stores/gainEnvelopeStore';
import { trackStore, defaultTrackState } from '../../../stores/trackStore';
import { __resetWarpStatesForTest, getStoredWarpState, setWarpState } from '../../../stores/warpStates';
import { removeClip } from '../../clip/removeClip';
import { selectClip } from '../../clipSelection/selectClip';
import { copySelectedClip } from '../copySelectedClip';
import { pasteClip } from '../pasteClip';

/**
 * The clipboard payload must be self-contained: a paste rebuilds the clip from
 * what the copy captured, so the clip-id-keyed satellite records — the gain
 * envelope and the warp state — have to ride the snapshot taken at copy time.
 * The source clip may be deleted before the paste lands, so reading the live
 * stores at paste time cannot work; `duplicateClipCore` is the carry-over
 * contract these clones mirror.
 *
 * Take lanes are deliberately not part of the snapshot: they are track-scoped
 * comping state whose playback resolution follows the lane of the track the
 * clip sits on (`resolveClipsWithComping`), not a per-clip record, and
 * `duplicateClipCore` — the carry-over contract — does not clone them either.
 */

const PLAYHEAD_BEAT = 16;

function compedVocal(): Clip {
    return {
        id: 'c-comp',
        trackId: 't-vocal',
        name: 'Comp Vox',
        startBeat: 4,
        endBeat: 12,
        type: 'audio',
        audioBufferId: 'buffer-comp',
        audioOffsetBeats: 0,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
    };
}

function seedSourceWithSatellites(): void {
    const vocal = createTrack({ id: 't-vocal', name: 'Vocal', kind: 'audio' });
    trackStore.set({
        ...defaultTrackState,
        tracks: [{ ...vocal, clips: [compedVocal()] }],
        selectedTrackId: 't-vocal',
    });
    setEnvelope('c-comp', {
        clipId: 'c-comp',
        enabled: true,
        points: [
            { id: 'env-pt-1', beatOffset: 0, gainDb: -3 },
            { id: 'env-pt-2', beatOffset: 4, gainDb: 2 },
        ],
    });
    setWarpState('c-comp', {
        enabled: true,
        markers: [
            { id: 'warp-1', originalBeat: 0, warpedBeat: 0 },
            { id: 'warp-2', originalBeat: 4, warpedBeat: 4.5, origin: 'user' },
        ],
        stretchMode: 'repitch',
        originalTempo: 120,
    });
}

function seedSourceClipLane(): void {
    automationStore.set({
        lanes: [
            {
                ...createAutomationLane('t-vocal', 'volume', 'Volume', 0, 1, 'c-comp'),
                id: 'lane-src',
                points: [
                    { beat: 0, value: 1, curve: 'linear', tension: 0 },
                    { beat: 4, value: 0.25, curve: 'bezier', tension: 0.4, cp1: { x: 0.2, y: 0.3 } },
                ],
            },
        ],
    });
}

function copySource(): void {
    selectClip('c-comp');
    expect(copySelectedClip()).toBe(true);
}

function pastedCompClip(): Clip {
    const pasted = trackStore.value?.tracks
        .flatMap((track) => track.clips)
        .find((clip) => clip.name === 'Comp Vox (paste)');
    if (!pasted) {
        throw new Error('Expected a pasted clip on the vocal track');
    }
    return pasted;
}

describe('pasteClip carries the satellites captured at copy time', () => {
    let previousPlayhead = 0;

    beforeEach(() => {
        __resetGainEnvelopesForTest();
        __resetWarpStatesForTest();
        automationStore.set({ lanes: [] });
        seedSourceWithSatellites();
        transportStore.set(defaultTransportState);
        clipboardStore.set({ clipClipboard: [], noteClipboard: null });
        previousPlayhead = playheadPositionRef.current;
        playheadPositionRef.current = PLAYHEAD_BEAT;
    });

    afterEach(() => {
        playheadPositionRef.current = previousPlayhead;
        clipboardStore.set({ clipClipboard: [], noteClipboard: null });
        trackStore.set(structuredClone(defaultTrackState));
        automationStore.set({ lanes: [] });
        __resetGainEnvelopesForTest();
        __resetWarpStatesForTest();
    });

    it('clones the captured envelope and warp state onto the pasted clip id', () => {
        copySource();

        expect(pasteClip()).toBe(true);

        const pasted = pastedCompClip();

        const sourceEnvelope = getEnvelope('c-comp');
        const pastedEnvelope = getEnvelope(pasted.id);
        expect(pastedEnvelope).toBeDefined();
        if (!pastedEnvelope || !sourceEnvelope) {
            throw new Error('expected both envelopes to exist');
        }
        expect(pastedEnvelope.clipId).toBe(pasted.id);
        expect(pastedEnvelope.clipId).not.toBe('c-comp');
        expect(pastedEnvelope.enabled).toBe(sourceEnvelope.enabled);
        expect(pastedEnvelope.points).toEqual(sourceEnvelope.points);
        expect(pastedEnvelope.points[0]).not.toBe(sourceEnvelope.points[0]);

        const sourceWarp = getStoredWarpState('c-comp');
        const pastedWarp = getStoredWarpState(pasted.id);
        if (!pastedWarp || !sourceWarp) {
            throw new Error('expected both warp states to exist');
        }
        expect(pastedWarp).toEqual(sourceWarp);
        expect(pastedWarp.markers[0]).not.toBe(sourceWarp.markers[0]);
        // The clone must not steal the source's record: both clips play their own.
        expect(getEnvelope('c-comp')?.clipId).toBe('c-comp');
    });

    it('lands the satellites when the source clip was deleted after the copy', () => {
        // The snapshot is taken at copy time, so retiring the source must not
        // invalidate the clipboard entry and the paste must still land the
        // satellites it captured.
        copySource();

        removeClip('c-comp');
        expect(trackStore.value?.tracks.flatMap((track) => track.clips)).toHaveLength(0);

        expect(pasteClip()).toBe(true);

        const pasted = pastedCompClip();
        expect(getEnvelope(pasted.id)).toBeDefined();
        expect(getStoredWarpState(pasted.id)).toBeDefined();
    });

    it('clones the captured clip-scoped automation lane onto the pasted clip id', () => {
        // Clip-scoped lanes are the third clip-id-keyed satellite, and
        // `duplicateClipAutomation` is their carry-over contract: the paste
        // re-keys a clone onto the minted clip id the same way a duplicate
        // does, fed from the copy-time capture instead of the live store.
        seedSourceClipLane();
        copySource();

        expect(pasteClip()).toBe(true);

        const pasted = pastedCompClip();
        const sourceLane = getAutomationLanes().find((lane) => lane.clipId === 'c-comp');
        const pastedLanes = getAutomationLanes().filter((lane) => lane.clipId === pasted.id);
        expect(pastedLanes).toHaveLength(1);
        const pastedLane = pastedLanes[0]!;
        if (!sourceLane) {
            throw new Error('expected the source lane to exist');
        }
        expect(pastedLane.id).not.toBe(sourceLane.id);
        expect(pastedLane.trackId).toBe(sourceLane.trackId);
        expect(pastedLane.parameterId).toBe(sourceLane.parameterId);
        expect(pastedLane.points).toEqual(sourceLane.points);
        expect(pastedLane.points[0]).not.toBe(sourceLane.points[0]);
        // The clone must not steal the source's lane: both clips play their own.
        expect(sourceLane.clipId).toBe('c-comp');
        expect(getAutomationLanes()).toHaveLength(2);
    });

    it('lands the captured automation lane when the source clip was deleted after the copy', () => {
        seedSourceClipLane();
        copySource();

        removeClip('c-comp');
        // The removal retires the source's live lane with the clip; only the
        // clipboard snapshot still carries it.
        expect(getAutomationLanes().some((lane) => lane.clipId === 'c-comp')).toBe(false);

        expect(pasteClip()).toBe(true);

        const pasted = pastedCompClip();
        const pastedLanes = getAutomationLanes().filter((lane) => lane.clipId === pasted.id);
        expect(pastedLanes).toHaveLength(1);
        expect(pastedLanes[0]?.id).not.toBe('lane-src');
        expect(pastedLanes[0]?.points).toEqual([
            { beat: 0, value: 1, curve: 'linear', tension: 0 },
            { beat: 4, value: 0.25, curve: 'bezier', tension: 0.4, cp1: { x: 0.2, y: 0.3 } },
        ]);
    });
});
