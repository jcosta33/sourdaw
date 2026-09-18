import { describe, expect, it } from 'vitest';

import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../../../models/ProjectContext';
import { createGroundingAdmissionStrategyRegistry } from '../createGroundingAdmissionStrategyRegistry';
import {
    groundPreScopeAdmission,
    preScopeActionNames,
    preScopeAdmissionStrategyDefinitions,
    type PreScopeActionName,
    type PreScopeAdmissionInput,
} from '../preScopeAdmissionStrategy';

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 4,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 4,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [
        {
            id: 'track-vocals',
            name: 'Vocals',
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
        },
    ],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

describe('pre-scope admission strategies', () => {
    it('registers exactly the pre-scope action names', () => {
        const registry = createGroundingAdmissionStrategyRegistry<
            PreScopeActionName,
            Omit<PreScopeAdmissionInput, 'actionName'>
        >(
            'pre-scope admission',
            preScopeAdmissionStrategyDefinitions,
            getExecutableAppActionGroundingCatalog(),
            preScopeActionNames
        );

        expect([...registry.keys()]).toEqual([...preScopeActionNames]);
    });

    it('leaves an action without a pre-scope strategy unchanged', () => {
        expect(groundPreScopeAdmission({ actionName: 'addMarker', context, prompt: 'add a marker at beat 4' })).toBe(
            null
        );
    });

    it('rejects a mute whose universal scope carries a restriction', () => {
        expect(
            groundPreScopeAdmission({ actionName: 'muteTrack', context, prompt: 'mute all audio tracks but Vocals' })
        ).toBe('Provider mute scope is not explicitly universal');
        expect(groundPreScopeAdmission({ actionName: 'muteTrack', context, prompt: 'mute all audio tracks' })).toBe(
            null
        );
    });

    it('rejects a solo whose universal scope carries a restriction', () => {
        expect(
            groundPreScopeAdmission({
                actionName: 'soloTrack',
                context,
                prompt: 'solo all audio tracks except Vocals',
            })
        ).toBe('Provider solo scope is not explicitly universal');
        expect(groundPreScopeAdmission({ actionName: 'soloTrack', context, prompt: 'solo all audio tracks' })).toBe(
            null
        );
    });

    it('rejects a transport stop that the request never asked for', () => {
        expect(groundPreScopeAdmission({ actionName: 'stopPlayback', context, prompt: 'mute all audio tracks' })).toBe(
            'Provider action is not grounded in an explicit transport-stop request'
        );
        expect(groundPreScopeAdmission({ actionName: 'stopPlayback', context, prompt: 'stop the transport' })).toBe(
            null
        );
    });

    it('rejects a clip loop length without one direct clip request in beats', () => {
        expect(
            groundPreScopeAdmission({ actionName: 'setClipLoopLength', context, prompt: 'make the clip loop longer' })
        ).toBe('Provider clip loop-length action requires one direct named or selected clip request in beats');
        expect(
            groundPreScopeAdmission({
                actionName: 'setClipLoopLength',
                context,
                prompt: 'set the selected clip loop length to 4 beats',
            })
        ).toBe(null);
    });
});
