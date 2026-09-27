import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ClipSatelliteEntrySnapshot, type TrackClipStateSnapshot } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { __resetGainEnvelopesForTest } from '../../../stores/gainEnvelopeStore';
import { type Clip, type Track } from '../../../stores/trackStore';
import { __resetWarpStatesForTest, setWarpState, warpStates } from '../../../stores/warpStates';
import { handleRestoreTrackClipStates } from '../handleRestoreTrackClipStates';

/**
 * The satellite guard replays a recorded `restoreTrackClipStates` envelope
 * against the live stores. A pre-ADR 0024 build recorded warp satellites under
 * legacy stretch-mode ids; the widened wire schema admits them, the write path
 * decodes them onto the canonical set, and the guard must compare the same
 * decode — refusing the raw id would conflict every undo of such a session
 * while the write it guards would have normalized the payload happily.
 */

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    updateTrack: vi.fn(),
    restoreMidiClipData: vi.fn(),
    applyClipAutomationLaneTransition: vi.fn(() => true),
    restoreTakesForClip: vi.fn(),
    removeTakesForClips: vi.fn(),
    takeLaneStore: { value: null as { lanes: readonly unknown[] } | null },
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    restoreMidiClipData: mocks.restoreMidiClipData,
}));

vi.mock('../../../useCases/clip/applyClipAutomationLaneTransition', () => ({
    applyClipAutomationLaneTransition: mocks.applyClipAutomationLaneTransition,
}));

vi.mock('../../../useCases/comping/restoreTakesForClip', () => ({
    restoreTakesForClip: mocks.restoreTakesForClip,
}));

vi.mock('../../../useCases/comping/removeTakesForClips', () => ({
    removeTakesForClips: mocks.removeTakesForClips,
}));

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: mocks.takeLaneStore,
}));

function trackFields() {
    return {
        kind: 'audio',
        devices: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
    } satisfies Partial<Track>;
}

function clipsFor(trackId: string, clipIds: readonly string[]): Clip[] {
    return clipIds.map((id) => ClipDummy.create({ id, trackId }));
}

function snapshotFor(
    trackId: string,
    clipIds: readonly string[],
    overrides?: Partial<TrackClipStateSnapshot>
): TrackClipStateSnapshot {
    return {
        trackId,
        clips: clipsFor(trackId, clipIds),
        trackFields: trackFields(),
        midiNotesByClipId: {},
        midiCcByClipId: {},
        midiPitchBendByClipId: {},
        clipSatellites: [],
        clipAutomationLanes: [],
        ...overrides,
    };
}

function liveTrack(trackId: string, clipIds: readonly string[]): Track {
    return TrackDummy.create({ id: trackId, clips: clipsFor(trackId, clipIds), ...trackFields() });
}

/** A warp satellite exactly as a pre-ADR build recorded it: the legacy id the
 *  widened wire union still admits, canonical content beside it. */
function legacyRecordedSatellite(): ClipSatelliteEntrySnapshot {
    return {
        clipId: 'c1',
        gainEnvelope: null,
        warpState: {
            enabled: true,
            markers: [{ id: 'm1', originalBeat: 0, warpedBeat: 0.5, origin: 'user' }],
            stretchMode: 'texture',
            originalTempo: 120,
        },
    };
}

function canonicalWarpState() {
    return {
        enabled: true,
        markers: [{ id: 'm1', originalBeat: 0, warpedBeat: 0.5, origin: 'user' as const }],
        stretchMode: 'repitch' as const,
        originalTempo: 120,
    };
}

describe('handleRestoreTrackClipStates over a legacy recorded satellite', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.applyClipAutomationLaneTransition.mockReturnValue(true);
        __resetWarpStatesForTest();
        __resetGainEnvelopesForTest();
        mocks.getTrackStoreState.mockReturnValue({ tracks: [liveTrack('t1', ['c1'])] });
    });

    it('writes a restore whose recorded satellite carries a legacy stretch mode', () => {
        // The live store holds the canonical decode of the recorded envelope —
        // the only shape a current build ever stores. The recorded `texture`
        // decodes onto `repitch`, so the guard compares decoded against decoded
        // and the replay writes instead of conflicting.
        setWarpState('c1', canonicalWarpState());
        const legacy = legacyRecordedSatellite();

        const result = handleRestoreTrackClipStates.execute({
            type: 'restoreTrackClipStates',
            payload: {
                expected: [snapshotFor('t1', ['c1'], { clipSatellites: [legacy] })],
                replacement: [snapshotFor('t1', ['c1'], { clipSatellites: [legacy] })],
            },
        });

        expect(result).toEqual({ status: 'written' });
        expect(warpStates.get('c1')?.stretchMode).toBe('repitch');
        expect(warpStates.get('c1')?.markers).toEqual(canonicalWarpState().markers);
    });

    it('still conflicts when the recorded satellite disagrees with the live decode', () => {
        // Decoding the recorded envelope is not waving it through: content the
        // decode does not reconcile still refuses the restore.
        setWarpState('c1', { ...canonicalWarpState(), originalTempo: 999 });
        const legacy = legacyRecordedSatellite();

        const result = handleRestoreTrackClipStates.execute({
            type: 'restoreTrackClipStates',
            payload: {
                expected: [snapshotFor('t1', ['c1'], { clipSatellites: [legacy] })],
                replacement: [snapshotFor('t1', ['c1'], { clipSatellites: [legacy] })],
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(warpStates.get('c1')?.originalTempo).toBe(999);
    });
});
