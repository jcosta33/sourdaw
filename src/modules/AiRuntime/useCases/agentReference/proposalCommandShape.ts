import {
    getExecutableAppActionEffect,
    getExecutableAppActionGroundingRules,
    getExecutableAppActionProviderSchema,
    isExecutableAppActionType,
} from '#/modules/Command/useCases';
import { canonicalJson } from '#/utils/canonicalDigest';

import { type ProjectContext } from '../../models/ProjectContext';
import { type ProposalGroundingTarget, type ProposalGroundingValue } from '../../models/ProposalGroundingBasis';

/** The arguments the action registry declares as this type's targets, in registry order. */
function getTargetArguments(actionType: string): string[] {
    return (getExecutableAppActionGroundingRules(actionType)?.targetRules ?? []).map((rule) => rule.argument);
}

type ExecutableActionType = Parameters<typeof getExecutableAppActionProviderSchema>[0];
type GroundingRules = NonNullable<ReturnType<typeof getExecutableAppActionGroundingRules>>;
type TargetRule = GroundingRules['targetRules'][number];

/**
 * One argument a command's identity reads, how many ids it holds, whether it gathers members into one
 * object, and whether its members are sources that one command acts on together (a send range's tracks).
 */
type IdentityArgument = { argument: string; many: boolean; gathersMembers: boolean; gathersSources: boolean };

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
                gathersSources: target?.promptRole === 'source',
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
            gathersSources: rule.promptRole === 'source',
        }));
}

/** The id one member of a many-target names: the member itself, or the clip a placement places. */
function readMemberId(member: unknown): string | null {
    if (typeof member === 'string') {
        return member;
    }
    return isRecord(member) && typeof member.clipId === 'string' ? member.clipId : null;
}

/** Which object a command acts on, and the set of members it acts on there, as a proposal diff pairs commands. */
type CommandIdentity = {
    /** The command's type and every single id its identity arguments carry. */
    object: string;
    /** Each member of its sets of sources or placements, as `[argument, id]`, sorted; empty when it has none. */
    members: readonly string[];
    /** Whether those members are sources, which may pair by type alone; placements pair only by a shared clip. */
    membersAreSources: boolean;
};

/** Whether a payload field is an object id the application wrote rather than one a provider argument states. */
function isUndeclaredIdField(actionType: ExecutableActionType, field: string, value: unknown): boolean {
    return (
        field.endsWith('Id') &&
        !field.startsWith('expected') &&
        typeof value === 'string' &&
        !Object.hasOwn(getExecutableAppActionProviderSchema(actionType).properties, field)
    );
}

/**
 * The ids grounding resolved a command's reference to, on a command that creates nothing: a marker or
 * section the provider names by its beat and label is acted on by the `markerId` or `sectionId` it
 * resolves to, and the provider arguments that named it are gone from the payload (a section rename's
 * `name` is then its new label). A creating command's undeclared ids are minted for what it creates,
 * never a reference.
 */
function getResolvedReferenceIds(
    actionType: string,
    argumentsRecord: Readonly<Record<string, unknown>>
): Array<[string, unknown]> {
    if (
        !isExecutableAppActionType(actionType) ||
        (getExecutableAppActionEffect(actionType)?.creates ?? []).length > 0
    ) {
        return [];
    }
    return Object.entries(argumentsRecord)
        .filter(([field, value]) => isUndeclaredIdField(actionType, field, value))
        .toSorted(([left], [right]) => left.localeCompare(right));
}

/**
 * Which object a command acts on, as a proposal diff pairs commands: its type and the ids its identity
 * arguments carry, or the ids grounding resolved its reference to. A many-target counts by its
 * members, sorted, except a set of members the command gathers into one object (a VCA group's
 * tracks), which pairs by type alone so a changed membership reads as the same command changed.
 */
function getIdentity(actionType: string, argumentsRecord: Readonly<Record<string, unknown>>): CommandIdentity {
    const resolved = getResolvedReferenceIds(actionType, argumentsRecord);
    if (resolved.length > 0) {
        return { object: canonicalJson([actionType, resolved]), members: [], membersAreSources: false };
    }
    const parts: unknown[] = [];
    const members: string[] = [];
    let membersAreSources = false;
    for (const identity of getIdentityArguments(actionType)) {
        const value = argumentsRecord[identity.argument];
        if (value === undefined || identity.gathersMembers) {
            continue;
        }
        if (identity.many && Array.isArray(value)) {
            for (const member of value) {
                members.push(canonicalJson([identity.argument, readMemberId(member) ?? canonicalJson(member)]));
            }
            membersAreSources ||= identity.gathersSources;
            continue;
        }
        parts.push([identity.argument, value]);
    }
    return { object: canonicalJson([actionType, parts]), members: members.toSorted(), membersAreSources };
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

/**
 * What a creating command creates, as its payload carries it: the id fields the application minted for
 * the new object — present in the payload, yet no argument the provider may state — and the names its
 * provider arguments give it (a bus's name, a device type both by its id and as the project's device
 * catalogue names it, "Compressor"). A creation the application mints no id for at grounding (a track
 * or marker added by name) carries none. `null` for a command that creates nothing.
 */
function getCreatedObject(
    actionType: string,
    argumentsRecord: Readonly<Record<string, unknown>>,
    context: ProjectContext
): { idFields: string[]; names: string[] } | null {
    if (
        !isExecutableAppActionType(actionType) ||
        (getExecutableAppActionEffect(actionType)?.creates ?? []).length === 0
    ) {
        return null;
    }
    const idFields = Object.keys(argumentsRecord).filter((field) =>
        isUndeclaredIdField(actionType, field, argumentsRecord[field])
    );
    const names = (getExecutableAppActionGroundingRules(actionType)?.valueRules ?? []).flatMap((rule) => {
        const value = argumentsRecord[rule.argument];
        const namesObject = rule.kind === 'string-literal' || rule.kind === 'text-after-keyword-if-present';
        if (!namesObject || typeof value !== 'string' || value.trim().length === 0) {
            return [];
        }
        const catalogueName = context.availableDeviceTypes?.find((deviceType) => deviceType.id === value)?.name;
        return catalogueName === undefined ? [value] : [value, catalogueName];
    });
    return { idFields, names };
}

/** How a proposed command's targets and value read, from the action registry's declarations alone. */
export const proposalCommandShape = {
    createdObject: getCreatedObject,
    identity: getIdentity,
    objectIds: getObjectIds,
    targetObjects: getTargetObjects,
    targets: getTargets,
    targetKey: getTargetKey,
    value: getValue,
} as const;
