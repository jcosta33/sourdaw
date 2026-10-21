import { getExecutableAppActionGroundingRules } from '#/modules/Command/useCases';
import { canonicalJson } from '#/utils/canonicalDigest';

import { type ProposalGroundingTarget, type ProposalGroundingValue } from '../../models/ProposalGroundingBasis';

/** The arguments the action registry declares as this type's targets, in registry order. */
function getTargetArguments(actionType: string): string[] {
    return (getExecutableAppActionGroundingRules(actionType)?.targetRules ?? []).map((rule) => rule.argument);
}

type GroundingRules = NonNullable<ReturnType<typeof getExecutableAppActionGroundingRules>>;
type TargetRule = GroundingRules['targetRules'][number];

/** One argument a command's identity reads, how many ids it holds, and whether it gathers members into one object. */
type IdentityArgument = { argument: string; many: boolean; gathersMembers: boolean };

/**
 * Every provider-supplied argument the mutation identity rules name, of the rules that are, or are
 * not, references only, target or not: an automation lane's parameter is no target, yet names which
 * lane a creation makes. An app-derived argument is never in the payload and is left out.
 */
function getMutationIdentityArguments(rules: GroundingRules, referenceOnly: boolean): IdentityArgument[] {
    const byName = new Map<string, IdentityArgument>();
    for (const rule of rules.mutationIdentityRules) {
        if ((rule.resourceReferenceOnly === true) !== referenceOnly) {
            continue;
        }
        for (const argument of rule.arguments.concat(rule.fallbackArguments ?? [])) {
            if (argument.source === 'app-derived' || byName.has(argument.argument)) {
                continue;
            }
            const target = rules.targetRules.find((candidate) => candidate.argument === argument.argument);
            byName.set(argument.argument, {
                argument: argument.argument,
                many: argument.cardinality === 'many' || target?.cardinality === 'many',
                gathersMembers: target?.promptRole === 'members',
            });
        }
    }
    return Array.from(byName.values());
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The arguments naming the object a command mutates, as the registry's mutation identity declares
 * it: a send's track and bus, a parameter's device and id, a created lane's track and parameter, a
 * move's clip but not the track it moves to, an insert's track but not the device it goes after. A
 * command whose mutation identity is only a reference falls back to that reference (an added clip's
 * track), and one that declares none to every target that is no destination.
 */
function getIdentityArguments(actionType: string): IdentityArgument[] {
    const rules = getExecutableAppActionGroundingRules(actionType);
    if (rules === null) {
        return [];
    }
    const mutated = getMutationIdentityArguments(rules, false);
    if (mutated.length > 0) {
        return mutated;
    }
    const referenced = getMutationIdentityArguments(rules, true);
    if (referenced.length > 0) {
        return referenced;
    }
    return rules.targetRules
        .filter((rule) => rule.promptRole !== 'destination')
        .map((rule) => ({
            argument: rule.argument,
            many: rule.cardinality === 'many',
            gathersMembers: rule.promptRole === 'members',
        }));
}

/** The id one member of a many-target names: the member itself, or the clip a placement places. */
function readMemberId(member: unknown): string | null {
    if (typeof member === 'string') {
        return member;
    }
    return isRecord(member) && typeof member.clipId === 'string' ? member.clipId : null;
}

/**
 * Which object a command acts on, as a proposal diff pairs commands: its type and the ids its identity
 * arguments carry. A many-target counts by its members, sorted, except a set of members the command
 * gathers into one object (a VCA group's tracks), which pairs by type alone so a changed membership
 * reads as the same command changed.
 */
function getIdentity(actionType: string, argumentsRecord: Readonly<Record<string, unknown>>): string {
    const parts = getIdentityArguments(actionType).flatMap((identity) => {
        const value = argumentsRecord[identity.argument];
        if (value === undefined || identity.gathersMembers) {
            return [];
        }
        if (identity.many && Array.isArray(value)) {
            const members = value.map((member: unknown) => readMemberId(member) ?? canonicalJson(member));
            return [[identity.argument, members.toSorted()]];
        }
        return [[identity.argument, value]];
    });
    return canonicalJson([actionType, parts]);
}

/** Each id a command's targets name, with the capability of the target that names it. */
function getTargetObjects(
    actionType: string,
    argumentsRecord: Readonly<Record<string, unknown>>
): Array<{ id: string; capability: TargetRule['capability'] }> {
    return (getExecutableAppActionGroundingRules(actionType)?.targetRules ?? []).flatMap((rule) => {
        const value = argumentsRecord[rule.argument];
        const members = Array.isArray(value) ? value : [value];
        return members
            .flatMap((member) => {
                if (typeof member === 'string') {
                    return [member];
                }
                return isRecord(member) ? Object.values(member).filter((id) => typeof id === 'string') : [];
            })
            .map((id) => ({ id, capability: rule.capability }));
    });
}

/**
 * Every object id a command's targets touch: each single target, each member of a many-target and
 * every id a member names (a placement's clip and the track it lands on), and a device parameter as
 * `deviceId:paramId`, the id its protection carries.
 */
function getObjectIds(actionType: string, argumentsRecord: Readonly<Record<string, unknown>>): string[] {
    const ids = getTargetObjects(actionType, argumentsRecord).map((target) => target.id);
    const { deviceId, paramId } = argumentsRecord;
    if (typeof deviceId === 'string' && typeof paramId === 'string') {
        ids.push(`${deviceId}:${paramId}`);
    }
    return [...new Set(ids)];
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
    identity: getIdentity,
    objectIds: getObjectIds,
    targetObjects: getTargetObjects,
    targets: getTargets,
    targetKey: getTargetKey,
    value: getValue,
} as const;
