import { describe, expect, it } from 'vitest';

import { type RestoreTrackPayloadSnapshot } from '../../../events/arrangementTrackSnapshots';
import { applyRecordingHostEffect, recordingHostEffectByActionType } from '../recordingHostEffectByActionType';

function restorePayload(trackId: string): RestoreTrackPayloadSnapshot {
    return {
        trackId,
        trackSnapshot: { id: trackId },
        trackName: trackId,
        trackKind: 'audio',
        trackGain: 1,
        trackParentId: null,
        trackIndex: 0,
        wasSelected: false,
        routingPatches: [],
        automationLaneSnapshots: [],
        clipSatellites: [],
        midiNotesByClipId: {},
        midiCcByClipId: {},
        midiPitchBendByClipId: {},
        takeLaneSnapshots: [],
        sidechainRouteSnapshots: [],
        ownedModulatorSnapshots: [],
        incomingModulationMappingSnapshots: [],
    };
}

describe('recordingHostEffectByActionType', () => {
    it('gives exactly the four track-membership actions an effect', () => {
        const withEffect = Object.entries(recordingHostEffectByActionType)
            .filter(([, effect]) => effect !== recordingHostEffectByActionType.setTrackPan)
            .map(([type]) => type);

        expect(withEffect.toSorted()).toEqual(['removeAllTracks', 'removeTrack', 'restoreTrack', 'restoreTracks']);
    });

    it('removes one host on removeTrack', () => {
        const hosts = new Set(['a', 'b']);
        applyRecordingHostEffect({ type: 'removeTrack', payload: { trackId: 'a' } }, hosts);
        expect([...hosts]).toEqual(['b']);
    });

    it('adds one host on restoreTrack', () => {
        const hosts = new Set(['a']);
        applyRecordingHostEffect({ type: 'restoreTrack', payload: restorePayload('b') }, hosts);
        expect([...hosts].toSorted()).toEqual(['a', 'b']);
    });

    it('clears every host on removeAllTracks', () => {
        const hosts = new Set(['a', 'b']);
        applyRecordingHostEffect({ type: 'removeAllTracks' }, hosts);
        expect(hosts.size).toBe(0);
    });

    it('adds every restored host on restoreTracks', () => {
        const hosts = new Set(['a']);
        applyRecordingHostEffect(
            { type: 'restoreTracks', payload: { restores: [restorePayload('b'), restorePayload('c')] } },
            hosts
        );
        expect([...hosts].toSorted()).toEqual(['a', 'b', 'c']);
    });

    it('leaves the hosts alone for any other action', () => {
        const hosts = new Set(['a']);
        applyRecordingHostEffect({ type: 'setTrackPan', payload: { trackId: 'a', pan: 0, expectedPan: 0 } }, hosts);
        expect([...hosts]).toEqual(['a']);
    });
});
