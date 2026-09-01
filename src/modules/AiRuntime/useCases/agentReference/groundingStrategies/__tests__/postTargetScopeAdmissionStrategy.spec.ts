import { describe, expect, it } from 'vitest';

import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../../../models/ProjectContext';
import {
    createPostTargetScopeAdmissionStrategyRegistry,
    postTargetScopeActionNames,
    type PostTargetScopeActionName,
} from '../createPostTargetScopeAdmissionStrategyRegistry';
import {
    groundPostTargetScopeAdmission,
    postTargetScopeAdmissionStrategyDefinitions,
} from '../postTargetScopeAdmissionStrategy';

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
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

describe('post-target scope admission strategies', () => {
    it('rejects duplicate registrations', () => {
        expect(() =>
            createPostTargetScopeAdmissionStrategyRegistry(
                [
                    { name: 'removeTrack', transform: () => null },
                    { name: 'removeTrack', transform: () => null },
                ],
                getExecutableAppActionGroundingCatalog(),
                ['removeTrack']
            )
        ).toThrow('Duplicate post-target scope admission strategy: removeTrack');
    });

    it('proves every registered strategy is in the canonical command grounding catalog', () => {
        const catalog = getExecutableAppActionGroundingCatalog();

        expect(() =>
            createPostTargetScopeAdmissionStrategyRegistry<PostTargetScopeActionName>(
                postTargetScopeAdmissionStrategyDefinitions,
                catalog,
                postTargetScopeActionNames
            )
        ).not.toThrow();
    });

    it('rejects a registry strategy missing from the canonical command grounding catalog', () => {
        expect(() =>
            createPostTargetScopeAdmissionStrategyRegistry(
                [{ name: 'removeTrack', transform: () => null }],
                [],
                ['removeTrack']
            )
        ).toThrow('Post-target scope admission strategy is not a canonical executable action: removeTrack');
    });

    it('rejects a missing expected strategy definition', () => {
        expect(() =>
            createPostTargetScopeAdmissionStrategyRegistry<PostTargetScopeActionName>(
                [{ name: 'removeTrack', transform: () => null }],
                getExecutableAppActionGroundingCatalog(),
                ['removeTrack', 'removeClip']
            )
        ).toThrow('Missing post-target scope admission strategy: removeClip');
    });

    it('dispatches registered scope admissions and leaves unregistered actions unchanged', () => {
        const input = {
            actionScope: { matchedIntentPhrase: 'remove track', text: 'remove Missing track' },
            bulkMutedEmptyTrackDeletionTargetIds: null,
            context,
            groundedArguments: { trackId: 'track-missing' },
            plannedActionNames: ['removeTrack'],
            prompt: 'remove Missing track',
        };

        expect(groundPostTargetScopeAdmission({ ...input, actionName: 'removeTrack' })).toBe(
            'Provider track deletion is not explicit in the user request'
        );
        expect(groundPostTargetScopeAdmission({ ...input, actionName: 'setTempo' })).toBeNull();
    });

    it('rejects a clear-solos restriction that lives outside the split clause', () => {
        const input = {
            actionName: 'clearSolos' as const,
            actionScope: { matchedIntentPhrase: 'clear all solos', text: 'clear all solos' },
            bulkMutedEmptyTrackDeletionTargetIds: null,
            context,
            groundedArguments: {},
            plannedActionNames: ['clearSolos'],
        };

        expect(
            groundPostTargetScopeAdmission({
                ...input,
                prompt: 'clear all solos',
            })
        ).toBeNull();
        expect(
            groundPostTargetScopeAdmission({
                ...input,
                prompt: 'clear all solos all but Unnamed',
            })
        ).toBe('Provider clear-solos scope is not explicitly universal');
        expect(
            groundPostTargetScopeAdmission({
                ...input,
                prompt: 'clear all solos but not Unnamed',
            })
        ).toBe('Provider clear-solos scope is not explicitly universal');
    });

    it('rejects a dual VCA group reference that lives outside the split clause', () => {
        const vocals = {
            id: 'track-vocals',
            name: 'Vocals',
            kind: 'audio' as const,
            muted: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            gain: 0.8,
            pan: 0,
            automationMode: 'read' as const,
            outputId: 'master',
            clipCount: 0,
            deviceCount: 0,
            clips: [],
            devices: [],
            sends: [],
            vcaGroupId: 'vca-drums',
        };
        const membershipContext: ProjectContext = {
            ...context,
            tracks: [vocals],
            vcaGroups: [
                { id: 'vca-drums', name: 'Drum VCA', gain: 0.75, muted: false, trackIds: [vocals.id] },
                { id: 'vca-vocals', name: 'Vocal VCA', gain: 1, muted: false, trackIds: [] },
            ],
        };
        const input = {
            actionName: 'removeFromVca' as const,
            actionScope: { matchedIntentPhrase: 'unassign', text: 'unassign Vocals from Drum VCA' },
            bulkMutedEmptyTrackDeletionTargetIds: null,
            context: membershipContext,
            groundedArguments: { trackId: vocals.id },
            plannedActionNames: ['removeFromVca'],
        };

        expect(
            groundPostTargetScopeAdmission({
                ...input,
                prompt: 'unassign Vocals from Drum VCA',
            })
        ).toBeNull();
        expect(
            groundPostTargetScopeAdmission({
                ...input,
                prompt: 'unassign Vocals from Drum VCA and Vocal VCA',
            })
        ).toBe('Provider VCA group reference does not match the track current membership');
    });
});
