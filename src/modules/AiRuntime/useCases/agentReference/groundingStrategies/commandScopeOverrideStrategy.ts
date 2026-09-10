import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../../models/ProjectContext';
import { getBulkDeviceInsertionTrackScope } from '../getBulkDeviceInsertionTrackScope';
import { getDeviceParameterPromptScope } from '../getDeviceParameterPromptScope';
import { getMutedEmptyTrackDeletionScope } from '../getMutedEmptyTrackDeletionScope';

import {
    createGroundingAdmissionStrategyRegistry,
    type GroundingAdmissionStrategyDefinition,
} from './createGroundingAdmissionStrategyRegistry';
import { getPromptClauses } from './getPromptClauses';
import { isNegatedIntent } from './isNegatedIntent';
import { maskProjectReferences } from './maskProjectReferences';
import { maskQuotedLabels } from './maskQuotedLabels';
import { normalizePromptText } from './normalizePromptText';
import { type ActionPromptScope, type PromptClause } from './promptScope';

export const commandScopeOverrideActionNames = [
    'setDeviceParameter',
    'setClipFade',
    'createBus',
    'setTrackOutput',
    'addDevice',
    'removeTrack',
    'setTrackPan',
] as const;

export type CommandScopeOverrideActionName = (typeof commandScopeOverrideActionNames)[number];

export type CommandScopeOverrideInput = {
    actionName: string;
    actionOrdinal: number;
    assertedArguments: Readonly<Record<string, unknown>>;
    context: ProjectContext;
    prompt: string;
    sameActionAssertedArguments: readonly Readonly<Record<string, unknown>>[];
    sameActionCallCount: number;
};

/** `denied` ends scope resolution for the call with null. */
export type CommandScopeOverride =
    { status: 'resolved'; scope: ActionPromptScope } | { status: 'denied' } | { status: 'none' };

export type CommandScopeOverrideStrategyDefinition<Name extends CommandScopeOverrideActionName> =
    GroundingAdmissionStrategyDefinition<Name, Omit<CommandScopeOverrideInput, 'actionName'>, CommandScopeOverride>;

const commandScopeOverrideLabel = 'command scope override';

function hasInvalidNamedClipFadeField(prompt: string): boolean {
    for (const clause of getPromptClauses(prompt, prompt)) {
        const normalizedClause = normalizePromptText(clause.text);
        for (const field of normalizedClause.matchAll(/\bfade (?:in|out)\b/gu)) {
            const suffix = normalizedClause.slice(field.index + field[0].length);
            if (!/^(?: to| at)? -?\d/u.test(suffix) || isNegatedIntent(clause.text, field[0])) {
                return true;
            }
        }
    }
    return false;
}

function resolveDirectNamedBusCreationScope(
    prompt: string,
    assertedArguments: Readonly<Record<string, unknown>>,
    sameActionCallCount: number
): ActionPromptScope | null {
    if (sameActionCallCount !== 1 || typeof assertedArguments.name !== 'string') {
        return null;
    }
    const normalizedName = normalizePromptText(assertedArguments.name);
    if (!normalizedName.endsWith(' bus')) {
        return null;
    }
    const expectedPhrases = [
        `create ${normalizedName}`,
        `create a ${normalizedName}`,
        `create an ${normalizedName}`,
        `add ${normalizedName}`,
        `add a ${normalizedName}`,
        `add an ${normalizedName}`,
    ];
    const clause = getPromptClauses(prompt, prompt).find((candidate) => {
        const normalizedClause = ` ${normalizePromptText(candidate.text)} `;
        return expectedPhrases.some((phrase) => normalizedClause.includes(` ${phrase} `));
    });
    if (!clause) {
        return null;
    }
    return { ...clause, directional: false, matchedIntentPhrase: 'create bus' };
}

function resolveBulkTrackOutputScope(
    prompt: string,
    context: ProjectContext,
    sameActionAssertedArguments: readonly Readonly<Record<string, unknown>>[],
    sameActionCallCount: number
): ActionPromptScope | null {
    if (sameActionCallCount < 2 || sameActionAssertedArguments.length !== sameActionCallCount) {
        return null;
    }
    const routeMatch = /\broute\b[\s\S]*?\b(?:into|to)\b[\s\S]*/iu.exec(prompt);
    if (!routeMatch) {
        return null;
    }
    const normalizedRoute = normalizePromptText(routeMatch[0]);
    const sourceMatch = /^route\s+(.+?)\s+(?:into|to)\b/u.exec(normalizedRoute);
    if (!sourceMatch) {
        return null;
    }
    const sourceList = sourceMatch[1];
    if (!sourceList) {
        return null;
    }
    const sourceScope = ` ${sourceList} `;
    const requestedSourceIds = context.tracks
        .filter((track) => sourceScope.includes(` ${normalizePromptText(track.name)} `))
        .map((track) => track.id);
    const assertedSourceIds = sameActionAssertedArguments.flatMap((arguments_) =>
        typeof arguments_.trackId === 'string' ? [arguments_.trackId] : []
    );
    const assertedOutputIds = sameActionAssertedArguments.flatMap((arguments_) =>
        typeof arguments_.outputId === 'string' ? [arguments_.outputId] : []
    );
    if (
        requestedSourceIds.length !== sameActionCallCount ||
        assertedSourceIds.length !== sameActionCallCount ||
        new Set(assertedSourceIds).size !== sameActionCallCount ||
        new Set(assertedOutputIds).size !== 1 ||
        !requestedSourceIds.every((trackId) => assertedSourceIds.includes(trackId))
    ) {
        return null;
    }
    return {
        text: routeMatch[0],
        masked: routeMatch[0],
        directional: false,
        matchedIntentPhrase: 'route',
    };
}

function resolveBulkDeviceInsertionScope(
    prompt: string,
    context: ProjectContext,
    sameActionAssertedArguments: readonly Readonly<Record<string, unknown>>[],
    sameActionCallCount: number
): ActionPromptScope | null {
    const expectedTrackIds = getBulkDeviceInsertionTrackScope(prompt, context)?.targetIds;
    if (!expectedTrackIds || sameActionAssertedArguments.length !== sameActionCallCount) {
        return null;
    }
    const assertedTrackIds = sameActionAssertedArguments.flatMap((arguments_) =>
        typeof arguments_.trackId === 'string' ? [arguments_.trackId] : []
    );
    if (
        expectedTrackIds.length !== sameActionCallCount ||
        assertedTrackIds.length !== sameActionCallCount ||
        new Set(assertedTrackIds).size !== sameActionCallCount ||
        !expectedTrackIds.every((trackId) => assertedTrackIds.includes(trackId))
    ) {
        return null;
    }
    return { text: prompt, masked: prompt, directional: false, matchedIntentPhrase: 'insert device' };
}

function resolveBulkMutedEmptyTrackDeletionScope(
    prompt: string,
    context: ProjectContext,
    sameActionAssertedArguments: readonly Readonly<Record<string, unknown>>[],
    sameActionCallCount: number
): ActionPromptScope | null {
    const expectedTrackIds = getMutedEmptyTrackDeletionScope(prompt, context)?.targetIds;
    if (!expectedTrackIds || sameActionAssertedArguments.length !== sameActionCallCount) {
        return null;
    }
    const assertedTrackIds = sameActionAssertedArguments.flatMap((arguments_) =>
        typeof arguments_.trackId === 'string' ? [arguments_.trackId] : []
    );
    if (
        expectedTrackIds.length !== sameActionCallCount ||
        assertedTrackIds.length !== sameActionCallCount ||
        new Set(assertedTrackIds).size !== sameActionCallCount ||
        !expectedTrackIds.every((trackId) => assertedTrackIds.includes(trackId))
    ) {
        return null;
    }
    return { text: prompt, masked: prompt, directional: false, matchedIntentPhrase: 'delete track' };
}

function resolveRepeatedTrackPanScope({
    actionOrdinal,
    prompt,
    context,
    sameActionAssertedArguments,
    sameActionCallCount,
}: Pick<
    CommandScopeOverrideInput,
    'actionOrdinal' | 'prompt' | 'context' | 'sameActionAssertedArguments' | 'sameActionCallCount'
>): ActionPromptScope | null {
    if (sameActionCallCount < 2 || sameActionAssertedArguments.length !== sameActionCallCount) {
        return null;
    }

    const clauses = getPromptClauses(prompt, maskQuotedLabels(maskProjectReferences(prompt, context)));
    const scopedClauses: Array<{ clause: PromptClause; index: number }> = [];
    for (const assertedArguments of sameActionAssertedArguments) {
        if (typeof assertedArguments.trackId !== 'string' || typeof assertedArguments.pan !== 'number') {
            return null;
        }
        const track = context.tracks.find((candidate) => candidate.id === assertedArguments.trackId);
        if (!track) {
            return null;
        }
        const normalizedTrackName = normalizePromptText(track.name);
        const matches = clauses.flatMap((clause, index) => {
            const normalizedClause = ` ${normalizePromptText(clause.text)} `;
            return normalizedClause.includes(` ${normalizedTrackName} `) ? [{ clause, index }] : [];
        });
        if (matches.length !== 1 || !/-?(?:\d+(?:\.\d+)?|\.\d+)%?\s*(?:left|right)\b/iu.test(matches[0]!.clause.text)) {
            return null;
        }
        scopedClauses.push(matches[0]!);
    }

    const firstClause = scopedClauses[0];
    if (!firstClause || !/\b(?:pan|panning)\b/iu.test(firstClause.clause.text)) {
        return null;
    }
    if (scopedClauses.some((scope, index) => index > 0 && scope.index !== scopedClauses[index - 1]!.index + 1)) {
        return null;
    }

    const selectedScope = scopedClauses[actionOrdinal];
    if (!selectedScope) {
        return null;
    }
    return { ...selectedScope.clause, directional: false, matchedIntentPhrase: 'pan' };
}

function resolveDeviceParameterPromptScope({
    actionOrdinal,
    prompt,
    context,
    sameActionAssertedArguments,
    sameActionCallCount,
}: Pick<
    CommandScopeOverrideInput,
    'actionOrdinal' | 'prompt' | 'context' | 'sameActionAssertedArguments' | 'sameActionCallCount'
>): ActionPromptScope | null {
    const scope = getDeviceParameterPromptScope(prompt, context);
    if (!scope || scope.assignments.length !== sameActionCallCount) {
        return null;
    }
    const unmatchedAssignments = [...scope.assignments];
    const matchedAssignments = sameActionAssertedArguments.map((arguments_) => {
        const matchIndex = unmatchedAssignments.findIndex(
            ({ parameter, value }) =>
                arguments_.deviceId === scope.device.id &&
                arguments_.paramId === parameter.id &&
                arguments_.value === value
        );
        if (matchIndex < 0) {
            return null;
        }
        return unmatchedAssignments.splice(matchIndex, 1)[0] ?? null;
    });
    if (unmatchedAssignments.length > 0 || matchedAssignments.some((assignment) => assignment === null)) {
        return null;
    }
    const assignment = matchedAssignments[actionOrdinal];
    if (!assignment) {
        return null;
    }
    let displayedValue = `${String(assignment.value)} ${assignment.parameter.unit}`;
    if (assignment.parameter.unit === ':1') {
        displayedValue = `${String(assignment.value)}:1`;
    }
    const deviceName = scope.device.name ?? scope.device.type;
    const text = `Set ${deviceName} ${assignment.parameter.name} on ${scope.track.name} to ${displayedValue}`;
    return { text, masked: text, directional: false, matchedIntentPhrase: 'set' };
}
function toOverride(scope: ActionPromptScope | null): CommandScopeOverride {
    return scope ? { status: 'resolved', scope } : { status: 'none' };
}

export const commandScopeOverrideStrategyDefinitions = [
    {
        name: 'setDeviceParameter',
        transform: ({ actionOrdinal, context, prompt, sameActionAssertedArguments, sameActionCallCount }) =>
            toOverride(
                resolveDeviceParameterPromptScope({
                    actionOrdinal,
                    prompt,
                    context,
                    sameActionAssertedArguments,
                    sameActionCallCount,
                })
            ),
    },
    {
        name: 'setClipFade',
        transform: ({ prompt }) => (hasInvalidNamedClipFadeField(prompt) ? { status: 'denied' } : { status: 'none' }),
    },
    {
        name: 'createBus',
        transform: ({ assertedArguments, prompt, sameActionCallCount }) =>
            toOverride(resolveDirectNamedBusCreationScope(prompt, assertedArguments, sameActionCallCount)),
    },
    {
        name: 'setTrackOutput',
        transform: ({ context, prompt, sameActionAssertedArguments, sameActionCallCount }) =>
            toOverride(resolveBulkTrackOutputScope(prompt, context, sameActionAssertedArguments, sameActionCallCount)),
    },
    {
        name: 'addDevice',
        transform: ({ context, prompt, sameActionAssertedArguments, sameActionCallCount }) =>
            toOverride(
                resolveBulkDeviceInsertionScope(prompt, context, sameActionAssertedArguments, sameActionCallCount)
            ),
    },
    {
        name: 'removeTrack',
        transform: ({ context, prompt, sameActionAssertedArguments, sameActionCallCount }) =>
            toOverride(
                resolveBulkMutedEmptyTrackDeletionScope(
                    prompt,
                    context,
                    sameActionAssertedArguments,
                    sameActionCallCount
                )
            ),
    },
    {
        name: 'setTrackPan',
        transform: ({ actionOrdinal, context, prompt, sameActionAssertedArguments, sameActionCallCount }) =>
            toOverride(
                resolveRepeatedTrackPanScope({
                    actionOrdinal,
                    prompt,
                    context,
                    sameActionAssertedArguments,
                    sameActionCallCount,
                })
            ),
    },
] satisfies readonly CommandScopeOverrideStrategyDefinition<CommandScopeOverrideActionName>[];

const commandScopeOverrideStrategyRegistry = createGroundingAdmissionStrategyRegistry<
    CommandScopeOverrideActionName,
    Omit<CommandScopeOverrideInput, 'actionName'>,
    CommandScopeOverride
>(
    commandScopeOverrideLabel,
    commandScopeOverrideStrategyDefinitions,
    getExecutableAppActionGroundingCatalog(),
    commandScopeOverrideActionNames
);

function isCommandScopeOverrideActionName(actionName: string): actionName is CommandScopeOverrideActionName {
    return commandScopeOverrideActionNames.some((expectedActionName) => expectedActionName === actionName);
}

export function resolveCommandScopeOverride(input: CommandScopeOverrideInput): CommandScopeOverride {
    if (!isCommandScopeOverrideActionName(input.actionName)) {
        return { status: 'none' };
    }
    const strategy = commandScopeOverrideStrategyRegistry.get(input.actionName);
    if (!strategy) {
        throw new Error(`Missing ${commandScopeOverrideLabel} strategy: ${input.actionName}`);
    }
    return strategy({
        actionOrdinal: input.actionOrdinal,
        assertedArguments: input.assertedArguments,
        context: input.context,
        prompt: input.prompt,
        sameActionAssertedArguments: input.sameActionAssertedArguments,
        sameActionCallCount: input.sameActionCallCount,
    });
}
