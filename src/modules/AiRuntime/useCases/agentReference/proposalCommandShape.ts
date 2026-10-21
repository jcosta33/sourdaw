import { getExecutableAppActionGroundingRules } from '#/modules/Command/useCases';
import { canonicalJson } from '#/utils/canonicalDigest';

import { type ProposalGroundingTarget, type ProposalGroundingValue } from '../../models/ProposalGroundingBasis';

/** The arguments the action registry declares as this type's targets, in registry order. */
function getTargetArguments(actionType: string): string[] {
    return (getExecutableAppActionGroundingRules(actionType)?.targetRules ?? []).map((rule) => rule.argument);
}

/**
 * The target arguments naming the object a command acts on, as a proposal diff pairs commands. A
 * destination is where the command sends that object, which a replacement may change like a value,
 * so it is left out: a clip moved to another track is the same move, changed.
 */
function getIdentityArguments(actionType: string): string[] {
    return (getExecutableAppActionGroundingRules(actionType)?.targetRules ?? []).flatMap((rule) =>
        rule.promptRole === 'destination' ? [] : [rule.argument]
    );
}

/** The full target tuple a command's arguments carry, one entry per declared target argument it sets. */
function getTargets(actionType: string, argumentsRecord: Readonly<Record<string, unknown>>): ProposalGroundingTarget[] {
    return getTargetArguments(actionType).flatMap((argument) => {
        const value = argumentsRecord[argument];
        if (value === undefined) {
            return [];
        }
        return [{ argument, id: typeof value === 'string' ? value : canonicalJson(value) }];
    });
}

/** One key per command type and full target tuple; two commands share it only when they act on the same object. */
function getTargetKey(actionType: string, argumentsRecord: Readonly<Record<string, unknown>>): string {
    return canonicalJson([actionType, getTargets(actionType, argumentsRecord)]);
}

/** The single numeric value a command states and the form it was stated in, or `null` when it states none or several. */
function getValue(
    actionType: string,
    argumentsRecord: Readonly<Record<string, unknown>>
): ProposalGroundingValue | null {
    const valueRules = getExecutableAppActionGroundingRules(actionType)?.valueRules ?? [];
    const stated = valueRules.flatMap((rule) => {
        const value = argumentsRecord[rule.argument];
        return rule.kind === 'number-if-present' && typeof value === 'number' ? [{ rule, value }] : [];
    });
    const [only] = stated;
    if (stated.length !== 1 || only === undefined) {
        return null;
    }
    const levelForm = only.rule.kind === 'number-if-present' ? only.rule.levelForm : undefined;
    return {
        argument: only.rule.argument,
        value: only.value,
        form: levelForm === 'relative-decibel' ? 'relative' : 'absolute',
        unit: levelForm === 'absolute-decibel' || levelForm === 'relative-decibel' ? 'dB' : null,
    };
}

/** How a proposed command's targets and value read, from the action registry's declarations alone. */
export const proposalCommandShape = {
    identityArguments: getIdentityArguments,
    targets: getTargets,
    targetKey: getTargetKey,
    value: getValue,
} as const;
