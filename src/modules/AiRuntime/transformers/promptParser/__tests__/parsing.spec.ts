import { describe, it, expect } from 'vitest';

import { type ProjectContext } from '../../../models/ProjectContext';
import {
    isComplexPrompt,
    buildPresetContext,
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
                tracks: [
                    {
                        id: 't1',
                        name: 'Vocals',
                        kind: 'audio',
                        muted: false,
                        soloed: false,
                        armed: false,
                        gain: 1,
                        pan: 0,
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
            expect(presetContext.selectedClipId).toBe('c1');
            expect(presetContext.selectedClipType).toBe('audio');
            expect(presetContext.trackCount).toBe(1);
        });
    });

    describe('tryParameterizedPath', () => {
        const context: ProjectContext = {
            tempo: 120,
            timeSignature: [4, 4],
            tracks: [
                {
                    id: 't1',
                    name: 'Vocals',
                    kind: 'audio',
                    muted: false,
                    soloed: false,
                    armed: false,
                    gain: 1,
                    pan: 0,
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

        it('parses transpose', () => {
            const actions1 = tryParameterizedPath('transpose up 2 semitones', context);
            expect(actions1).toEqual([{ type: 'transposeNotes', payload: { clipId: 'c1', semitones: 2 } }]);

            const actions2 = tryParameterizedPath('transpose down 5 sts', context);
            expect(actions2).toEqual([{ type: 'transposeNotes', payload: { clipId: 'c1', semitones: -5 } }]);
        });

        it('parses add device to track by name', () => {
            const actions = tryParameterizedPath('add compressor to vocals', context);
            expect(actions).toEqual([{ type: 'addDevice', payload: { trackId: 't1', deviceType: 'Compressor' } }]);
        });
    });

    describe('tryCompoundFastPath', () => {
        const context: ProjectContext = {
            tempo: 120,
            timeSignature: [4, 4],
            tracks: [
                {
                    id: 't1',
                    name: 'Vocals',
                    kind: 'audio',
                    muted: false,
                    soloed: false,
                    armed: false,
                    gain: 1,
                    pan: 0,
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
                    armed: false,
                    gain: 1,
                    pan: 0,
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
