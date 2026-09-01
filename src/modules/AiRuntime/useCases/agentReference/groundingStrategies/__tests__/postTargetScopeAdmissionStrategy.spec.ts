import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';
import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../../../models/ProjectContext';
import {
    assertPostTargetScopeAdmissionStrategiesMatchGroundingCatalog,
    createPostTargetScopeAdmissionStrategyRegistry,
    groundPostTargetScopeAdmission,
    postTargetScopeAdmissionStrategyRegistry,
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
            createPostTargetScopeAdmissionStrategyRegistry([
                { name: 'removeTrack', transform: () => null },
                { name: 'removeTrack', transform: () => null },
            ])
        ).toThrow('Duplicate post-target scope admission strategy: removeTrack');
    });

    it('proves every registered strategy is in the canonical command grounding catalog', () => {
        const catalog = getExecutableAppActionGroundingCatalog();

        expect(() => assertPostTargetScopeAdmissionStrategiesMatchGroundingCatalog(catalog)).not.toThrow();
        expect(
            [...postTargetScopeAdmissionStrategyRegistry.keys()].every((name) =>
                catalog.some((entry) => entry.actionType === name)
            )
        ).toBe(true);
    });

    it('rejects a registry strategy missing from the canonical command grounding catalog', () => {
        expect(() =>
            assertPostTargetScopeAdmissionStrategiesMatchGroundingCatalog([{ actionType: 'removeTrack' }])
        ).toThrow('Post-target scope admission strategy is not a canonical executable action: removeClip');
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
});
