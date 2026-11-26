import { describe, expect, it } from 'vitest';

import { type ProjectContext, type ProjectContextClip, type ProjectContextTrack } from '../../../models/ProjectContext';
import { bridgeGroundedLlmToolCalls } from '../bridgeGroundedLlmToolCalls';

function track(id: string, name: string, kind: string, clips: ProjectContextClip[]): ProjectContextTrack {
    return {
        id,
        name,
        kind,
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        automationMode: 'read',
        outputId: 'master',
        clipCount: clips.length,
        deviceCount: 0,
        clips,
        devices: [],
        sends: [],
    };
}

const hook: ProjectContextClip = {
    id: 'clip-hook',
    name: 'Hook',
    type: 'midi',
    startBeat: 0,
    endBeat: 8,
    gain: 1,
    locked: false,
    noteCount: 4,
};
const verse: ProjectContextClip = {
    id: 'clip-verse',
    name: 'Verse',
    type: 'audio',
    startBeat: 0,
    endBeat: 8,
    gain: 1,
    locked: false,
    noteCount: 0,
};

function context(selectedClipId: string | null): ProjectContext {
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
        punchOutBeat: 0,
        metronomeEnabled: false,
        metronomeVolume: 0,
        masterGain: 1,
        tracks: [
            track('track-lead', 'Lead', 'midi', [hook]),
            track('track-keys', 'Keys', 'midi', []),
            track('track-vocals', 'Vocals', 'audio', [verse]),
            track('master', 'Master', 'master', []),
        ],
        selectedTrackId: null,
        selectedClipId,
        selectedClipIds: selectedClipId ? [selectedClipId] : [],
        activeView: 'arrange',
        playheadPosition: 0,
    };
}

function ground(name: string, args: Record<string, unknown>, prompt: string, selectedClipId: string | null = null) {
    return bridgeGroundedLlmToolCalls({
        calls: [{ name, arguments: args }],
        prompt,
        context: context(selectedClipId),
        markerSignatures: [],
        sectionSignatures: [],
    });
}

describe('clip structure commands grounded from their documented prompts', () => {
    const instance = { sourceClipId: 'clip-hook', targetTrackId: 'track-keys', startBeat: 16 };
    const instanceAction = { type: 'createPatternInstance', payload: instance };

    const PROMPT = 'make a pattern instance of Hook onto the Keys track at beat 16';

    it('binds the start beat the prompt states', () => {
        const result = ground('createPatternInstance', instance, PROMPT);

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([instanceAction]);
    });

    it('refuses a pattern instance whose prompt states no beat', () => {
        const result = ground('createPatternInstance', instance, 'make a pattern instance of Hook onto the Keys track');

        expect(result.actions).toEqual([]);
        expect(result.rejections).toHaveLength(1);
    });

    it('refuses a pattern instance at a beat the prompt does not state', () => {
        const result = ground('createPatternInstance', { ...instance, startBeat: 32 }, PROMPT);

        expect(result.actions).toEqual([]);
        expect(result.rejections).toHaveLength(1);
    });

    it('grounds detaching a pattern instance named in the prompt', () => {
        const result = ground('detachPatternInstance', { clipId: 'clip-hook' }, 'detach pattern instance Hook');

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([{ type: 'detachPatternInstance', payload: { clipId: 'clip-hook' } }]);
    });

    it.each([
        ['reverse this clip', 'clip-verse'],
        ['reverse the selected clip', 'clip-verse'],
        ['reverse the Verse clip', null],
    ])('grounds "%s" to the audio clip', (prompt, selectedClipId) => {
        const result = ground('reverseClip', { clipId: 'clip-verse' }, prompt, selectedClipId);

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([{ type: 'reverseClip', payload: { clipId: 'clip-verse' } }]);
    });
});
