import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../../models/ProjectContext';

import {
    createPostScopeAdmissionStrategyRegistry,
    postScopeAdmissionActionNames,
    type PostScopeAdmissionActionName,
    type PostScopeAdmissionInput,
    type PostScopeAdmissionResult,
    type PostScopeAdmissionStrategy,
    type PostScopeAdmissionStrategyDefinition,
} from './createPostScopeAdmissionStrategyRegistry';
import { getAddClipPromptEvidence } from './getAddClipPromptEvidence';
import { getMoveBeatAssertions } from './getMoveBeatAssertions';
import { getPromptClauses } from './getPromptClauses';
import { maskProjectReferences } from './maskProjectReferences';
import { maskQuotedLabels } from './maskQuotedLabels';
import { normalizePromptText } from './normalizePromptText';
import { type ActionPromptScope } from './promptScope';
import { resolveClauseActionIntent } from './resolveClauseActionIntent';

type GroundingCatalog = ReturnType<typeof getExecutableAppActionGroundingCatalog>;

function hasExactlyOneMoveBeatAssertion(actionScope: string): boolean {
    const assertions = getMoveBeatAssertions(actionScope);
    if (assertions.length !== 1) {
        return false;
    }
    return assertions.every((assertion) => {
        const rawValue = assertion[1];
        if (!rawValue || rawValue.endsWith('%')) {
            return false;
        }
        const suffix = actionScope.slice(assertion.index + assertion[0].length);
        return !/^\s*(?:bars?|beats?|seconds?|secs?|minutes?|mins?|%)/iu.test(suffix);
    });
}

function hasGroundedMoveBeatAssertions({
    catalog,
    context,
    expectedMoveCount,
    plannedActionNames,
    prompt,
}: {
    catalog: GroundingCatalog;
    context: ProjectContext;
    expectedMoveCount: number;
    plannedActionNames: readonly string[];
    prompt: string;
}): boolean {
    const maskedPrompt = maskProjectReferences(prompt, context);
    let moveClauseCount = 0;
    for (const clause of getPromptClauses(prompt, maskedPrompt)) {
        const assertions = getMoveBeatAssertions(clause.text);
        if (assertions.length === 0) {
            continue;
        }
        const intent = resolveClauseActionIntent(clause.masked, catalog);
        if (intent?.actionType === 'moveClip') {
            if (!hasExactlyOneMoveBeatAssertion(clause.text)) {
                return false;
            }
            moveClauseCount += 1;
            continue;
        }
        if (!intent || !plannedActionNames.includes(intent.actionType)) {
            return false;
        }
    }
    return moveClauseCount === expectedMoveCount;
}

function hasGroundedSplitBeatAssertions({
    catalog,
    context,
    expectedSplitCount,
    plannedActionNames,
    prompt,
}: {
    catalog: GroundingCatalog;
    context: ProjectContext;
    expectedSplitCount: number;
    plannedActionNames: readonly string[];
    prompt: string;
}): boolean {
    const maskedPrompt = maskProjectReferences(prompt, context);
    let splitClauseCount = 0;
    for (const clause of getPromptClauses(prompt, maskedPrompt)) {
        const assertions = getMoveBeatAssertions(clause.text);
        const unmaskedNumbers = clause.masked.match(
            /(?<![\p{L}\p{N}_.])-?(?:\d+(?:\.\d+)?|\.\d+)(?:\s*\/\s*(?:\d+(?:\.\d+)?|\.\d+))?%?(?![\p{L}\p{N}_.])/gu
        );
        const intent = resolveClauseActionIntent(clause.masked, catalog);
        if (assertions.length === 0) {
            if ((unmaskedNumbers?.length ?? 0) > 0 && (!intent || intent.actionType === 'splitClip')) {
                return false;
            }
            continue;
        }
        if (intent?.actionType === 'splitClip') {
            if (!hasExactlyOneMoveBeatAssertion(clause.text)) {
                return false;
            }
            if (unmaskedNumbers?.length !== 1) {
                return false;
            }
            splitClauseCount += 1;
            continue;
        }
        if (!intent || !plannedActionNames.includes(intent.actionType)) {
            return false;
        }
    }
    return splitClauseCount === expectedSplitCount;
}

function hasGroundedAddClipAssertions({
    catalog,
    context,
    expectedAddClipCount,
    plannedActionNames,
    prompt,
}: {
    catalog: GroundingCatalog;
    context: ProjectContext;
    expectedAddClipCount: number;
    plannedActionNames: readonly string[];
    prompt: string;
}): boolean {
    const maskedPrompt = maskQuotedLabels(maskProjectReferences(prompt, context));
    let addClipClauseCount = 0;
    for (const clause of getPromptClauses(prompt, maskedPrompt)) {
        const intent = resolveClauseActionIntent(clause.masked, catalog);
        if (intent?.actionType === 'addClip') {
            const actionScope: ActionPromptScope = {
                ...clause,
                directional: false,
                matchedIntentPhrase: intent.phrase,
            };
            if (!getAddClipPromptEvidence(actionScope)) {
                return false;
            }
            addClipClauseCount += 1;
            continue;
        }
        const unquotedClause = maskQuotedLabels(clause.masked);
        const hasNumericOrBeatAssertion = /\d|\b(?:beats?|bars?)\b/iu.test(unquotedClause);
        if (!hasNumericOrBeatAssertion) {
            continue;
        }
        if (!intent || !plannedActionNames.includes(intent.actionType)) {
            return false;
        }
    }
    return addClipClauseCount === expectedAddClipCount;
}

function isExplicitSetPlaybackScope(actionScope: ActionPromptScope): boolean {
    let commandText = actionScope.text.trim();
    commandText = commandText.replace(/^(?:please\s+)?(?:can|could|would)\s+you(?:\s+please)?\s+/iu, '');
    commandText = commandText.replace(/^please\s+/iu, '');
    const normalized = normalizePromptText(commandText);
    return ['play', 'start playback', 'resume playback', 'pause', 'pause playback'].includes(normalized);
}

const moveClipStrategy: PostScopeAdmissionStrategy = ({
    catalog,
    context,
    plannedActionNames,
    prompt,
    sameActionCallCount,
}) =>
    hasGroundedMoveBeatAssertions({
        catalog,
        context,
        expectedMoveCount: sameActionCallCount,
        plannedActionNames,
        prompt,
    })
        ? null
        : 'Provider clip move requires exactly one explicit absolute beat per move';

const splitClipStrategy: PostScopeAdmissionStrategy = ({
    catalog,
    context,
    plannedActionNames,
    prompt,
    sameActionCallCount,
}) =>
    hasGroundedSplitBeatAssertions({
        catalog,
        context,
        expectedSplitCount: sameActionCallCount,
        plannedActionNames,
        prompt,
    })
        ? null
        : 'Provider clip split requires exactly one explicit absolute beat per split';

const addClipStrategy: PostScopeAdmissionStrategy = ({
    admitsPlanCreatedObject,
    catalog,
    context,
    plannedActionNames,
    prompt,
    sameActionCallCount,
}) => {
    if (admitsPlanCreatedObject) {
        return null;
    }
    return hasGroundedAddClipAssertions({
        catalog,
        context,
        expectedAddClipCount: sameActionCallCount,
        plannedActionNames,
        prompt,
    })
        ? null
        : 'Provider clip creation requires one exact explicit beat range per clip';
};

const setPlaybackStrategy: PostScopeAdmissionStrategy = ({ actionScope }) =>
    isExplicitSetPlaybackScope(actionScope) ? null : 'Provider action is not grounded in an explicit playback request';

export const postScopeAdmissionStrategyDefinitions = [
    { name: 'moveClip', transform: moveClipStrategy },
    { name: 'splitClip', transform: splitClipStrategy },
    { name: 'addClip', transform: addClipStrategy },
    { name: 'setPlayback', transform: setPlaybackStrategy },
] satisfies readonly PostScopeAdmissionStrategyDefinition<PostScopeAdmissionActionName>[];

const postScopeAdmissionStrategyRegistry = createPostScopeAdmissionStrategyRegistry<PostScopeAdmissionActionName>(
    postScopeAdmissionStrategyDefinitions,
    getExecutableAppActionGroundingCatalog(),
    postScopeAdmissionActionNames
);

function isPostScopeActionName(actionName: string): actionName is PostScopeAdmissionActionName {
    return postScopeAdmissionActionNames.some((expectedActionName) => expectedActionName === actionName);
}

export function groundPostScopeAdmission(input: PostScopeAdmissionInput): PostScopeAdmissionResult {
    if (!isPostScopeActionName(input.actionName)) {
        return null;
    }
    const strategy = postScopeAdmissionStrategyRegistry.get(input.actionName);
    if (!strategy) {
        throw new Error(`Missing post-scope admission strategy: ${input.actionName}`);
    }
    return strategy({
        actionScope: input.actionScope,
        admitsPlanCreatedObject: input.admitsPlanCreatedObject,
        catalog: input.catalog,
        context: input.context,
        plannedActionNames: input.plannedActionNames,
        prompt: input.prompt,
        sameActionCallCount: input.sameActionCallCount,
    });
}
