import { describe, expect, it } from 'vitest';

import { type ProjectContext, type ProjectContextTrack } from '../../../models/ProjectContext';
import { getBulkDeviceInsertionTrackScope } from '../getBulkDeviceInsertionTrackScope';

function createTrack(id: string, name: string, frozen = false): ProjectContextTrack {
    return {
        id,
        name,
        kind: 'audio',
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        frozen,
        gain: 0.8,
        pan: 0,
        automationMode: 'read',
        outputId: 'master',
        clipCount: 0,
        deviceCount: 1,
        clips: [],
        devices: [{ id: `${id}-eq`, name: 'EQ', type: 'builtin-eq', bypassed: false }],
        sends: [],
    };
}

/** Two unfrozen bass tracks, one frozen bass track, and one track outside the family. */
const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 0,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [
        createTrack('track-bass-di', 'Bass DI'),
        createTrack('track-bass-amp', 'Bass Amp'),
        createTrack('track-bass-frozen', 'Bass Frozen', true),
        createTrack('track-guitar', 'Guitar'),
    ],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

const anchoredPhraselessScope = {
    targetIds: ['track-bass-di', 'track-bass-amp'],
    anchors: [
        { trackId: 'track-bass-di', afterDeviceId: 'track-bass-di-eq' },
        { trackId: 'track-bass-amp', afterDeviceId: 'track-bass-amp-eq' },
    ],
    excludedFrozenTrackIds: ['track-bass-frozen'],
};

describe('getBulkDeviceInsertionTrackScope', () => {
    it('scopes an anchor-less bulk prompt to the unfrozen tracks with frozen exclusions', () => {
        expect(getBulkDeviceInsertionTrackScope('Add EQ to every bass track', context)).toEqual({
            targetIds: ['track-bass-di', 'track-bass-amp'],
            anchors: [],
            excludedFrozenTrackIds: ['track-bass-frozen'],
        });
    });

    it('derives frozen exclusion without the excluding-frozen phrase', () => {
        expect(getBulkDeviceInsertionTrackScope('Insert a compressor after EQ on every bass track', context)).toEqual(
            anchoredPhraselessScope
        );
    });

    it('resolves an anchored phrase prompt with application-resolved anchors', () => {
        expect(
            getBulkDeviceInsertionTrackScope(
                'Insert a compressor after EQ on every bass track, excluding frozen tracks',
                context
            )
        ).toEqual(anchoredPhraselessScope);
    });

    it('resolves an anchored prompt with no devices on the frozen track', () => {
        const contextWithoutFrozenDevices: ProjectContext = {
            ...context,
            tracks: context.tracks.map((track) =>
                track.id === 'track-bass-frozen' ? { ...track, devices: [], deviceCount: 0 } : track
            ),
        };

        expect(
            getBulkDeviceInsertionTrackScope(
                'Insert a compressor after EQ on every bass track, excluding frozen tracks',
                contextWithoutFrozenDevices
            )
        ).toEqual(anchoredPhraselessScope);
    });

    it('keeps an anchored prompt unresolved when one target lacks the anchor', () => {
        const contextMissingAnchor: ProjectContext = {
            ...context,
            tracks: context.tracks.map((track) =>
                track.id === 'track-bass-amp' ? { ...track, devices: [], deviceCount: 0 } : track
            ),
        };

        // All-or-nothing on purpose: with no application-resolved anchor on every
        // target there is no grounded insertion order to enforce, so the scope
        // stays null and the batch falls back to ordinary per-reference grounding.
        expect(
            getBulkDeviceInsertionTrackScope(
                'Insert a compressor after EQ on every bass track, excluding frozen tracks',
                contextMissingAnchor
            )
        ).toBeNull();
    });

    it('claims no scope when the family phrase and the insertion intent sit in different requests', () => {
        expect(getBulkDeviceInsertionTrackScope('Mute every bass track, then add a reverb', context)).toBeNull();

        const drumContext: ProjectContext = {
            ...context,
            tracks: [
                ...context.tracks,
                createTrack('track-drums-main', 'Drum Main'),
                createTrack('track-drums-frozen', 'Drum Frozen', true),
            ],
        };

        expect(
            getBulkDeviceInsertionTrackScope('Delete all drum tracks, then add a compressor on the master', drumContext)
        ).toBeNull();
    });

    it('claims no scope when a request says after yet names no device', () => {
        expect(getBulkDeviceInsertionTrackScope('Add EQ to every bass track after', context)).toBeNull();
    });

    it('returns null for prompts outside the bulk device-insertion family', () => {
        expect(getBulkDeviceInsertionTrackScope('Mute all bass tracks', context)).toBeNull();
        expect(getBulkDeviceInsertionTrackScope('Add EQ to the bass track', context)).toBeNull();
        expect(getBulkDeviceInsertionTrackScope('Add EQ to every synth track', context)).toBeNull();
    });
});
