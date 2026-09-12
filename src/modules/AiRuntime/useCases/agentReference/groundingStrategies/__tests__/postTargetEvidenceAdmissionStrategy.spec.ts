import { describe, expect, it } from 'vitest';

import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../../../models/ProjectContext';
import { createGroundingAdmissionStrategyRegistry } from '../createGroundingAdmissionStrategyRegistry';
import {
    groundPostTargetEvidenceAdmission,
    postTargetEvidenceActionNames,
    postTargetEvidenceAdmissionStrategyDefinitions,
    type PostTargetEvidenceActionName,
    type PostTargetEvidenceAdmissionInput,
} from '../postTargetEvidenceAdmissionStrategy';
import { type ActionPromptScope } from '../promptScope';

const introClip = {
    id: 'clip-intro',
    name: 'Intro',
    type: 'audio' as const,
    startBeat: 0,
    endBeat: 4,
    noteCount: 0,
};

const verseClip = {
    id: 'clip-verse',
    name: 'Verse',
    type: 'audio' as const,
    startBeat: 4,
    endBeat: 8,
    noteCount: 0,
};

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
            id: 'track-bass',
            name: 'Bass',
            kind: 'audio',
            muted: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            gain: 0.8,
            pan: 0,
            automationMode: 'read',
            clipCount: 2,
            deviceCount: 0,
            clips: [introClip, verseClip],
            devices: [],
        },
    ],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

function scope(text: string, matchedIntentPhrase: string): ActionPromptScope {
    return { directional: false, masked: text, matchedIntentPhrase, text };
}

describe('post-target evidence admission strategies', () => {
    it('registers exactly the post-target evidence action names', () => {
        const registry = createGroundingAdmissionStrategyRegistry<
            PostTargetEvidenceActionName,
            Omit<PostTargetEvidenceAdmissionInput, 'actionName'>
        >(
            'post-target evidence admission',
            postTargetEvidenceAdmissionStrategyDefinitions,
            getExecutableAppActionGroundingCatalog(),
            postTargetEvidenceActionNames
        );

        expect([...registry.keys()]).toEqual([...postTargetEvidenceActionNames]);
    });

    it('leaves an action without a post-target evidence strategy unchanged', () => {
        expect(
            groundPostTargetEvidenceAdmission({
                actionName: 'addMarker',
                actionScope: scope('add a marker at beat 4', 'add marker'),
                admitsPlanCreatedObject: false,
                context,
                groundedArguments: { beat: 4 },
            })
        ).toBe(null);
    });

    it('rejects a move whose destination is not the direct object of the request', () => {
        expect(
            groundPostTargetEvidenceAdmission({
                actionName: 'moveClip',
                actionScope: scope('move Intro to beat 8', 'move'),
                admitsPlanCreatedObject: false,
                context,
                groundedArguments: { clipId: introClip.id, trackId: 'track-bass' },
            })
        ).toBe('Provider clip destination is not the direct object of the move request');
        expect(
            groundPostTargetEvidenceAdmission({
                actionName: 'moveClip',
                actionScope: scope('move Intro to Bass', 'move'),
                admitsPlanCreatedObject: false,
                context,
                groundedArguments: { clipId: introClip.id, trackId: 'track-bass' },
            })
        ).toBe(null);
    });

    it('rejects a glue whose clips are not one direct pair in the request', () => {
        expect(
            groundPostTargetEvidenceAdmission({
                actionName: 'glueClips',
                actionScope: scope('glue Intro and Verse', 'glue'),
                admitsPlanCreatedObject: false,
                context,
                groundedArguments: { clipIds: [introClip.id] },
            })
        ).toBe('Provider clips are not the direct objects of one glue request');
        expect(
            groundPostTargetEvidenceAdmission({
                actionName: 'glueClips',
                actionScope: scope('glue Intro and Verse', 'glue'),
                admitsPlanCreatedObject: false,
                context,
                groundedArguments: { clipIds: [introClip.id, verseClip.id] },
            })
        ).toBe(null);
    });

    it('rejects a split that is not scoped to the whole clip', () => {
        expect(
            groundPostTargetEvidenceAdmission({
                actionName: 'splitClip',
                actionScope: scope('split the second half of Intro at beat 2', 'split'),
                admitsPlanCreatedObject: false,
                context,
                groundedArguments: { beat: 2, clipId: introClip.id },
            })
        ).toBe('Provider clip split is not scoped to the whole clip');
        expect(
            groundPostTargetEvidenceAdmission({
                actionName: 'splitClip',
                actionScope: scope('split the clip at beat 2', 'split'),
                admitsPlanCreatedObject: false,
                context,
                groundedArguments: { beat: 2, clipId: introClip.id },
            })
        ).toBe(null);
    });

    it('rejects a clip creation without one explicit name, beat range and container', () => {
        const actionScope = scope('add a clip named Verse on Bass from beat 0 to beat 4', 'add clip');

        expect(
            groundPostTargetEvidenceAdmission({
                actionName: 'addClip',
                actionScope,
                admitsPlanCreatedObject: false,
                context,
                groundedArguments: { endBeat: 8, name: 'Verse', startBeat: 0, trackId: 'track-bass' },
            })
        ).toBe('Provider clip creation does not match one explicit name and beat range');
        expect(
            groundPostTargetEvidenceAdmission({
                actionName: 'addClip',
                actionScope,
                admitsPlanCreatedObject: false,
                context,
                groundedArguments: { endBeat: 4, name: 'Verse', startBeat: 0, trackId: 'track-missing' },
            })
        ).toBe('Provider clip container is not the direct object of the creation request');
        expect(
            groundPostTargetEvidenceAdmission({
                actionName: 'addClip',
                actionScope,
                admitsPlanCreatedObject: false,
                context,
                groundedArguments: { endBeat: 4, name: 'Verse', startBeat: 0, trackId: 'track-bass' },
            })
        ).toBe(null);
    });
});
