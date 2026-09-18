import { type ProjectContext } from '../../../models/ProjectContext';

import {
    createGroundingAdmissionStrategyRegistry,
    type GroundingAdmissionResult,
    type GroundingAdmissionStrategy,
    type GroundingAdmissionStrategyDefinition,
} from './createGroundingAdmissionStrategyRegistry';

export const postTargetScopeActionNames = [
    'removeTrack',
    'removeClip',
    'renameClip',
    'clearSolos',
    'removeFromVca',
    'quantizeNotes',
    'transposeNotes',
    'invertNotes',
    'retrogradeNotes',
    'quantizeNoteLengths',
    'scaleAllVelocities',
    'setAllVelocities',
] as const;

export type PostTargetScopeActionName = (typeof postTargetScopeActionNames)[number];

type PostTargetActionScope = {
    matchedIntentPhrase: string;
    text: string;
};

export type PostTargetScopeAdmissionInput = {
    actionName: string;
    actionScope: PostTargetActionScope;
    bulkMutedEmptyTrackDeletionTargetIds: readonly string[] | null;
    context: ProjectContext;
    groundedArguments: Readonly<Record<string, unknown>>;
    plannedActionNames: readonly string[];
    prompt: string;
};

export type PostTargetScopeAdmissionResult = GroundingAdmissionResult;

export type PostTargetScopeAdmissionStrategy = GroundingAdmissionStrategy<
    Omit<PostTargetScopeAdmissionInput, 'actionName'>
>;

export type PostTargetScopeAdmissionStrategyDefinition<Name extends PostTargetScopeActionName> =
    GroundingAdmissionStrategyDefinition<Name, Omit<PostTargetScopeAdmissionInput, 'actionName'>>;

export const postTargetScopeAdmissionLabel = 'post-target scope admission';

export function createPostTargetScopeAdmissionStrategyRegistry<Name extends PostTargetScopeActionName>(
    definitions: readonly PostTargetScopeAdmissionStrategyDefinition<Name>[],
    catalog: readonly { actionType: string }[],
    expectedActionNames: readonly Name[]
): ReadonlyMap<Name, PostTargetScopeAdmissionStrategy> {
    return createGroundingAdmissionStrategyRegistry<Name, Omit<PostTargetScopeAdmissionInput, 'actionName'>>(
        postTargetScopeAdmissionLabel,
        definitions,
        catalog,
        expectedActionNames
    );
}
