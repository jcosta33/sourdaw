import { describe, it, expect } from 'vitest';

import { type ProjectContext } from '../../../models/ProjectContext';
import {
    isComplexPrompt,
    buildPresetContext,
    tryPresetMatch,
    tryParameterizedPath,
    tryCompoundFastPath,
    resolveTrackReference,
} from '../parsing';

describe('promptParser parsing', () => {
    describe('isComplexPrompt', () => {
        it('identifies complex prompts requiring LLM', () => {
            expect(isComplexPrompt('create 4 tracks')).toBe(true);
            expect(isComplexPrompt('mute every track')).toBe(true);
            expect(isComplexPrompt('name them vocal1 and vocal2')).toBe(true);
            expect(isComplexPrompt('add eq then add compressor')).toBe(true);
            expect(isComplexPrompt('add eq, compressor, and reverb')).toBe(true);
            expect(isComplexPrompt('make it sound wider and warmer')).toBe(true);
            expect(isComplexPrompt('start a new pop song')).toBe(true);
            expect(isComplexPrompt('add tracks')).toBe(true);
        });

        it('identifies simple prompts that can be parsed with regex', () => {
            expect(isComplexPrompt('set tempo to 120')).toBe(false);
            expect(isComplexPrompt('mute track')).toBe(false);
            expect(isComplexPrompt('add eq to vocals')).toBe(false);
            expect(isComplexPrompt('rename clip to chorus')).toBe(false);
        });
    });

    describe('buildPresetContext', () => {
        it('builds context correctly from ProjectContext', () => {
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
                    {
                        id: 't1',
                        name: 'Vocals',
                        kind: 'audio',
                        muted: false,
                        soloed: false,
                        soloSafe: false,
                        armed: false,
                        gain: 1,
                        pan: 0,
                        automationMode: 'read',
                        clipCount: 1,
                        deviceCount: 0,
                        clips: [{ id: 'c1', name: 'Vox 1', type: 'audio', startBeat: 0, endBeat: 4, noteCount: 0 }],
                        devices: [],
                    },
                ],
                selectedTrackId: 't1',
                selectedClipId: 'c1',
                selectedClipIds: ['c1'],
                activeView: 'arrange',
                playheadPosition: 0,
            };

            const presetContext = buildPresetContext(context);
            expect(presetContext.selectedTrackId).toBe('t1');
            expect(presetContext.selectedTrackKind).toBe('audio');
            expect(presetContext.selectedClipId).toBe('c1');
            expect(presetContext.selectedClipType).toBe('audio');
            expect(presetContext.trackCount).toBe(1);
        });
    });

    describe('tryPresetMatch', () => {
        it('does not execute a colliding exact alias by registry order', () => {
            const context = {
                selectedTrackId: 'track-1',
                selectedClipId: 'clip-1',
                selectedClipType: 'audio' as const,
                trackCount: 1,
            };

            expect(tryPresetMatch('copy clip', context)).toEqual([]);
        });

        it('executes only a unique complete label or declared imperative alias', () => {
            const context = {
                selectedTrackId: 'track-1',
                selectedClipId: undefined,
                selectedClipType: undefined,
                trackCount: 1,
            };

            expect(tryPresetMatch('start playback', context)).toEqual([
                { type: 'setPlayback', payload: { playing: true } },
            ]);
            expect(tryPresetMatch('add eq', context)).toEqual([
                { type: 'addDevice', payload: { trackId: 'track-1', deviceType: 'builtin-eq' } },
            ]);
            expect(tryPresetMatch('eq', context)).toEqual([]);
            expect(tryPresetMatch('warm', context)).toEqual([]);
        });

        it('leaves add-automation-lane prompts for the grounded provider path', () => {
            const actions = tryPresetMatch('add automation lane', {
                selectedTrackId: 'track-1',
                selectedClipId: undefined,
                selectedClipType: undefined,
                trackCount: 1,
            });

            expect(actions).toEqual([]);
        });

        it('leaves provider-governed MIDI transforms for exact grounding', () => {
            const context = {
                selectedTrackId: 'track-midi',
                selectedClipId: 'clip-selected',
                selectedClipType: 'midi' as const,
                trackCount: 1,
            };

            expect(tryPresetMatch('quantize', context)).toEqual([]);
            expect(tryPresetMatch('transpose up an octave', context)).toEqual([]);
            expect(tryPresetMatch('invert notes', context)).toEqual([]);
            expect(tryPresetMatch('retrograde notes', context)).toEqual([]);
            expect(tryPresetMatch('quantize note lengths to 1/8 beat', context)).toEqual([]);
            expect(tryPresetMatch('scale all velocities to 50%', context)).toEqual([]);
            expect(tryPresetMatch('set all velocities to 96', context)).toEqual([]);
            expect(tryPresetMatch('enable punch in/out', context)).toEqual([]);
            expect(tryPresetMatch('disable punch in/out', context)).toEqual([]);
        });
    });

    describe('tryParameterizedPath', () => {
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
                {
                    id: 't1',
                    name: 'Vocals',
                    kind: 'audio',
                    muted: false,
                    soloed: false,
                    soloSafe: false,
                    armed: false,
                    gain: 1,
                    pan: 0,
                    automationMode: 'read',
                    clipCount: 1,
                    deviceCount: 0,
                    clips: [{ id: 'c1', name: 'Vox 1', type: 'audio', startBeat: 0, endBeat: 4, noteCount: 0 }],
                    devices: [],
                },
            ],
            selectedTrackId: 't1',
            selectedClipId: 'c1', // Assuming clip c1 exists on t1 conceptually for tests
            selectedClipIds: ['c1'],
            activeView: 'arrange',
            playheadPosition: 0,
        };

        it('parses set tempo', () => {
            const actions = tryParameterizedPath('set tempo 140', context);
            expect(actions).toEqual([{ type: 'setTempo', payload: { bpm: 140 } }]);
        });

        it('parses set volume with percentage', () => {
            const actions = tryParameterizedPath('set volume to 80%', context);
            expect(actions).toEqual([{ type: 'setTrackGain', payload: { trackId: 't1', gain: 0.8 } }]);
        });

        it('parses a make-up-gain volume above 100% without silently clamping it to unity', () => {
            // 150% used to be pinned at gain: 1 (the old unity cap). It must
            // now pass through as the fader can actually reach it.
            const actions = tryParameterizedPath('set volume to 150%', context);
            expect(actions).toEqual([{ type: 'setTrackGain', payload: { trackId: 't1', gain: 1.5 } }]);
        });

        it('preserves a volume past the fader ceiling for runtime validation', () => {
            const actions = tryParameterizedPath('set volume to 500%', context);
            expect(actions).toEqual([{ type: 'setTrackGain', payload: { trackId: 't1', gain: 5 } }]);
        });

        it('preserves out-of-range pan values for runtime validation', () => {
            expect(tryParameterizedPath('set pan to 100', context)).toEqual([
                { type: 'setTrackPan', payload: { trackId: 't1', pan: 100 } },
            ]);
        });

        it.each(['mute bass', 'solo bass', 'add eq to bass', 'delete bass'])(
            'does not guess a duplicate or partial target for %s',
            (prompt) => {
                const bass = { ...context.tracks[0]!, id: 'bass-1', name: 'Bass' };
                const duplicateBass = { ...context.tracks[0]!, id: 'bass-2', name: 'Bass' };
                const bassDi = { ...context.tracks[0]!, id: 'bass-di', name: 'Bass DI' };
                const bassAmp = { ...context.tracks[0]!, id: 'bass-amp', name: 'Bass Amp' };
                const duplicateContext = { ...context, tracks: [bass, duplicateBass] };
                const partialContext = { ...context, tracks: [bassDi, bassAmp] };

                expect(tryParameterizedPath(prompt, duplicateContext)).toEqual([]);
                expect(tryParameterizedPath(prompt, partialContext)).toEqual([]);
            }
        );

        it.each([
            ['mute Bass', { type: 'muteTrack', payload: { trackId: 'track-bass', muted: true } }],
            ['unsolo track-bass', { type: 'soloTrack', payload: { trackId: 'track-bass', soloed: false } }],
            [
                'add compressor to Bass track',
                { type: 'addDevice', payload: { trackId: 'track-bass', deviceType: 'Compressor' } },
            ],
            ['remove track-bass', { type: 'removeTrack', payload: { trackId: 'track-bass' } }],
        ])('resolves the unique full name or literal ID for %s', (prompt, action) => {
            const bass = { ...context.tracks[0]!, id: 'track-bass', name: 'Bass' };
            const exactContext = { ...context, tracks: [bass] };

            expect(tryParameterizedPath(prompt, exactContext)).toEqual([action]);
        });

        it('keeps connectors inside quoted names and rejects them outside quotes', () => {
            const namedTrack = { ...context.tracks[0]!, id: 'track-guitar', name: 'Guitar and track-guitar' };
            const namedContext = { ...context, tracks: [namedTrack] };

            expect(tryParameterizedPath('mute "Guitar and track-guitar"', namedContext)).toEqual([
                { type: 'muteTrack', payload: { trackId: 'track-guitar', muted: true } },
            ]);
            expect(tryParameterizedPath('mute Guitar and track-guitar', namedContext)).toEqual([]);
        });

        it('does not discard a real display-name candidate when "track" could be syntax', () => {
            const bass = { ...context.tracks[0]!, id: 'bass', name: 'Bass' };
            const bassTrack = { ...context.tracks[0]!, id: 'bass-track', name: 'Bass Track' };

            expect(tryParameterizedPath('mute Bass track', { ...context, tracks: [bass, bassTrack] })).toEqual([]);
            expect(tryParameterizedPath('mute "Bass Track"', { ...context, tracks: [bass, bassTrack] })).toEqual([
                { type: 'muteTrack', payload: { trackId: 'bass-track', muted: true } },
            ]);
        });

        it('admits only quoted or bounded single-token rename and join values', () => {
            expect(tryParameterizedPath('rename clip to Bridge Solo', context)).toEqual([]);
            expect(tryParameterizedPath('rename clip to match the track name', context)).toEqual([]);
            expect(tryParameterizedPath('rename clip to something warmer', context)).toEqual([]);
            expect(tryParameterizedPath('join session using the invitation in the chat', context)).toEqual([]);
            expect(tryParameterizedPath('rename clip to Verse', context)).toEqual([
                { type: 'renameClip', payload: { clipId: 'c1', name: 'Verse' } },
            ]);
            expect(tryParameterizedPath('rename clip to "Verse and Chorus"', context)).toEqual([
                { type: 'renameClip', payload: { clipId: 'c1', name: 'Verse and Chorus' } },
            ]);
            expect(tryParameterizedPath('rename clip to Verse then mute Bass', context)).toEqual([]);
            expect(tryParameterizedPath('join session "invite and band"', context)).toEqual([
                { type: 'joinCollabSession', payload: { inviteString: 'invite and band', peerName: 'Peer' } },
            ]);
            expect(tryParameterizedPath('join session invite then mute Bass', context)).toEqual([]);
        });

        it('consumes structural optional words without backtracking them into missing values', () => {
            const namedThe = { ...context.tracks[0]!, id: 'the-track', name: 'The' };
            const namedTrack = { ...context.tracks[0]!, id: 'named-track', name: 'Track' };
            const prefixContext = { ...context, tracks: [namedThe, namedTrack] };

            expect(tryParameterizedPath('rename clip to', prefixContext)).toEqual([]);
            expect(tryParameterizedPath('RENAME THE CLIP TO   ', prefixContext)).toEqual([]);
            expect(tryParameterizedPath('rename clip to "to"', prefixContext)).toEqual([
                { type: 'renameClip', payload: { clipId: 'c1', name: 'to' } },
            ]);
            expect(tryParameterizedPath('rename clip "to"', prefixContext)).toEqual([
                { type: 'renameClip', payload: { clipId: 'c1', name: 'to' } },
            ]);
            expect(tryParameterizedPath('rename clip to to', prefixContext)).toEqual([
                { type: 'renameClip', payload: { clipId: 'c1', name: 'to' } },
            ]);
            expect(tryParameterizedPath('rename clip Opening', prefixContext)).toEqual([
                { type: 'renameClip', payload: { clipId: 'c1', name: 'Opening' } },
            ]);
            expect(tryParameterizedPath('rename the clip "Bridge Solo"', prefixContext)).toEqual([
                { type: 'renameClip', payload: { clipId: 'c1', name: 'Bridge Solo' } },
            ]);
            expect(tryParameterizedPath('mute the', prefixContext)).toEqual([]);
            expect(tryParameterizedPath('solo the', prefixContext)).toEqual([]);
            expect(tryParameterizedPath('add eq to the', prefixContext)).toEqual([]);
            expect(tryParameterizedPath('delete track', prefixContext)).toEqual([]);
            expect(tryParameterizedPath('delete the track', prefixContext)).toEqual([]);
            expect(tryParameterizedPath('mute "The"', prefixContext)).toEqual([
                { type: 'muteTrack', payload: { trackId: 'the-track', muted: true } },
            ]);
            expect(tryParameterizedPath('delete "Track"', prefixContext)).toEqual([
                { type: 'removeTrack', payload: { trackId: 'named-track' } },
            ]);
        });

        it('requires one existing clip across the complete selection union for deterministic rename', () => {
            const expected = [{ type: 'renameClip', payload: { clipId: 'c1', name: 'Opening' } }];

            expect(
                tryParameterizedPath('rename clip Opening', {
                    ...context,
                    selectedClipId: null,
                    selectedClipIds: ['c1'],
                })
            ).toEqual(expected);
            expect(
                tryParameterizedPath('rename clip to Opening', {
                    ...context,
                    selectedClipId: 'c1',
                    selectedClipIds: [],
                })
            ).toEqual(expected);
            expect(
                tryParameterizedPath('rename clip Opening', {
                    ...context,
                    selectedClipId: 'c1',
                    selectedClipIds: ['c1'],
                })
            ).toEqual(expected);

            for (const selection of [
                { selectedClipId: null, selectedClipIds: [] },
                { selectedClipId: 'c1', selectedClipIds: ['c1', 'missing-clip'] },
                { selectedClipId: 'missing-clip', selectedClipIds: [] },
            ]) {
                expect(tryParameterizedPath('rename clip Opening', { ...context, ...selection })).toEqual([]);
                expect(tryParameterizedPath('rename clip to "Bridge Solo"', { ...context, ...selection })).toEqual([]);
            }
        });

        it('rejects unquoted sentence continuations while preserving literal punctuation', () => {
            expect(tryParameterizedPath('rename clip to Verse. Mute Bass', context)).toEqual([]);
            expect(tryParameterizedPath('rename clip to Verse: mute Bass', context)).toEqual([]);
            expect(tryParameterizedPath('join session invite-ABC. Mute Bass', context)).toEqual([]);
            expect(tryParameterizedPath('rename clip to "Verse. Mute Bass"', context)).toEqual([
                { type: 'renameClip', payload: { clipId: 'c1', name: 'Verse. Mute Bass' } },
            ]);
            expect(tryParameterizedPath('join session "invite-ABC. Mute Bass"', context)).toEqual([
                {
                    type: 'joinCollabSession',
                    payload: { inviteString: 'invite-ABC. Mute Bass', peerName: 'Peer' },
                },
            ]);
            expect(tryParameterizedPath('rename clip to Lead 2.0', context)).toEqual([]);
            expect(tryParameterizedPath('rename clip to "Lead 2.0"', context)).toEqual([
                { type: 'renameClip', payload: { clipId: 'c1', name: 'Lead 2.0' } },
            ]);
            expect(tryParameterizedPath('rename clip to Dr.Dre', context)).toEqual([
                { type: 'renameClip', payload: { clipId: 'c1', name: 'Dr.Dre' } },
            ]);
        });

        it.each([
            ['mute', { type: 'muteTrack', payload: { trackId: 'literal-all', muted: true } }],
            ['unmute', { type: 'muteTrack', payload: { trackId: 'literal-all', muted: false } }],
            ['solo', { type: 'soloTrack', payload: { trackId: 'literal-all', soloed: true } }],
            ['unsolo', { type: 'soloTrack', payload: { trackId: 'literal-all', soloed: false } }],
        ])('reserves %s all tracks for bulk scope before a colliding display name', (verb, quotedAction) => {
            const allTracks = { ...context.tracks[0]!, id: 'literal-all', name: 'All Tracks' };
            const bass = { ...context.tracks[0]!, id: 'bass', name: 'Bass' };
            const collisionContext = { ...context, tracks: [allTracks, bass] };
            const stateKey = verb.includes('solo') ? 'soloed' : 'muted';
            const stateValue = verb === 'mute' || verb === 'solo';
            const actionType = verb.includes('solo') ? 'soloTrack' : 'muteTrack';

            expect(tryParameterizedPath(`${verb} all tracks`, collisionContext)).toEqual([
                { type: actionType, payload: { trackId: 'literal-all', [stateKey]: stateValue } },
                { type: actionType, payload: { trackId: 'bass', [stateKey]: stateValue } },
            ]);
            expect(tryParameterizedPath(`${verb} "All Tracks"`, collisionContext)).toEqual([quotedAction]);
        });

        it.each([
            ['mute literal-target', { type: 'muteTrack', payload: { trackId: 'literal-target', muted: true } }],
            ['solo literal-target', { type: 'soloTrack', payload: { trackId: 'literal-target', soloed: true } }],
            [
                'add eq to literal-target',
                { type: 'addDevice', payload: { trackId: 'literal-target', deviceType: 'EQ' } },
            ],
            ['delete literal-target', { type: 'removeTrack', payload: { trackId: 'literal-target' } }],
        ])('preserves exact literal-ID authority over a colliding display name for %s', (prompt, action) => {
            const literalTarget = { ...context.tracks[0]!, id: 'literal-target', name: 'Actual ID Target' };
            const nameCollision = { ...context.tracks[0]!, id: 'name-target', name: 'literal-target' };

            expect(tryParameterizedPath(prompt, { ...context, tracks: [literalTarget, nameCollision] })).toEqual([
                action,
            ]);
        });

        it('leaves quantize and transpose for the grounded provider path', () => {
            expect(tryParameterizedPath('transpose up 2 semitones', context)).toEqual([]);
            expect(tryParameterizedPath('transpose down 5 sts', context)).toEqual([]);
            expect(tryParameterizedPath('quantize Piano MIDI to 0.25', context)).toEqual([]);
        });

        it('leaves all executable whole-clip transforms for the grounded provider path', () => {
            expect(tryParameterizedPath('quantize note lengths to 1/16', context)).toEqual([]);
            expect(tryParameterizedPath('set all velocities to 96', context)).toEqual([]);
            expect(tryParameterizedPath('quantize note lengths on Piano MIDI to 1/16', context)).toEqual([]);
            expect(tryParameterizedPath('quantize note lengths to 1/0', context)).toEqual([]);
            expect(tryParameterizedPath('set loop length to 4 beats', context)).toEqual([]);
        });

        it('parses add device to track by name', () => {
            const actions = tryParameterizedPath('add compressor to vocals', context);
            expect(actions).toEqual([{ type: 'addDevice', payload: { trackId: 't1', deviceType: 'Compressor' } }]);
        });

        it('parses deletion for a normal track and protects the master track', () => {
            const master = {
                ...context.tracks[0]!,
                id: 'master',
                name: 'Master',
                kind: 'master' as const,
            };
            const contextWithMaster = { ...context, tracks: [...context.tracks, master] };

            expect(tryParameterizedPath('delete vocals', contextWithMaster)).toEqual([
                { type: 'removeTrack', payload: { trackId: 't1' } },
            ]);
            expect(tryParameterizedPath('delete master', contextWithMaster)).toEqual([]);

            const selectedMasterContext = { ...contextWithMaster, selectedTrackId: 'master' };
            expect(tryPresetMatch('delete track', buildPresetContext(selectedMasterContext))).toEqual([]);
        });

        it('rejects partial and duplicate-name deletion while accepting a literal track ID', () => {
            const bassGuitar = { ...context.tracks[0]!, id: 'bass-guitar', name: 'Bass Guitar' };
            const bassSynth = { ...context.tracks[0]!, id: 'bass-synth', name: 'Bass Synth' };
            const duplicateVocals = { ...context.tracks[0]!, id: 'vocals-copy' };
            const ambiguousContext = {
                ...context,
                tracks: [context.tracks[0]!, duplicateVocals, bassGuitar, bassSynth],
            };

            expect(tryParameterizedPath('delete bass', ambiguousContext)).toEqual([]);
            expect(tryParameterizedPath('delete vocals', ambiguousContext)).toEqual([]);
            expect(tryParameterizedPath('delete t1', ambiguousContext)).toEqual([
                { type: 'removeTrack', payload: { trackId: 't1' } },
            ]);
        });
    });

    describe('tryCompoundFastPath', () => {
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
                {
                    id: 't1',
                    name: 'Vocals',
                    kind: 'audio',
                    muted: false,
                    soloed: false,
                    soloSafe: false,
                    armed: false,
                    gain: 1,
                    pan: 0,
                    automationMode: 'read',
                    clipCount: 0,
                    deviceCount: 0,
                    clips: [],
                    devices: [],
                },
                {
                    id: 't2',
                    name: 'Drums',
                    kind: 'midi',
                    muted: false,
                    soloed: false,
                    soloSafe: false,
                    armed: false,
                    gain: 1,
                    pan: 0,
                    automationMode: 'read',
                    clipCount: 0,
                    deviceCount: 0,
                    clips: [],
                    devices: [],
                },
            ],
            selectedTrackId: 't1',
            selectedClipId: null,
            selectedClipIds: [],
            activeView: 'arrange',
            playheadPosition: 0,
        };

        it('parses multiple track creation', () => {
            const actions = tryCompoundFastPath('add 2 midi tracks', context);
            expect(actions).toEqual([
                { type: 'addTrack', payload: { name: 'Midi 1', kind: 'midi' } },
                { type: 'addTrack', payload: { name: 'Midi 2', kind: 'midi' } },
            ]);
        });

        it('rejects a count above the deterministic creation ceiling without truncating it', () => {
            expect(tryCompoundFastPath('add 33 midi tracks', context)).toBeNull();
        });

        it('rejects a zero track count before allocation', () => {
            expect(tryCompoundFastPath('create 0 audio tracks', context)).toBeNull();
        });

        it('rejects a names clause with a trailing instruction', () => {
            expect(tryCompoundFastPath('create 2 tracks named Bass, Keys then mute Drums', context)).toBeNull();
            expect(tryCompoundFastPath('create 2 tracks named Bass, Keys. Mute Bass', context)).toBeNull();
            expect(tryCompoundFastPath('create 3 tracks named Bass, Keys and mute Drums', context)).toBeNull();
            expect(tryCompoundFastPath('create 2 tracks named Bass and brighten guitar', context)).toBeNull();
            expect(tryCompoundFastPath('create 2 tracks named Bass and play', context)).toBeNull();
            expect(tryCompoundFastPath('create 2 tracks named Bass, "Keys. Mute Bass"', context)).toEqual([
                { type: 'addTrack', payload: { name: 'Bass', kind: 'audio' } },
                { type: 'addTrack', payload: { name: 'Keys. Mute Bass', kind: 'audio' } },
            ]);
            expect(tryCompoundFastPath('create 3 tracks named Bass, Keys and "mute Drums"', context)).toEqual([
                { type: 'addTrack', payload: { name: 'Bass', kind: 'audio' } },
                { type: 'addTrack', payload: { name: 'Keys', kind: 'audio' } },
                { type: 'addTrack', payload: { name: 'mute Drums', kind: 'audio' } },
            ]);
            expect(tryCompoundFastPath('create 2 tracks named Bass and "Play"', context)).toEqual([
                { type: 'addTrack', payload: { name: 'Bass', kind: 'audio' } },
                { type: 'addTrack', payload: { name: 'Play', kind: 'audio' } },
            ]);
        });

        it('requires the explicit name count and preserves quoted delimiters', () => {
            expect(tryCompoundFastPath('create 2 tracks named Bass', context)).toBeNull();
            expect(tryCompoundFastPath('create 2 tracks named Bass, Keys, Drums', context)).toBeNull();
            expect(tryCompoundFastPath('create 2 tracks named Bass,', context)).toBeNull();
            expect(tryCompoundFastPath('create 2 tracks named "Bass, DI", "Keys and Pads"', context)).toEqual([
                { type: 'addTrack', payload: { name: 'Bass, DI', kind: 'audio' } },
                { type: 'addTrack', payload: { name: 'Keys and Pads', kind: 'audio' } },
            ]);
            expect(tryCompoundFastPath('create 2 bus tracks called FX and Drums', context)).toEqual([
                { type: 'addTrack', payload: { name: 'FX', kind: 'bus' } },
                { type: 'addTrack', payload: { name: 'Drums', kind: 'bus' } },
            ]);
            expect(tryCompoundFastPath('create 2 tracks named "Bass, DI, Keys', context)).toBeNull();
        });

        it('parses multiple track creation with names', () => {
            const actions = tryCompoundFastPath('create 2 tracks named bass, keys', context);
            expect(actions).toEqual([
                { type: 'addTrack', payload: { name: 'bass', kind: 'audio' } },
                { type: 'addTrack', payload: { name: 'keys', kind: 'audio' } },
            ]);
        });

        it('requires quotes for ambiguous multiword names and preserves explicitly quoted casing', () => {
            expect(tryCompoundFastPath('create 2 audio tracks named Lead Vocals, Backing Vocals', context)).toBeNull();

            const actions = tryCompoundFastPath('create 2 audio tracks named "Lead Vocals", "Backing Vocals"', context);
            expect(actions).toEqual([
                { type: 'addTrack', payload: { name: 'Lead Vocals', kind: 'audio' } },
                { type: 'addTrack', payload: { name: 'Backing Vocals', kind: 'audio' } },
            ]);

            const upperActions = tryCompoundFastPath(
                'CREATE 2 AUDIO TRACKS NAMED "Lead Vocals", "Backing Vocals"',
                context
            );
            expect(upperActions).toEqual([
                { type: 'addTrack', payload: { name: 'Lead Vocals', kind: 'audio' } },
                { type: 'addTrack', payload: { name: 'Backing Vocals', kind: 'audio' } },
            ]);
        });

        it('parses mute/solo all tracks', () => {
            const actions1 = tryCompoundFastPath('mute all tracks', context);
            expect(actions1).toEqual([
                { type: 'muteTrack', payload: { trackId: 't1', muted: true } },
                { type: 'muteTrack', payload: { trackId: 't2', muted: true } },
            ]);

            const actions2 = tryCompoundFastPath('unsolo all tracks', context);
            expect(actions2).toEqual([
                { type: 'soloTrack', payload: { trackId: 't1', soloed: false } },
                { type: 'soloTrack', payload: { trackId: 't2', soloed: false } },
            ]);
        });

        it('parses multi-device additions', () => {
            const actions = tryCompoundFastPath('add eq, compressor and delay', context);
            expect(actions).toEqual([
                { type: 'addDevice', payload: { trackId: 't1', deviceType: 'EQ' } },
                { type: 'addDevice', payload: { trackId: 't1', deviceType: 'Compressor' } },
                { type: 'addDevice', payload: { trackId: 't1', deviceType: 'Delay' } },
            ]);
        });

        it('rejects malformed or partially known device lists', () => {
            expect(tryCompoundFastPath('add eqcompressor', context)).toBeNull();
            expect(tryCompoundFastPath('add eq compressor', context)).toBeNull();
            expect(tryCompoundFastPath('add eq, mystery and delay', context)).toBeNull();
            expect(tryCompoundFastPath('add constructor and eq', context)).toBeNull();
            expect(tryCompoundFastPath('add __proto__ and eq', context)).toBeNull();
            expect(tryParameterizedPath('add constructor to t1', context)).toEqual([]);
            expect(tryParameterizedPath('add __proto__ to t1', context)).toEqual([]);
        });

        it('leaves creative and partially matched sound-design requests for whole-request planning', () => {
            expect(tryCompoundFastPath('make it warmer', context)).toBeNull();
            expect(tryCompoundFastPath('make it warm then mute Bass', context)).toBeNull();
            expect(tryCompoundFastPath('make it warm without adding devices', context)).toBeNull();
        });
    });

    describe('resolveTrackReference', () => {
        const context = {
            tracks: [
                { id: 't1', name: 'Lead Vocals' },
                { id: 't2', name: 'Bass' },
            ],
        } as ProjectContext;

        it('finds track by exact lower case name', () => {
            expect(resolveTrackReference(context, 'lead vocals')?.id).toBe('t1');
            expect(resolveTrackReference(context, 'bass')?.id).toBe('t2');
        });

        it('finds track by ignoring "track" suffix', () => {
            expect(resolveTrackReference(context, 'bass track')?.id).toBe('t2');
        });

        it('rejects partial inclusion', () => {
            expect(resolveTrackReference(context, 'vocals')).toBeUndefined();
        });

        it('returns undefined if not found', () => {
            expect(resolveTrackReference(context, 'drums')).toBeUndefined();
        });
    });
});
