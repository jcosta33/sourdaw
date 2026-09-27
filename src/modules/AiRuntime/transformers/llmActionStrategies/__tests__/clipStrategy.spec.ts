import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../../models/ProjectContext';
import { type ToolCallResult } from '../../../models/ToolCallResult';
import { bridgeClipToolCall, clipActionNames, clipStrategyRegistry } from '../clipStrategy';

const projectContext: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 0,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 0,
    metronomeEnabled: false,
    metronomeVolume: 0,
    masterGain: 1,
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
    glueEligibleClipPairs: [['clip-midi-a', 'clip-midi-b']],
    tracks: [
        {
            id: 'track-midi',
            name: 'Midi',
            kind: 'midi',
            muted: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            gain: 1,
            pan: 0,
            automationMode: 'read',
            clipCount: 2,
            deviceCount: 0,
            devices: [],
            clips: [
                {
                    id: 'clip-midi-a',
                    name: 'Midi A',
                    type: 'midi',
                    startBeat: 0,
                    endBeat: 4,
                    locked: false,
                    muted: false,
                    gain: 1,
                    loopEnabled: false,
                    noteCount: 2,
                },
                {
                    id: 'clip-midi-b',
                    name: 'Midi B',
                    type: 'midi',
                    startBeat: 4,
                    endBeat: 8,
                    locked: false,
                    muted: false,
                    gain: 1,
                    loopEnabled: false,
                    noteCount: 3,
                },
            ],
        },
        {
            id: 'track-audio',
            name: 'Audio',
            kind: 'audio',
            muted: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            gain: 1,
            pan: 0,
            automationMode: 'read',
            clipCount: 2,
            deviceCount: 0,
            devices: [],
            clips: [
                {
                    id: 'clip-audio-a',
                    name: 'Audio A',
                    type: 'audio',
                    startBeat: 0,
                    endBeat: 8,
                    locked: false,
                    gain: 1,
                    noteCount: 0,
                },
                {
                    id: 'clip-audio-b',
                    name: 'Audio B',
                    type: 'audio',
                    startBeat: 8,
                    endBeat: 12,
                    locked: false,
                    gain: 1,
                    noteCount: 0,
                },
            ],
        },
    ],
};

const foreignCall = { name: 'addMarker', arguments: { beat: 0, name: 'Intro' } };

const projectContextWithNonContentTracks: ProjectContext = {
    ...projectContext,
    tracks: [
        ...projectContext.tracks,
        { ...projectContext.tracks[0]!, id: 'track-bus', name: 'Drum Bus', kind: 'bus', clips: [], clipCount: 0 },
        { ...projectContext.tracks[0]!, id: 'track-folder', name: 'Strings', kind: 'folder', clips: [], clipCount: 0 },
        { ...projectContext.tracks[0]!, id: 'master', name: 'Master', kind: 'master', clips: [], clipCount: 0 },
    ],
};

/** A clip a pre-rule project parked on the wrong kind of track: its own host
 *  cannot play it, so an unconditional kind rule would refuse even the host —
 *  the shape the same-host retime exemption exists for. */
const legacyMisplacedClip = {
    ...projectContext.tracks[1]!.clips[0]!,
    id: 'clip-legacy-audio',
    name: 'Legacy Audio',
    startBeat: 8,
    endBeat: 12,
};

const projectContextWithLegacyMisplacedClip: ProjectContext = {
    ...projectContextWithNonContentTracks,
    tracks: projectContextWithNonContentTracks.tracks.map((track) =>
        track.id === 'track-midi' ? { ...track, clips: [...track.clips, legacyMisplacedClip] } : track
    ),
};

describe('clipStrategy', () => {
    it('registers exactly the exported clip action names', () => {
        expect(new Set(clipStrategyRegistry.keys())).toEqual(new Set(clipActionNames));
    });

    it('returns null for a name owned by another family', () => {
        expect(bridgeClipToolCall({ call: foreignCall, context: projectContext, index: 0 })).toBeNull();
    });

    it('addClip creates a midi clip on an existing midi track', () => {
        expect(
            bridgeClipToolCall({
                call: {
                    name: 'addClip',
                    arguments: { trackId: 'track-midi', startBeat: 0, endBeat: 4, name: 'Verse' },
                },
                context: projectContext,
                index: 0,
            })
        ).toEqual({
            type: 'addClip',
            payload: { trackId: 'track-midi', startBeat: 0, endBeat: 4, name: 'Verse', type: 'midi' },
        });
    });

    it('moveClip relocates an unlocked clip to an existing clip-host track', () => {
        expect(
            bridgeClipToolCall({
                call: {
                    name: 'moveClip',
                    arguments: { clipId: 'clip-audio-a', trackId: 'track-audio', startBeat: 2 },
                },
                context: projectContext,
                index: 1,
            })
        ).toEqual({
            type: 'moveClip',
            payload: { clipId: 'clip-audio-a', trackId: 'track-audio', startBeat: 2 },
        });
    });

    it('duplicateClipAt copies an unlocked clip onto a destination track', () => {
        expect(
            bridgeClipToolCall({
                call: {
                    name: 'duplicateClipAt',
                    arguments: { clipId: 'clip-audio-a', destinationTrackId: 'track-audio', startBeat: 20 },
                },
                context: projectContext,
                index: 2,
            })
        ).toEqual({
            type: 'duplicateClipAt',
            payload: { clipId: 'clip-audio-a', destinationTrackId: 'track-audio', startBeat: 20 },
        });
    });

    it('drawClip draws a new clip matching the destination track kind', () => {
        expect(
            bridgeClipToolCall({
                call: {
                    name: 'drawClip',
                    arguments: { trackId: 'track-audio', startBeat: 20, endBeat: 24, name: 'New Take', type: 'audio' },
                },
                context: projectContext,
                index: 3,
            })
        ).toEqual({
            type: 'drawClip',
            payload: {
                trackId: 'track-audio',
                startBeat: 20,
                endBeat: 24,
                name: 'New Take',
                type: 'audio',
                ripple: false,
            },
        });
    });

    it('moveClips relocates every named unlocked clip', () => {
        expect(
            bridgeClipToolCall({
                call: {
                    name: 'moveClips',
                    arguments: { moves: [{ clipId: 'clip-audio-a', trackId: 'track-audio', startBeat: 5 }] },
                },
                context: projectContext,
                index: 4,
            })
        ).toEqual({
            type: 'moveClips',
            payload: { moves: [{ clipId: 'clip-audio-a', trackId: 'track-audio', startBeat: 5 }], ripple: false },
        });
    });

    it('moveClip refuses a destination that cannot play the clip and names why', () => {
        const rejections: { call: ToolCallResult; reason: string }[] = [
            {
                call: { name: 'moveClip', arguments: { clipId: 'clip-midi-a', trackId: 'track-bus', startBeat: 2 } },
                reason: 'sums signal rather than playing clips',
            },
            {
                call: { name: 'moveClip', arguments: { clipId: 'clip-midi-a', trackId: 'track-folder', startBeat: 2 } },
                reason: 'renders no timeline content',
            },
            {
                call: { name: 'moveClip', arguments: { clipId: 'clip-midi-a', trackId: 'track-audio', startBeat: 2 } },
                reason: 'has no instrument',
            },
            {
                call: { name: 'moveClip', arguments: { clipId: 'clip-audio-a', trackId: 'track-midi', startBeat: 2 } },
                reason: 'cannot play an audio clip',
            },
        ];
        for (const { call, reason } of rejections) {
            expect(bridgeClipToolCall({ call, context: projectContextWithNonContentTracks, index: 3 })).toMatchObject({
                index: 3,
                name: call.name,
                reason: expect.stringContaining(reason),
            });
        }
    });

    it('duplicateClipAt and moveClips refuse destinations that cannot play the clip', () => {
        expect(
            bridgeClipToolCall({
                call: {
                    name: 'duplicateClipAt',
                    arguments: { clipId: 'clip-audio-a', destinationTrackId: 'track-folder', startBeat: 20 },
                },
                context: projectContextWithNonContentTracks,
                index: 4,
            })
        ).toMatchObject({
            name: 'duplicateClipAt',
            reason: expect.stringContaining('renders no timeline content'),
        });

        expect(
            bridgeClipToolCall({
                call: {
                    name: 'moveClips',
                    arguments: { moves: [{ clipId: 'clip-audio-a', trackId: 'master', startBeat: 5 }] },
                },
                context: projectContextWithNonContentTracks,
                index: 5,
            })
        ).toMatchObject({
            name: 'moveClips',
            reason: expect.stringContaining('sums signal rather than playing clips'),
        });
    });

    it('bridges a same-host retime of a legacy misplaced clip the kind rule cannot govern', () => {
        // A pre-rule project can hold an audio clip on a MIDI track. A
        // same-host move changes no placement, so the use case exempts it —
        // the bridge must not reject the call pre-dispatch with the clip's
        // own host named as an invalid destination.
        expect(
            bridgeClipToolCall({
                call: {
                    name: 'moveClip',
                    arguments: { clipId: 'clip-legacy-audio', trackId: 'track-midi', startBeat: 6 },
                },
                context: projectContextWithLegacyMisplacedClip,
                index: 3,
            })
        ).toEqual({
            type: 'moveClip',
            payload: { clipId: 'clip-legacy-audio', trackId: 'track-midi', startBeat: 6 },
        });

        expect(
            bridgeClipToolCall({
                call: {
                    name: 'moveClips',
                    arguments: { moves: [{ clipId: 'clip-legacy-audio', trackId: 'track-midi', startBeat: 6 }] },
                },
                context: projectContextWithLegacyMisplacedClip,
                index: 4,
            })
        ).toEqual({
            type: 'moveClips',
            payload: { moves: [{ clipId: 'clip-legacy-audio', trackId: 'track-midi', startBeat: 6 }], ripple: false },
        });
    });

    it('still refuses a legacy misplaced clip on a destination other than its own host', () => {
        // The same-host exemption is not a waiver: any other destination
        // obeys the kind rule, including this one the clip already violates
        // by existing.
        expect(
            bridgeClipToolCall({
                call: {
                    name: 'moveClip',
                    arguments: { clipId: 'clip-legacy-audio', trackId: 'master', startBeat: 6 },
                },
                context: projectContextWithLegacyMisplacedClip,
                index: 5,
            })
        ).toMatchObject({
            name: 'moveClip',
            reason: expect.stringContaining('sums signal rather than playing clips'),
        });
    });

    it('duplicateClipAt keeps refusing a copy onto a legacy misplaced clip own host', () => {
        // A duplicate is a NEW placement on the destination — even when that
        // destination is the clip's current host — so no same-host exemption
        // applies: the copy would be unplayable exactly like any fresh
        // placement.
        expect(
            bridgeClipToolCall({
                call: {
                    name: 'duplicateClipAt',
                    arguments: { clipId: 'clip-legacy-audio', destinationTrackId: 'track-midi', startBeat: 20 },
                },
                context: projectContextWithLegacyMisplacedClip,
                index: 6,
            })
        ).toMatchObject({
            name: 'duplicateClipAt',
            reason: expect.stringContaining('cannot play an audio clip'),
        });
    });

    it('splitClip splits an unlocked clip at a beat inside its bounds', () => {
        expect(
            bridgeClipToolCall({
                call: { name: 'splitClip', arguments: { clipId: 'clip-midi-a', beat: 2 } },
                context: projectContext,
                index: 5,
            })
        ).toEqual({ type: 'splitClip', payload: { clipId: 'clip-midi-a', beat: 2 } });
    });

    it('duplicateClip duplicates an available clip', () => {
        expect(
            bridgeClipToolCall({
                call: { name: 'duplicateClip', arguments: { clipId: 'clip-midi-a' } },
                context: projectContext,
                index: 0,
            })
        ).toEqual({ type: 'duplicateClip', payload: { clipId: 'clip-midi-a' } });
    });

    it('duplicateClipToNextBar duplicates an available clip', () => {
        expect(
            bridgeClipToolCall({
                call: { name: 'duplicateClipToNextBar', arguments: { clipId: 'clip-midi-a' } },
                context: projectContext,
                index: 6,
            })
        ).toEqual({ type: 'duplicateClipToNextBar', payload: { clipId: 'clip-midi-a' } });
    });

    it('normalizeClip normalizes an unlocked audio clip to the default peak mode', () => {
        expect(
            bridgeClipToolCall({
                call: { name: 'normalizeClip', arguments: { clipId: 'clip-audio-a' } },
                context: projectContext,
                index: 7,
            })
        ).toEqual({ type: 'normalizeClip', payload: { clipId: 'clip-audio-a' } });
    });

    it('setClipStretchRatio sets a finite ratio on an unlocked audio clip', () => {
        expect(
            bridgeClipToolCall({
                call: { name: 'setClipStretchRatio', arguments: { clipId: 'clip-audio-a', ratio: 2 } },
                context: projectContext,
                index: 8,
            })
        ).toEqual({ type: 'setClipStretchRatio', payload: { clipId: 'clip-audio-a', ratio: 2 } });
    });

    it('setClipStretchMode sets a supported stretch mode on an unlocked audio clip', () => {
        expect(
            bridgeClipToolCall({
                call: { name: 'setClipStretchMode', arguments: { clipId: 'clip-audio-a', mode: 'repitch' } },
                context: projectContext,
                index: 9,
            })
        ).toEqual({ type: 'setClipStretchMode', payload: { clipId: 'clip-audio-a', mode: 'repitch' } });
    });

    it('fitClipToBeats fits an unlocked audio clip to a positive target', () => {
        expect(
            bridgeClipToolCall({
                call: { name: 'fitClipToBeats', arguments: { clipId: 'clip-audio-a', targetBeats: 4 } },
                context: projectContext,
                index: 10,
            })
        ).toEqual({ type: 'fitClipToBeats', payload: { clipId: 'clip-audio-a', targetBeats: 4 } });
    });

    it('removeClip removes an available unlocked clip', () => {
        expect(
            bridgeClipToolCall({
                call: { name: 'removeClip', arguments: { clipId: 'clip-midi-b' } },
                context: projectContext,
                index: 11,
            })
        ).toEqual({ type: 'removeClip', payload: { clipId: 'clip-midi-b' } });
    });

    it('renameClip renames an available unlocked clip with a safe name', () => {
        expect(
            bridgeClipToolCall({
                call: { name: 'renameClip', arguments: { clipId: 'clip-midi-a', name: 'Verse 2' } },
                context: projectContext,
                index: 12,
            })
        ).toEqual({ type: 'renameClip', payload: { clipId: 'clip-midi-a', name: 'Verse 2' } });
    });

    it('trimClipStart moves the start of an unlocked clip before its end', () => {
        expect(
            bridgeClipToolCall({
                call: { name: 'trimClipStart', arguments: { clipId: 'clip-midi-a', newStartBeat: 1 } },
                context: projectContext,
                index: 13,
            })
        ).toEqual({ type: 'trimClipStart', payload: { clipId: 'clip-midi-a', newStartBeat: 1 } });
    });

    it('trimClipEnd moves the end of an unlocked clip after its start', () => {
        expect(
            bridgeClipToolCall({
                call: { name: 'trimClipEnd', arguments: { clipId: 'clip-midi-a', newEndBeat: 3 } },
                context: projectContext,
                index: 14,
            })
        ).toEqual({ type: 'trimClipEnd', payload: { clipId: 'clip-midi-a', newEndBeat: 3 } });
    });

    it('nudgeClip shifts an unlocked clip by a non-zero delta that stays on the timeline', () => {
        expect(
            bridgeClipToolCall({
                call: { name: 'nudgeClip', arguments: { clipId: 'clip-midi-a', beats: 1 } },
                context: projectContext,
                index: 15,
            })
        ).toEqual({ type: 'nudgeClip', payload: { clipId: 'clip-midi-a', beats: 1 } });
    });

    it('slipClipContent offsets the content of an unlocked clip of the matching type', () => {
        expect(
            bridgeClipToolCall({
                call: {
                    name: 'slipClipContent',
                    arguments: { clipId: 'clip-midi-a', clipType: 'midi', offset: 0.5 },
                },
                context: projectContext,
                index: 16,
            })
        ).toEqual({ type: 'slipClipContent', payload: { clipId: 'clip-midi-a', clipType: 'midi', offset: 0.5 } });
    });

    it('setClipGain sets a finite gain on an unlocked clip', () => {
        expect(
            bridgeClipToolCall({
                call: { name: 'setClipGain', arguments: { clipId: 'clip-midi-a', gain: 1.5 } },
                context: projectContext,
                index: 17,
            })
        ).toEqual({ type: 'setClipGain', payload: { clipId: 'clip-midi-a', gain: 1.5 } });
    });

    it('muteClip changes the muted state of an unlocked clip', () => {
        expect(
            bridgeClipToolCall({
                call: { name: 'muteClip', arguments: { clipId: 'clip-midi-a', muted: true } },
                context: projectContext,
                index: 18,
            })
        ).toEqual({ type: 'muteClip', payload: { clipId: 'clip-midi-a', muted: true } });
    });

    it('setClipColor changes the color of an unlocked clip', () => {
        expect(
            bridgeClipToolCall({
                call: { name: 'setClipColor', arguments: { clipId: 'clip-midi-a', color: '#112233' } },
                context: projectContext,
                index: 19,
            })
        ).toEqual({ type: 'setClipColor', payload: { clipId: 'clip-midi-a', color: '#112233' } });
    });

    it('setClipFade changes the fades of an unlocked clip within half its length', () => {
        expect(
            bridgeClipToolCall({
                call: {
                    name: 'setClipFade',
                    arguments: { clipId: 'clip-audio-a', fadeInBeats: 1, fadeOutBeats: 1 },
                },
                context: projectContext,
                index: 20,
            })
        ).toEqual({ type: 'setClipFade', payload: { clipId: 'clip-audio-a', fadeInBeats: 1, fadeOutBeats: 1 } });
    });

    it('glueClips glues two adjacent eligible unlocked unmuted midi clips on the same track', () => {
        expect(
            bridgeClipToolCall({
                call: { name: 'glueClips', arguments: { clipIds: ['clip-midi-a', 'clip-midi-b'] } },
                context: projectContext,
                index: 21,
            })
        ).toEqual({ type: 'glueClips', payload: { clipIds: ['clip-midi-a', 'clip-midi-b'] } });
    });

    it('crossfadeClips crossfades two distinct unlocked clips in timeline order', () => {
        expect(
            bridgeClipToolCall({
                call: { name: 'crossfadeClips', arguments: { clipAId: 'clip-audio-a', clipBId: 'clip-audio-b' } },
                context: projectContext,
                index: 22,
            })
        ).toEqual({ type: 'crossfadeClips', payload: { clipAId: 'clip-audio-a', clipBId: 'clip-audio-b' } });
    });

    it('lockClip changes the locked state of an available clip', () => {
        expect(
            bridgeClipToolCall({
                call: { name: 'lockClip', arguments: { clipId: 'clip-audio-b', locked: true } },
                context: projectContext,
                index: 23,
            })
        ).toEqual({ type: 'lockClip', payload: { clipId: 'clip-audio-b', locked: true } });
    });

    it('setClipLoop changes the loop-enabled state of an unlocked clip', () => {
        expect(
            bridgeClipToolCall({
                call: { name: 'setClipLoop', arguments: { clipId: 'clip-midi-b', enabled: true } },
                context: projectContext,
                index: 24,
            })
        ).toEqual({ type: 'setClipLoop', payload: { clipId: 'clip-midi-b', enabled: true } });
    });

    it('setClipLoopLength changes the loop length of an unlocked clip on a stopped transport', () => {
        expect(
            bridgeClipToolCall({
                call: { name: 'setClipLoopLength', arguments: { clipId: 'clip-midi-b', loopLength: 2 } },
                context: projectContext,
                index: 25,
            })
        ).toEqual({ type: 'setClipLoopLength', payload: { clipId: 'clip-midi-b', loopLength: 2 } });
    });
});
