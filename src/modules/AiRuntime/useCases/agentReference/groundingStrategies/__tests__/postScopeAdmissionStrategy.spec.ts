import { describe, expect, it } from 'vitest';

import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext, type ProjectContextTrack } from '../../../../models/ProjectContext';
import {
    createPostScopeAdmissionStrategyRegistry,
    postScopeAdmissionActionNames,
    type PostScopeAdmissionActionName,
} from '../createPostScopeAdmissionStrategyRegistry';
import { groundPostScopeAdmission, postScopeAdmissionStrategyDefinitions } from '../postScopeAdmissionStrategy';
import { type ActionPromptScope } from '../promptScope';

const catalog = getExecutableAppActionGroundingCatalog();

const vocalsTrack: ProjectContextTrack = {
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
    outputId: 'master',
    clipCount: 1,
    deviceCount: 0,
    clips: [{ id: 'clip-intro', name: 'Intro', type: 'audio', startBeat: 0, endBeat: 8, noteCount: 0 }],
    devices: [],
    sends: [],
};

const guitarTrack: ProjectContextTrack = {
    id: 'track-guitar',
    name: 'Guitar',
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
    clips: [],
    devices: [],
    sends: [],
};

const masterTrack: ProjectContextTrack = {
    id: 'master',
    name: 'Master',
    kind: 'master',
    muted: false,
    soloed: false,
    soloSafe: false,
    armed: false,
    gain: 0.8,
    pan: 0,
    automationMode: 'read',
    outputId: 'hw_out',
    clipCount: 0,
    deviceCount: 0,
    clips: [],
    devices: [],
    sends: [],
};

const keysTrack: ProjectContextTrack = {
    id: 'track-keys',
    name: 'Keys',
    kind: 'midi',
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
    clips: [],
    devices: [],
    sends: [],
};

const clipContext: ProjectContext = {
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
    tracks: [vocalsTrack, guitarTrack, masterTrack],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

const addClipContext: ProjectContext = { ...clipContext, tracks: [...clipContext.tracks, keysTrack] };

/** The strategies under test read `prompt`, not `actionScope`, except `setPlayback`. */
function unusedActionScope(): ActionPromptScope {
    return { masked: '', text: '', directional: false, matchedIntentPhrase: '' };
}

function buildActionScope(text: string): ActionPromptScope {
    return { masked: text, text, directional: false, matchedIntentPhrase: text };
}

describe('post-scope admission strategies', () => {
    it('holds exactly the four post-scope action names', () => {
        expect(postScopeAdmissionActionNames).toEqual(['moveClip', 'splitClip', 'addClip', 'setPlayback']);
        expect(() =>
            createPostScopeAdmissionStrategyRegistry<PostScopeAdmissionActionName>(
                postScopeAdmissionStrategyDefinitions,
                catalog,
                postScopeAdmissionActionNames
            )
        ).not.toThrow();
    });

    it('rejects a duplicate strategy registration', () => {
        expect(() =>
            createPostScopeAdmissionStrategyRegistry(
                [
                    { name: 'moveClip', transform: () => null },
                    { name: 'moveClip', transform: () => null },
                ],
                catalog,
                ['moveClip']
            )
        ).toThrow('Duplicate post-scope admission strategy: moveClip');
    });

    it('rejects a missing expected strategy definition', () => {
        expect(() =>
            createPostScopeAdmissionStrategyRegistry<PostScopeAdmissionActionName>(
                [{ name: 'moveClip', transform: () => null }],
                catalog,
                ['moveClip', 'splitClip']
            )
        ).toThrow('Missing post-scope admission strategy: splitClip');
    });

    it('grounds moveClip only against exactly one explicit absolute beat per clause', () => {
        expect(
            groundPostScopeAdmission({
                actionName: 'moveClip',
                actionScope: unusedActionScope(),
                admitsPlanCreatedObject: false,
                catalog,
                context: clipContext,
                plannedActionNames: ['moveClip'],
                prompt: 'move the Intro clip to Guitar at beat 16',
                sameActionCallCount: 1,
            })
        ).toBeNull();

        expect(
            groundPostScopeAdmission({
                actionName: 'moveClip',
                actionScope: unusedActionScope(),
                admitsPlanCreatedObject: false,
                catalog,
                context: clipContext,
                plannedActionNames: ['moveClip'],
                prompt: 'move the Intro clip to Guitar at beat 16 and beat 32',
                sameActionCallCount: 1,
            })
        ).toBe('Provider clip move requires exactly one explicit absolute beat per move');
    });

    it('grounds splitClip only against exactly one explicit absolute beat per clause', () => {
        expect(
            groundPostScopeAdmission({
                actionName: 'splitClip',
                actionScope: unusedActionScope(),
                admitsPlanCreatedObject: false,
                catalog,
                context: clipContext,
                plannedActionNames: ['splitClip'],
                prompt: 'split the Intro clip at beat 4',
                sameActionCallCount: 1,
            })
        ).toBeNull();

        expect(
            groundPostScopeAdmission({
                actionName: 'splitClip',
                actionScope: unusedActionScope(),
                admitsPlanCreatedObject: false,
                catalog,
                context: clipContext,
                plannedActionNames: ['splitClip'],
                prompt: 'split the Intro clip at beat 4 and beat 6',
                sameActionCallCount: 1,
            })
        ).toBe('Provider clip split requires exactly one explicit absolute beat per split');
    });

    it('grounds addClip against prompt evidence unless the batch already admits the plan-created object', () => {
        const prompt = 'create a MIDI clip on Keys from beat 8 to beat 16';

        expect(
            groundPostScopeAdmission({
                actionName: 'addClip',
                actionScope: unusedActionScope(),
                admitsPlanCreatedObject: false,
                catalog,
                context: addClipContext,
                plannedActionNames: ['addClip'],
                prompt,
                sameActionCallCount: 1,
            })
        ).toBe('Provider clip creation requires one exact explicit beat range per clip');

        expect(
            groundPostScopeAdmission({
                actionName: 'addClip',
                actionScope: unusedActionScope(),
                admitsPlanCreatedObject: true,
                catalog,
                context: addClipContext,
                plannedActionNames: ['addClip'],
                prompt,
                sameActionCallCount: 1,
            })
        ).toBeNull();
    });

    it('grounds setPlayback only against an explicit playback request', () => {
        expect(
            groundPostScopeAdmission({
                actionName: 'setPlayback',
                actionScope: buildActionScope('play'),
                admitsPlanCreatedObject: false,
                catalog,
                context: clipContext,
                plannedActionNames: ['setPlayback'],
                prompt: 'play',
                sameActionCallCount: 1,
            })
        ).toBeNull();

        expect(
            groundPostScopeAdmission({
                actionName: 'setPlayback',
                actionScope: buildActionScope('toggle playback'),
                admitsPlanCreatedObject: false,
                catalog,
                context: clipContext,
                plannedActionNames: ['setPlayback'],
                prompt: 'toggle playback',
                sameActionCallCount: 1,
            })
        ).toBe('Provider action is not grounded in an explicit playback request');
    });

    it('returns null for an action outside the post-scope family', () => {
        expect(
            groundPostScopeAdmission({
                actionName: 'setTempo',
                actionScope: unusedActionScope(),
                admitsPlanCreatedObject: false,
                catalog,
                context: clipContext,
                plannedActionNames: ['setTempo'],
                prompt: 'set tempo to 130',
                sameActionCallCount: 1,
            })
        ).toBeNull();
    });
});
