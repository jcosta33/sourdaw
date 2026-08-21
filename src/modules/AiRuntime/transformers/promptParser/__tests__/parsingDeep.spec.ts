import { describe, it, expect } from 'vitest';

import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { type ProjectContext } from '../../../models/ProjectContext';
import { buildPresetContext, findTrack, isComplexPrompt, tryParameterizedPath } from '../parsing';

function makeCtx(overrides: Partial<ProjectContext> = {}): ProjectContext {
    return {
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
                name: 'Drums',
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
                clips: [{ id: 'c1', name: 'Beat', type: 'midi', startBeat: 0, endBeat: 4, noteCount: 8 }],
                devices: [],
            },
            {
                id: 't2',
                name: 'Bass',
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
        selectedClipId: 'c1',
        selectedClipIds: ['c1'],
        activeView: 'arrange',
        playheadPosition: 0,
        ...overrides,
    };
}

const ctx = makeCtx();

describe('tryParameterizedPath', () => {
    it('parses tempo command', () => {
        const result = tryParameterizedPath('set tempo to 140', ctx);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ type: 'setTempo', payload: { bpm: 140 } });
    });

    it('parses tempo without "set"', () => {
        const result = tryParameterizedPath('tempo 120', ctx);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ type: 'setTempo', payload: { bpm: 120 } });
    });

    it('parses gain as percentage', () => {
        const result = tryParameterizedPath('set gain to 80%', ctx);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ type: 'setTrackGain', payload: { trackId: 't1', gain: 0.8 } });
    });

    it('parses pan value', () => {
        const result = tryParameterizedPath('set pan to -25', ctx);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ type: 'setTrackPan', payload: { trackId: 't1', pan: -25 } });
    });

    it('parses rename clip', () => {
        const result = tryParameterizedPath('rename clip to Verse', ctx);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ type: 'renameClip', payload: { clipId: 'c1', name: 'Verse' } });
    });

    // `#954` retired the transpose and quantize fast paths so these prompts
    // reach the grounded provider path instead, where the clip and the note set
    // are resolved exactly rather than guessed from the prompt text. Its sibling
    // `parsing.spec.ts` was updated to assert the same thing; this file was
    // missed and asserted the retired behaviour, which is why `main` went red.
    //
    // The capability itself is still covered, on the path that now owns it:
    // `llmActionBridge.spec.ts`, `bridgeGroundedLlmToolCalls.spec.ts`,
    // `validateActionPayload.spec.ts` and `midiNoteTransformUndo.spec.ts`.
    it('leaves quantize and transpose for the grounded provider path', () => {
        expect(tryParameterizedPath('transpose up 5 semitones', ctx)).toEqual([]);
        expect(tryParameterizedPath('transpose down 3', ctx)).toEqual([]);
        expect(tryParameterizedPath('quantize', ctx)).toEqual([]);
        expect(tryParameterizedPath('quantize to 1/16', ctx)).toEqual([]);
    });

    it('leaves whole-clip velocity changes for the grounded provider path', () => {
        expect(tryParameterizedPath('set velocity to 100', ctx)).toEqual([]);
    });

    it('parses humanize with amount', () => {
        const result = tryParameterizedPath('humanize 40%', ctx);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ type: 'humanizeNotes', payload: { clipId: 'c1', amount: 0.4 } });
    });

    it('parses humanize default', () => {
        const result = tryParameterizedPath('humanize', ctx);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ type: 'humanizeNotes' });
    });

    it('returns empty for unrecognized input', () => {
        const result = tryParameterizedPath('make it sound like a radio', ctx);
        expect(result).toEqual([]);
    });

    it('returns empty when no track selected for gain', () => {
        const result = tryParameterizedPath('set gain to 50%', makeCtx({ selectedTrackId: null }));
        expect(result).toEqual([]);
    });

    it('returns empty when no clip selected for transpose', () => {
        const result = tryParameterizedPath('transpose up 3', makeCtx({ selectedClipId: null }));
        expect(result).toEqual([]);
    });

    it('clamps gain to the fader ceiling, not unity', () => {
        const result = tryParameterizedPath('set gain to 200%', ctx);
        expect(result[0]).toMatchObject({ type: 'setTrackGain', payload: { gain: FADER_MAX_GAIN } });
    });

    it('clamps pan to -50 to 50', () => {
        const result = tryParameterizedPath('set pan to 100', ctx);
        expect(result[0]).toMatchObject({ type: 'setTrackPan', payload: { pan: 50 } });
    });
});

describe('buildPresetContext', () => {
    it('extracts selected track and clip info', () => {
        const result = buildPresetContext(ctx);
        expect(result.selectedTrackId).toBe('t1');
        expect(result.selectedClipId).toBe('c1');
        expect(result.selectedClipType).toBe('midi');
        expect(result.trackCount).toBe(2);
    });

    it('handles no selection', () => {
        const result = buildPresetContext(makeCtx({ selectedTrackId: null, selectedClipId: null }));
        expect(result.selectedTrackId).toBeUndefined();
        expect(result.selectedClipId).toBeUndefined();
        expect(result.trackCount).toBe(2);
    });
});

describe('isComplexPrompt', () => {
    it('flags numeric track counts', () => {
        expect(isComplexPrompt('add 4 tracks')).toBe(true);
    });

    it('flags sequential "then" prompts', () => {
        expect(isComplexPrompt('set tempo to 120 then add a track')).toBe(true);
    });

    it('flags sound-design descriptors', () => {
        expect(isComplexPrompt('make it sound warm and lo-fi')).toBe(true);
    });

    it('treats a single parameter command as simple', () => {
        expect(isComplexPrompt('set tempo to 120')).toBe(false);
    });
});

describe('findTrack', () => {
    it('matches by exact name (case-insensitive)', () => {
        expect(findTrack(ctx, 'drums')?.id).toBe('t1');
    });

    it('strips a trailing "track" suffix', () => {
        expect(findTrack(ctx, 'Bass track')?.id).toBe('t2');
    });

    it('falls back to a partial match', () => {
        expect(findTrack(ctx, 'Dru')?.id).toBe('t1');
    });

    it('returns undefined when nothing matches', () => {
        expect(findTrack(ctx, 'Strings')).toBeUndefined();
    });
});
