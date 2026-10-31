import { describe, expect, it } from 'vitest';

import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext, type ProjectContextTrack } from '../../../models/ProjectContext';
import { createCompiledTargetAdmission, type CompiledTargetCallTerms } from '../admitCompiledTargets';

function createTrack(id: string, name: string): ProjectContextTrack {
    return {
        id,
        name,
        kind: 'audio',
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        automationMode: 'read',
        clipCount: 0,
        deviceCount: 0,
        clips: [],
        devices: [],
    };
}

function createContext(tracks: ProjectContextTrack[]): ProjectContext {
    return {
        tempo: 120,
        timeSignature: [4, 4],
        isPlaying: false,
        isRecording: false,
        isLooping: false,
        loopStart: 0,
        loopEnd: 16,
        punchInEnabled: false,
        punchInBeat: 0,
        punchOutBeat: 16,
        metronomeEnabled: false,
        metronomeVolume: 0.5,
        masterGain: 0.8,
        tracks,
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        activeView: 'mix',
        playheadPosition: 0,
    };
}

const PROMPT = 'Mute every track; leave Bass alone';

/** Bass protected by name, beside the same project once that track is called Synth. */
const namedBass = createContext([createTrack('track-bass', 'Bass'), createTrack('track-keys', 'Keys')]);
const renamedBass = createContext([createTrack('track-bass', 'Synth'), createTrack('track-keys', 'Keys')]);

function createAdmission() {
    return createCompiledTargetAdmission({
        catalog: getExecutableAppActionGroundingCatalog(),
        compilerExcludedIds: new Set(),
        prompt: PROMPT,
        valueTexts: [],
    });
}

function muteTerms(context: ProjectContext, targetId: string): CompiledTargetCallTerms {
    return { argument: 'trackId', capability: 'track', context, referenceResolved: true, targetIds: [targetId] };
}

describe('compiled target admission across one batch', () => {
    it('reads the request against the project each call names, never one an earlier call read', () => {
        const admission = createAdmission();

        expect(admission(muteTerms(namedBass, 'track-bass'))).toEqual({
            status: 'refused',
            reason: 'protected-or-excluded',
        });
        expect(admission(muteTerms(renamedBass, 'track-bass'))).toEqual({ status: 'admitted' });
        expect(createAdmission()(muteTerms(renamedBass, 'track-bass'))).toEqual({ status: 'admitted' });
    });

    it('checks each call of one reading against its own targets', () => {
        const admission = createAdmission();

        expect(admission(muteTerms(namedBass, 'track-keys'))).toEqual({ status: 'admitted' });
        expect(admission(muteTerms(namedBass, 'track-bass'))).toEqual({
            status: 'refused',
            reason: 'protected-or-excluded',
        });
    });
});
