import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    markerStoreValue: {
        value: null as {
            markers: { id: string; beat: number; color: string; name: string }[];
            sections: { id: string; startBeat: number; endBeat: number; name: string }[];
        } | null,
    },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    markerStore: {
        get value() {
            return mocks.markerStoreValue.value;
        },
    },
    // Not exercised by this spec — stubbed only because `describeAction`'s module
    // graph reaches these transitively (through the AI action registry's other
    // action handlers) and the widened barrel-mock-coverage gate (`stores`) treats
    // every reachable import as required, even one only read inside a function body
    // this spec's tests never call.
    persistDeviceParam: vi.fn(),
    resolveEligibleDeviceWriteTarget: vi.fn(),
    trackStore: { value: null, subscribe: () => () => undefined },
    getTrackEligibility: vi.fn(),
    shouldCreateLiveTrackStrip: vi.fn(),
    deriveEffectiveAudibility: vi.fn(),
    adjustmentLayerStore: { value: null, subscribe: () => () => undefined },
    vcaGroupStore: { value: null, subscribe: () => () => undefined },
    deriveVcaMultiplier: vi.fn(),
    getVcaGroupsState: vi.fn(),
    gainEnvelopeStore: { value: null, subscribe: () => () => undefined },
    warpStates: new Map(),
    getWarpState: vi.fn(),
    addWarpMarker: vi.fn(),
    clipSelectionStore: { value: null, subscribe: () => () => undefined },
    resolveEligibleClipWriteTarget: vi.fn(),
    updateClipInStore: vi.fn(),
    appendClipToTrack: vi.fn(),
    clampDeviceParamWrite: vi.fn(),
    takeLaneStore: { value: null, subscribe: () => () => undefined },
}));

import { type ProjectContext } from '../../models/ProjectContext';
import { describePlannedAction } from '../describePlannedAction';

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 0,
    punchInEnabled: true,
    punchInBeat: 4,
    punchOutBeat: 12,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [
        {
            id: 'track-drums',
            name: 'Drums',
            kind: 'audio',
            muted: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            gain: 0.8,
            pan: 0,
            automationMode: 'read',
            outputId: 'master',
            clipCount: 0,
            deviceCount: 0,
            clips: [
                {
                    id: 'clip-verse',
                    name: 'Verse Lead',
                    type: 'audio',
                    startBeat: 0,
                    endBeat: 8,
                    noteCount: 0,
                },
            ],
            devices: [],
            sends: [],
        },
    ],
    selectedTrackId: 'track-drums',
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

describe('describePlannedAction', () => {
    beforeEach(() => {
        mocks.markerStoreValue.value = null;
    });

    it('discloses the exact clip, track, range, and dormant loop-length effect', () => {
        expect(
            describePlannedAction({
                action: { type: 'setClipLoopLength', payload: { clipId: 'clip-verse', loopLength: 2 } },
                context,
            })
        ).toBe(
            'Set clip "Verse Lead" (clip-verse) on track "Drums" (track-drums) loop length from the implicit clip duration of 8 beats to 2 beats; clip looping remains disabled, so this stored length is dormant until looping is enabled; clip range remains beats 0–8'
        );
    });

    it('describes the immutable note-level articulation diff without exposing protected fields as mutations', () => {
        const articulationContext: ProjectContext = {
            ...context,
            tracks: [
                {
                    ...context.tracks[0]!,
                    id: 'track-strings',
                    name: 'Strings',
                    kind: 'midi',
                    clips: [
                        {
                            id: 'clip-chorus-one',
                            name: 'Strings Chorus One',
                            type: 'midi',
                            startBeat: 0,
                            endBeat: 16,
                            noteCount: 1,
                        },
                        {
                            id: 'clip-chorus-two',
                            name: 'Strings Chorus Two',
                            type: 'midi',
                            startBeat: 16,
                            endBeat: 32,
                            noteCount: 1,
                        },
                    ],
                },
            ],
        };

        expect(
            describePlannedAction({
                action: {
                    type: 'copyMidiArticulations',
                    payload: {
                        trackId: 'track-strings',
                        sourceClipId: 'clip-chorus-one',
                        targetClipId: 'clip-chorus-two',
                        notePairs: [{ sourceNoteId: 'source-note', targetNoteId: 'target-note' }],
                        expectedSourceNotes: [
                            {
                                id: 'source-note',
                                pitch: 60,
                                startBeat: 0,
                                duration: 1,
                                velocity: 90,
                                articulation: 'staccato',
                            },
                        ],
                        expectedTargetNotes: [
                            {
                                id: 'target-note',
                                pitch: 64,
                                startBeat: 0,
                                duration: 1,
                                velocity: 70,
                                articulation: 'legato',
                            },
                        ],
                        expectedTrackFrozen: false,
                        expectedSourceClipLocked: false,
                        expectedTargetClipLocked: false,
                    },
                },
                context: articulationContext,
            })
        ).toBe(
            'Track "Strings" (track-strings): "Strings Chorus One" (clip-chorus-one) → "Strings Chorus Two" (clip-chorus-two); target note target-note from source-note articulation legato → staccato; preserve target pitches, velocities, timing, and expression'
        );
    });

    it('names a resolved removal target and falls back when the target is unavailable', () => {
        expect(
            describePlannedAction({
                action: { type: 'removeTrack', payload: { trackId: 'track-drums' } },
                context,
            })
        ).toBe('Remove track "Drums"');
        expect(
            describePlannedAction({
                action: { type: 'removeTrack', payload: { trackId: 'missing' } },
                context,
            })
        ).toBe('Remove track');
    });

    it('names a resolved clip removal target and falls back when the clip is unavailable', () => {
        expect(
            describePlannedAction({
                action: { type: 'removeClip', payload: { clipId: 'clip-verse' } },
                context,
            })
        ).toBe('Remove clip "Verse Lead"');
        expect(
            describePlannedAction({
                action: { type: 'removeClip', payload: { clipId: 'missing' } },
                context,
            })
        ).toBe('Remove clip');
    });

    it('names the moved clip, destination track, and absolute beat', () => {
        expect(
            describePlannedAction({
                action: {
                    type: 'moveClip',
                    payload: { clipId: 'clip-verse', trackId: 'track-drums', startBeat: 16 },
                },
                context,
            })
        ).toBe('Move clip "Verse Lead" to track "Drums" at beat 16');
        expect(
            describePlannedAction({
                action: { type: 'moveClip', payload: { clipId: 'missing', trackId: 'missing', startBeat: 4 } },
                context,
            })
        ).toBe('Move clip to beat 4');
    });

    it('names the normalization target, measurement, and optional level', () => {
        expect(
            describePlannedAction({
                action: { type: 'normalizeClip', payload: { clipId: 'clip-verse' } },
                context,
            })
        ).toBe('Normalize clip "Verse Lead" using peak measurement');
        expect(
            describePlannedAction({
                action: {
                    type: 'normalizeClip',
                    payload: { clipId: 'clip-verse', mode: 'lufs', targetDb: -14 },
                },
                context,
            })
        ).toBe('Normalize clip "Verse Lead" to -14 LUFS');
        expect(
            describePlannedAction({
                action: { type: 'normalizeClip', payload: { clipId: 'missing', mode: 'rms' } },
                context,
            })
        ).toBe('Normalize clip to -14 dB RMS');
    });

    it('names the time-stretch target and ratio', () => {
        expect(
            describePlannedAction({
                action: { type: 'setClipStretchRatio', payload: { clipId: 'clip-verse', ratio: 1.5 } },
                context,
            })
        ).toBe('Set clip "Verse Lead" stretch ratio to 1.5×');
        expect(
            describePlannedAction({
                action: { type: 'setClipStretchRatio', payload: { clipId: 'missing', ratio: 0.5 } },
                context,
            })
        ).toBe('Set clip stretch ratio to 0.5×');
    });

    it('names the playback stretch target and mode', () => {
        expect(
            describePlannedAction({
                action: { type: 'setClipStretchMode', payload: { clipId: 'clip-verse', mode: 'timestretch' } },
                context,
            })
        ).toBe('Set clip "Verse Lead" stretch mode to timestretch');
        expect(
            describePlannedAction({
                action: { type: 'setClipStretchMode', payload: { clipId: 'missing', mode: 'off' } },
                context,
            })
        ).toBe('Set clip stretch mode to off');
    });

    it('names the clip and target beat duration for fit actions', () => {
        expect(
            describePlannedAction({
                action: { type: 'fitClipToBeats', payload: { clipId: 'clip-verse', targetBeats: 8 } },
                context,
            })
        ).toBe('Fit clip "Verse Lead" to 8 beats');
        expect(
            describePlannedAction({
                action: { type: 'fitClipToBeats', payload: { clipId: 'missing', targetBeats: 4 } },
                context,
            })
        ).toBe('Fit clip to 4 beats');
    });

    it('names the exact local marker removal target and falls back when it is unavailable', () => {
        mocks.markerStoreValue.value = {
            markers: [{ id: 'marker-chorus', beat: 16, name: 'Chorus', color: 'oklch(0.40 0.07 200)' }],
            sections: [],
        };

        expect(
            describePlannedAction({
                action: { type: 'removeMarker', payload: { markerId: 'marker-chorus' } },
                context,
            })
        ).toBe('Remove marker "Chorus" at beat 16 (marker-chorus)');
        expect(
            describePlannedAction({
                action: { type: 'removeMarker', payload: { markerId: 'missing' } },
                context,
            })
        ).toBe('Remove marker');
    });

    it('names the exact local marker and requested palette color', () => {
        mocks.markerStoreValue.value = {
            markers: [{ id: 'marker-chorus', beat: 16, name: 'Chorus', color: 'oklch(0.40 0.07 200)' }],
            sections: [],
        };

        expect(
            describePlannedAction({
                action: {
                    type: 'setMarkerColor',
                    payload: { markerId: 'marker-chorus', color: 'oklch(0.40 0.08 70)' },
                },
                context,
            })
        ).toBe('Set marker "Chorus" at beat 16 (marker-chorus) color to amber');
    });

    it('names section range, local identity, and rename target for confirmation', () => {
        mocks.markerStoreValue.value = {
            markers: [],
            sections: [{ id: 'section-verse', startBeat: 8, endBeat: 16, name: 'Verse' }],
        };

        expect(
            describePlannedAction({
                action: { type: 'addSection', payload: { startBeat: 16, endBeat: 32, name: 'Chorus' } },
                context,
            })
        ).toBe('Add section "Chorus" from beat 16 to beat 32');
        expect(
            describePlannedAction({
                action: { type: 'removeSection', payload: { sectionId: 'section-verse' } },
                context,
            })
        ).toBe('Remove section "Verse" from beat 8 to beat 16 (section-verse)');
        expect(
            describePlannedAction({
                action: { type: 'renameSection', payload: { sectionId: 'section-verse', name: 'Pre-Chorus' } },
                context,
            })
        ).toBe('Rename section "Verse" to "Pre-Chorus" from beat 8 to beat 16 (section-verse)');
    });

    it('names the exact MIDI clip, stable ID, and transform value for confirmation', () => {
        const midiContext: ProjectContext = {
            ...context,
            tracks: context.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((clip) => ({
                    ...clip,
                    type: 'midi' as const,
                    noteCount: 4,
                })),
            })),
        };

        expect(
            describePlannedAction({
                action: { type: 'quantizeNotes', payload: { clipId: 'clip-verse', gridSize: 0.25 } },
                context: midiContext,
            })
        ).toBe('Quantize notes in "Verse Lead" (clip-verse) to a 0.25-beat grid');
        expect(
            describePlannedAction({
                action: { type: 'transposeNotes', payload: { clipId: 'clip-verse', semitones: 7 } },
                context: midiContext,
            })
        ).toBe('Transpose notes in "Verse Lead" (clip-verse) by +7 semitones');
        expect(
            describePlannedAction({
                action: { type: 'invertNotes', payload: { clipId: 'clip-verse' } },
                context: midiContext,
            })
        ).toBe('Invert notes in "Verse Lead" (clip-verse)');
        expect(
            describePlannedAction({
                action: { type: 'retrogradeNotes', payload: { clipId: 'clip-verse' } },
                context: midiContext,
            })
        ).toBe('Retrograde notes in "Verse Lead" (clip-verse)');
        expect(
            describePlannedAction({
                action: { type: 'quantizeNoteLengths', payload: { clipId: 'clip-verse', gridSize: 0.5 } },
                context: midiContext,
            })
        ).toBe('Quantize note lengths in "Verse Lead" (clip-verse) to a 0.5-beat grid');
        expect(
            describePlannedAction({
                action: { type: 'scaleAllVelocities', payload: { clipId: 'clip-verse', factor: 0.75 } },
                context: midiContext,
            })
        ).toBe('Scale note velocities in "Verse Lead" (clip-verse) by ×0.75');
        expect(
            describePlannedAction({
                action: { type: 'setAllVelocities', payload: { clipId: 'clip-verse', velocity: 96 } },
                context: midiContext,
            })
        ).toBe('Set note velocities in "Verse Lead" (clip-verse) to 96');
    });

    it('names the common MIDI track when other clips have identical names and ranges', () => {
        const sourceTrack = context.tracks[0]!;
        const sourceClip = sourceTrack.clips[0]!;
        const targetTrack = {
            ...sourceTrack,
            kind: 'midi' as const,
            clipCount: 2,
            clips: [
                { ...sourceClip, type: 'midi' as const, noteCount: 4 },
                { ...sourceClip, id: 'clip-chorus', type: 'midi' as const, noteCount: 4 },
            ],
        };
        const midiContext: ProjectContext = {
            ...context,
            tracks: [
                {
                    ...targetTrack,
                    id: 'track-keys',
                    name: 'Keys',
                    clips: targetTrack.clips.map((clip) => ({ ...clip, id: `keys-${clip.id}` })),
                },
                targetTrack,
            ],
        };

        expect(
            describePlannedAction({
                action: { type: 'glueClips', payload: { clipIds: ['clip-verse', 'clip-chorus'] } },
                context: midiContext,
            })
        ).toBe(
            'Glue MIDI clips "Verse Lead" (clip-verse, beats 0–8) and "Verse Lead" (clip-chorus, beats 0–8) on MIDI track "Drums" (track-drums)'
        );
    });

    it('names both sidechain endpoints with IDs and direction for confirmation', () => {
        const bassTrack = {
            ...context.tracks[0]!,
            id: 'track-bass',
            name: 'Bass',
            clips: [],
            clipCount: 0,
        };
        const sidechainContext = { ...context, tracks: [context.tracks[0]!, bassTrack] };

        expect(
            describePlannedAction({
                action: {
                    type: 'addSidechainRoute',
                    payload: { sourceTrackId: 'track-drums', targetTrackId: 'track-bass' },
                },
                context: sidechainContext,
            })
        ).toBe('Add sidechain route: "Drums" (track-drums) → "Bass" (track-bass)');
        expect(
            describePlannedAction({
                action: {
                    type: 'removeSidechainRoute',
                    payload: { sourceTrackId: 'track-drums', targetTrackId: 'track-bass' },
                },
                context: sidechainContext,
            })
        ).toBe('Remove sidechain route: "Drums" (track-drums) → "Bass" (track-bass)');
    });

    it('previews the exact punch pair, opposite endpoint movement, and unchanged enabled state', () => {
        expect(
            describePlannedAction({
                action: { type: 'setPunchIn', payload: { beat: 20 } },
                context,
            })
        ).toBe(
            'Set punch-in to beat 20; punch-out moves from beat 12 to 21; resulting region 20–21; punch recording remains enabled'
        );
        expect(
            describePlannedAction({
                action: { type: 'setPunchOut', payload: { beat: 8 } },
                context,
            })
        ).toBe(
            'Set punch-out to beat 8; punch-in remains at beat 4; resulting region 4–8; punch recording remains enabled'
        );
    });

    it('describes durable punch enablement with armed-track playback behavior and the exact region', () => {
        expect(
            describePlannedAction({
                action: { type: 'setPunchEnabled', payload: { enabled: true } },
                context,
            })
        ).toBe(
            'Enable Transport Punch In/Out until changed; during playback with an armed track, recording starts at punch-in beat 4 and stops at punch-out beat 12; punch region remains beats 4–12; background capture is unchanged'
        );
        expect(
            describePlannedAction({
                action: { type: 'setPunchEnabled', payload: { enabled: false } },
                context,
            })
        ).toBe(
            'Disable Transport Punch In/Out until changed; armed-track playback will no longer start and stop recording at punch region beats 4–12; punch region remains beats 4–12; background capture is unchanged'
        );
    });
});
