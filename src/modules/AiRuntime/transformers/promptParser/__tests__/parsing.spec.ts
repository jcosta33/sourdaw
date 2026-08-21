import { describe, it, expect } from 'vitest';

import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { type ProjectContext } from '../../../models/ProjectContext';
import {
    isComplexPrompt,
    buildPresetContext,
    tryPresetMatch,
    tryParameterizedPath,
    tryCompoundFastPath,
    matchSoundDesignRecipe,
    findTrack,
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
                    clipCount: 0,
                    deviceCount: 0,
                    clips: [],
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

        it('still clamps a volume past the fader ceiling, at the real reachable maximum', () => {
            const actions = tryParameterizedPath('set volume to 500%', context);
            expect(actions).toEqual([{ type: 'setTrackGain', payload: { trackId: 't1', gain: FADER_MAX_GAIN } }]);
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

        it('parses multiple track creation with names', () => {
            const actions = tryCompoundFastPath('create 2 tracks named bass, keys', context);
            expect(actions).toEqual([
                { type: 'addTrack', payload: { name: 'bass', kind: 'audio' } },
                { type: 'addTrack', payload: { name: 'keys', kind: 'audio' } },
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
    });

    describe('matchSoundDesignRecipe', () => {
        it('matches warmth', () => {
            expect(matchSoundDesignRecipe('make it warmer', 't1')).toEqual([
                { type: 'addDevice', payload: { trackId: 't1', deviceType: 'EQ' } },
                { type: 'addDevice', payload: { trackId: 't1', deviceType: 'Compressor' } },
            ]);
        });

        it('matches lofi', () => {
            expect(matchSoundDesignRecipe('give it a lofi vibe', 't1')).toEqual([
                { type: 'addDevice', payload: { trackId: 't1', deviceType: 'EQ' } },
                { type: 'addDevice', payload: { trackId: 't1', deviceType: 'BitCrusher' } },
                { type: 'addDevice', payload: { trackId: 't1', deviceType: 'Compressor' } },
            ]);
        });

        it('matches width', () => {
            expect(matchSoundDesignRecipe('make it sound wider', 't1')).toEqual([
                { type: 'addDevice', payload: { trackId: 't1', deviceType: 'Chorus' } },
                { type: 'addDevice', payload: { trackId: 't1', deviceType: 'Delay' } },
            ]);
        });

        it('returns null if no recipe matches', () => {
            expect(matchSoundDesignRecipe('make it completely weird', 't1')).toBeNull();
        });
    });

    describe('findTrack', () => {
        const context = {
            tracks: [
                { id: 't1', name: 'Lead Vocals' },
                { id: 't2', name: 'Bass' },
            ],
        } as ProjectContext;

        it('finds track by exact lower case name', () => {
            expect(findTrack(context, 'lead vocals')?.id).toBe('t1');
            expect(findTrack(context, 'bass')?.id).toBe('t2');
        });

        it('finds track by ignoring "track" suffix', () => {
            expect(findTrack(context, 'bass track')?.id).toBe('t2');
        });

        it('finds track by partial inclusion', () => {
            expect(findTrack(context, 'vocals')?.id).toBe('t1');
        });

        it('returns undefined if not found', () => {
            expect(findTrack(context, 'drums')).toBeUndefined();
        });
    });
});
