import { describe, expect, it } from 'vitest';

import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../../../models/ProjectContext';
import { collectClearSolosRestrictionClauses } from '../collectClearSolosRestrictionClauses';
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

    it('collects only solo-specific clear-solos restrictions without retaining adjacent action clauses', () => {
        expect(
            collectClearSolosRestrictionClauses(
                'clear all solos, not including Vocals, and mute Guitar but leave Keys soloed'
            )
        ).toEqual(['not including Vocals', 'but leave Keys soloed']);
        expect(collectClearSolosRestrictionClauses('clear all solos and retain Lead soloed')).toEqual([
            'and retain Lead soloed',
        ]);
        expect(collectClearSolosRestrictionClauses('clear all solos while keeping Lead soloed, mute Guitar')).toEqual([
            'while keeping Lead soloed',
        ]);
        expect(collectClearSolosRestrictionClauses('clear all solos and leave Keys muted, then mute Guitar')).toEqual(
            []
        );
        expect(collectClearSolosRestrictionClauses('clear all solos and mute every track except Vocals')).toEqual([]);
        expect(collectClearSolosRestrictionClauses('clear all solos but keep Vocals and Guitar soloed')).toEqual([
            'but keep Vocals and Guitar soloed',
        ]);
    });
});
