import { type getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../../models/ProjectContext';

import {
    createGroundingAdmissionStrategyRegistry,
    type GroundingAdmissionResult,
    type GroundingAdmissionStrategy,
    type GroundingAdmissionStrategyDefinition,
} from './createGroundingAdmissionStrategyRegistry';
import { type ActionPromptScope } from './promptScope';

type GroundingCatalog = ReturnType<typeof getExecutableAppActionGroundingCatalog>;

export const postScopeAdmissionActionNames = ['moveClip', 'splitClip', 'addClip', 'setPlayback'] as const;

export type PostScopeAdmissionActionName = (typeof postScopeAdmissionActionNames)[number];

export type PostScopeAdmissionInput = {
    actionName: string;
    actionScope: ActionPromptScope;
    admitsPlanCreatedObject: boolean;
    catalog: GroundingCatalog;
    context: ProjectContext;
    plannedActionNames: readonly string[];
    prompt: string;
    sameActionCallCount: number;
};

export type PostScopeAdmissionResult = GroundingAdmissionResult;

export type PostScopeAdmissionStrategy = GroundingAdmissionStrategy<Omit<PostScopeAdmissionInput, 'actionName'>>;

export type PostScopeAdmissionStrategyDefinition<Name extends PostScopeAdmissionActionName> =
    GroundingAdmissionStrategyDefinition<Name, Omit<PostScopeAdmissionInput, 'actionName'>>;

export const postScopeAdmissionLabel = 'post-scope admission';

export function createPostScopeAdmissionStrategyRegistry<Name extends PostScopeAdmissionActionName>(
    definitions: readonly PostScopeAdmissionStrategyDefinition<Name>[],
    catalog: readonly { actionType: string }[],
    expectedActionNames: readonly Name[]
): ReadonlyMap<Name, PostScopeAdmissionStrategy> {
    return createGroundingAdmissionStrategyRegistry<Name, Omit<PostScopeAdmissionInput, 'actionName'>>(
        postScopeAdmissionLabel,
        definitions,
        catalog,
        expectedActionNames
    );
}
