import { getExecutableAppActionEffect, getExecutableAppActionGroundingRules } from '#/modules/Command/useCases';

import { type CreativeEditDimension, type CreativeRequestAuthority } from '../../models/CreativeInterpretation';
import { type ProjectContext } from '../../models/ProjectContext';
import { type ToolCallResult } from '../../transformers/toolCallParser';

import { getAgentReferenceCapabilityKind } from './agentReferenceCapabilityKinds';
import { GENERATED_BATCH_LOCAL_ID_PREFIXES } from './batchLocalBindingProducers';

type ExecutableAppActionEffect = NonNullable<ReturnType<typeof getExecutableAppActionEffect>>;
type EffectDimension = ExecutableAppActionEffect['dimensions'][number];
type EffectCreatedObject = NonNullable<ExecutableAppActionEffect['creates']>[number];
type TargetRule = NonNullable<ReturnType<typeof getExecutableAppActionGroundingRules>>['targetRules'][number];
type CreationSlotObjectType = CreativeRequestAuthority['creationSlots'][number]['objectType'];

/** One target the authority itself covers, so the bridge can bind it without prompt vocabulary. */
export type CreativeAdmittedTarget = { argument: string; capability: string; objectId: string };

export type CreativeCallAdmission =
    { status: 'admitted'; targets: readonly CreativeAdmittedTarget[] } | { status: 'rejected'; reason: string };

/**
 * Every refusal names the authority, because on this route the authority is the whole reason the
 * call was considered at all: the request carries no vocabulary that could have justified it.
 */
const REASON_PREFIX = 'Creative authority';

/**
 * How a handler's declared effect dimension reads as delegated creative work. `clip-audio` folds
 * into `processing` because a clip gain or fade is the same kind of sound-shaping edit a device is;
 * `cosmetic` names a change that alters nothing a listener hears and therefore needs no delegation.
 */
const CREATIVE_DIMENSION_BY_EFFECT_DIMENSION: Partial<Record<EffectDimension, CreativeEditDimension>> = {
    processing: 'processing',
    'clip-audio': 'processing',
    'midi-content': 'midi-content',
    arrangement: 'arrangement',
};

const CREATION_SLOT_OBJECT_TYPES: readonly CreationSlotObjectType[] = ['track', 'clip', 'notes', 'device'];

function isCreationSlotObjectType(objectType: EffectCreatedObject): objectType is CreationSlotObjectType {
    return CREATION_SLOT_OBJECT_TYPES.some((candidate) => candidate === objectType);
}

/**
 * A device this same batch is creating, named either by the `$binding` a plan item declared or by
 * the identity the bridge stamped on it. Certifying such a reference does not bind it: the bridge
 * still resolves the binding and checks its capability, and this only says the authority reaches it.
 */
function isBatchLocalDeviceReference(value: unknown): boolean {
    if (typeof value !== 'string') {
        return false;
    }
    return value.startsWith('$') || value.startsWith(GENERATED_BATCH_LOCAL_ID_PREFIXES.addDevice);
}

function findDeviceOwnerTrackId(context: ProjectContext, deviceId: unknown): string | null {
    if (typeof deviceId !== 'string') {
        return null;
    }
    const owner = context.tracks.find((track) => track.devices.some((device) => device.id === deviceId));
    return owner?.id ?? null;
}

function findClipOwnerTrackId(context: ProjectContext, clipId: unknown): string | null {
    if (typeof clipId !== 'string') {
        return null;
    }
    const owner = context.tracks.find((track) => track.clips.some((clip) => clip.id === clipId));
    return owner?.id ?? null;
}

type AuthorityIndex = {
    clipIds: ReadonlySet<string>;
    excludedDimensions: ReadonlySet<CreativeEditDimension>;
    editDimensions: ReadonlySet<CreativeEditDimension>;
    protectedIds: ReadonlySet<string>;
    trackIds: ReadonlySet<string>;
};

function indexAuthority(authority: CreativeRequestAuthority): AuthorityIndex {
    return {
        clipIds: new Set(
            authority.targets
                .filter((target) => target.objectType === 'clip' || target.objectType === 'clip-set')
                .flatMap((target) => [...target.objectIds])
        ),
        editDimensions: new Set(authority.editDimensions),
        excludedDimensions: new Set(
            authority.prohibitions.flatMap((prohibition) =>
                prohibition.kind === 'exclude-dimension' ? [prohibition.dimension] : []
            )
        ),
        protectedIds: new Set(
            authority.prohibitions.flatMap((prohibition) =>
                prohibition.kind === 'protect-object' ? [prohibition.objectId] : []
            )
        ),
        trackIds: new Set(
            authority.targets
                .filter((target) => target.objectType === 'track')
                .flatMap((target) => [...target.objectIds])
        ),
    };
}

function findCreativeDimensionRejection(dimension: EffectDimension, index: AuthorityIndex): string | null {
    const creativeDimension = CREATIVE_DIMENSION_BY_EFFECT_DIMENSION[dimension];
    if (creativeDimension === undefined) {
        return null;
    }
    if (!index.editDimensions.has(creativeDimension)) {
        return `${REASON_PREFIX} does not cover the ${creativeDimension} edit dimension`;
    }
    if (index.excludedDimensions.has(creativeDimension)) {
        return `${REASON_PREFIX} excludes the ${creativeDimension} edit dimension`;
    }
    return null;
}

/**
 * A conditional write is charged against the authority when it names delegated creative work, and
 * otherwise left to the execution-time policy that owns it: `conditional` entries describe writes
 * that depend on live runtime state, which no request-time check can decide. Refusing them here
 * would refuse every ordinary processing edit, since almost all of them can also touch an
 * automation lane while the transport records.
 */
function findDimensionRejection(effect: ExecutableAppActionEffect, index: AuthorityIndex): string | null {
    for (const dimension of effect.dimensions) {
        if (dimension === 'cosmetic') {
            continue;
        }
        if (CREATIVE_DIMENSION_BY_EFFECT_DIMENSION[dimension] === undefined) {
            return `${REASON_PREFIX} does not extend to ${dimension} effects`;
        }
        const rejection = findCreativeDimensionRejection(dimension, index);
        if (rejection !== null) {
            return rejection;
        }
    }
    for (const conditional of effect.conditional ?? []) {
        const rejection = findCreativeDimensionRejection(conditional.dimension, index);
        if (rejection !== null) {
            return rejection;
        }
    }
    return null;
}

type TargetIdAdmissionInput = {
    capability: string;
    context: ProjectContext;
    dependencyValue: unknown;
    hasAdmittedDeviceCreation: boolean;
    index: AuthorityIndex;
    objectId: string;
};

/** The track a target hangs under, so protection of that track reaches everything it holds. */
function findTargetOwnerTrackId(input: TargetIdAdmissionInput): string | null {
    if (getAgentReferenceCapabilityKind(input.capability) === 'clip') {
        return findClipOwnerTrackId(input.context, input.objectId);
    }
    if (input.capability === 'device') {
        return findDeviceOwnerTrackId(input.context, input.objectId);
    }
    if (input.capability === 'device-parameter') {
        return findDeviceOwnerTrackId(input.context, input.dependencyValue);
    }
    return null;
}

function findProtectedObjectRejection(input: TargetIdAdmissionInput): string | null {
    if (input.index.protectedIds.has(input.objectId)) {
        return `${REASON_PREFIX} protects object ${input.objectId}`;
    }
    const ownerTrackId = findTargetOwnerTrackId(input);
    if (ownerTrackId !== null && input.index.protectedIds.has(ownerTrackId)) {
        return `${REASON_PREFIX} protects object ${ownerTrackId}`;
    }
    return null;
}

function findDeviceOwnershipRejection(input: TargetIdAdmissionInput, deviceId: unknown): string | null {
    const ownerTrackId = findDeviceOwnerTrackId(input.context, deviceId);
    if (ownerTrackId !== null && input.index.trackIds.has(ownerTrackId)) {
        return null;
    }
    if (ownerTrackId === null && isBatchLocalDeviceReference(deviceId) && input.hasAdmittedDeviceCreation) {
        return null;
    }
    return `${REASON_PREFIX} does not cover the device ${String(deviceId)}`;
}

/** Null means the id is inside the authority; a string is the reason it is not. */
function findTargetIdRejection(input: TargetIdAdmissionInput): string | null {
    const protectionRejection = findProtectedObjectRejection(input);
    if (protectionRejection !== null) {
        return protectionRejection;
    }
    if (getAgentReferenceCapabilityKind(input.capability) === 'track') {
        return input.index.trackIds.has(input.objectId)
            ? null
            : `${REASON_PREFIX} does not cover the track ${input.objectId}`;
    }
    // A track target authorises the content of its clips; a clip target never widens back out to the
    // track that holds it, which is what keeps "work on this clip" from reaching the whole strip.
    if (getAgentReferenceCapabilityKind(input.capability) === 'clip') {
        if (input.index.clipIds.has(input.objectId)) {
            return null;
        }
        const ownerTrackId = findClipOwnerTrackId(input.context, input.objectId);
        return ownerTrackId !== null && input.index.trackIds.has(ownerTrackId)
            ? null
            : `${REASON_PREFIX} does not cover the clip ${input.objectId}`;
    }
    if (input.capability === 'device') {
        return findDeviceOwnershipRejection(input, input.objectId);
    }
    if (input.capability === 'device-parameter') {
        return findDeviceOwnershipRejection(input, input.dependencyValue);
    }
    return `${REASON_PREFIX} does not admit target capability ${input.capability}`;
}

type TargetRuleAdmission =
    { status: 'admitted'; targets: readonly CreativeAdmittedTarget[] } | { status: 'rejected'; reason: string };

function admitTargetRule(input: {
    assertedValue: unknown;
    context: ProjectContext;
    dependencyValue: unknown;
    hasAdmittedDeviceCreation: boolean;
    index: AuthorityIndex;
    targetRule: TargetRule;
}): TargetRuleAdmission {
    const { assertedValue, targetRule } = input;
    const assertedIds = targetRule.cardinality === 'many' ? assertedValue : [assertedValue];
    if (!Array.isArray(assertedIds) || assertedIds.length === 0) {
        return { status: 'rejected', reason: `${REASON_PREFIX} cannot read target ${targetRule.argument}` };
    }
    const targets: CreativeAdmittedTarget[] = [];
    for (const objectId of assertedIds) {
        if (typeof objectId !== 'string' || objectId.length === 0) {
            return { status: 'rejected', reason: `${REASON_PREFIX} cannot read target ${targetRule.argument}` };
        }
        const rejection = findTargetIdRejection({
            capability: targetRule.capability,
            context: input.context,
            dependencyValue: input.dependencyValue,
            hasAdmittedDeviceCreation: input.hasAdmittedDeviceCreation,
            index: input.index,
            objectId,
        });
        if (rejection !== null) {
            return { status: 'rejected', reason: rejection };
        }
        targets.push({ argument: targetRule.argument, capability: targetRule.capability, objectId });
    }
    return { status: 'admitted', targets };
}

function admitTargets(input: {
    call: ToolCallResult;
    context: ProjectContext;
    hasAdmittedDeviceCreation: boolean;
    index: AuthorityIndex;
    targetRules: readonly TargetRule[];
}): TargetRuleAdmission {
    const targets: CreativeAdmittedTarget[] = [];
    for (const targetRule of input.targetRules) {
        const assertedValue = input.call.arguments[targetRule.argument];
        if (targetRule.optional === true && assertedValue === undefined) {
            continue;
        }
        const admission = admitTargetRule({
            assertedValue,
            context: input.context,
            dependencyValue:
                targetRule.dependsOn === undefined ? undefined : input.call.arguments[targetRule.dependsOn],
            hasAdmittedDeviceCreation: input.hasAdmittedDeviceCreation,
            index: input.index,
            targetRule,
        });
        if (admission.status === 'rejected') {
            return admission;
        }
        targets.push(...admission.targets);
    }
    return { status: 'admitted', targets };
}

/**
 * Which already-admitted object a creation hangs under. A track creates itself, so it has no parent;
 * a clip or device hangs under the call's admitted track; notes hang under the admitted clip, whose
 * own track slot answers for them too.
 */
function getCreationParentObjectIds(
    objectType: CreationSlotObjectType,
    targets: readonly CreativeAdmittedTarget[],
    context: ProjectContext
): readonly (string | null)[] | null {
    if (objectType === 'track') {
        return [null];
    }
    if (objectType === 'notes') {
        const clipTarget = targets.find((target) => getAgentReferenceCapabilityKind(target.capability) === 'clip');
        if (clipTarget === undefined) {
            return null;
        }
        const ownerTrackId = findClipOwnerTrackId(context, clipTarget.objectId);
        return ownerTrackId === null ? [clipTarget.objectId] : [clipTarget.objectId, ownerTrackId];
    }
    const trackTarget = targets.find((target) => getAgentReferenceCapabilityKind(target.capability) === 'track');
    return trackTarget === undefined ? null : [trackTarget.objectId];
}

type CreationAdmission =
    { status: 'admitted'; usedSlotIndexes: readonly number[] } | { status: 'rejected'; reason: string };

function admitCreations(input: {
    authority: CreativeRequestAuthority;
    context: ProjectContext;
    creates: readonly EffectCreatedObject[];
    slotUsage: ReadonlyMap<number, number>;
    targets: readonly CreativeAdmittedTarget[];
}): CreationAdmission {
    const usedSlotIndexes: number[] = [];
    const pendingUsageBySlotIndex = new Map<number, number>();
    for (const objectType of input.creates) {
        if (!isCreationSlotObjectType(objectType)) {
            return { status: 'rejected', reason: `${REASON_PREFIX} admits no ${objectType} creation` };
        }
        const parentObjectIds = getCreationParentObjectIds(objectType, input.targets, input.context);
        if (parentObjectIds === null) {
            return {
                status: 'rejected',
                reason: `${REASON_PREFIX} publishes no creation slots under a track this batch creates`,
            };
        }
        const matchingSlots = input.authority.creationSlots.flatMap((slot, slotIndex) =>
            slot.objectType === objectType && parentObjectIds.includes(slot.parentObjectId) ? [{ slot, slotIndex }] : []
        );
        if (matchingSlots.length === 0) {
            return { status: 'rejected', reason: `${REASON_PREFIX} publishes no ${objectType} creation slot here` };
        }
        const usable = matchingSlots.find(
            ({ slot, slotIndex }) =>
                (input.slotUsage.get(slotIndex) ?? 0) + (pendingUsageBySlotIndex.get(slotIndex) ?? 0) < slot.budget
        );
        if (usable === undefined) {
            return {
                status: 'rejected',
                reason: `${REASON_PREFIX} has spent its ${objectType} creation budget of ${String(matchingSlots[0]!.slot.budget)}`,
            };
        }
        pendingUsageBySlotIndex.set(usable.slotIndex, (pendingUsageBySlotIndex.get(usable.slotIndex) ?? 0) + 1);
        usedSlotIndexes.push(usable.slotIndex);
    }
    return { status: 'admitted', usedSlotIndexes };
}

function admitCall(input: {
    authority: CreativeRequestAuthority;
    call: ToolCallResult;
    context: ProjectContext;
    hasAdmittedDeviceCreation: boolean;
    index: AuthorityIndex;
    slotUsage: ReadonlyMap<number, number>;
}): { admission: CreativeCallAdmission; usedSlotIndexes: readonly number[] } {
    const reject = (reason: string) => ({ admission: { status: 'rejected' as const, reason }, usedSlotIndexes: [] });
    const effect = getExecutableAppActionEffect(input.call.name);
    if (effect === null) {
        return reject(`${REASON_PREFIX} cannot admit the unknown command ${input.call.name}`);
    }
    // Read-only is the interpretation that the request asked for nothing to change, so it admits no
    // command that declares a write of any kind rather than a narrower set of them.
    if (
        input.authority.mode === 'read-only' &&
        (effect.dimensions.length > 0 || (effect.creates ?? []).length > 0 || (effect.removes ?? []).length > 0)
    ) {
        return reject(`${REASON_PREFIX} is read-only and admits no writing command`);
    }
    const dimensionRejection = findDimensionRejection(effect, input.index);
    if (dimensionRejection !== null) {
        return reject(dimensionRejection);
    }
    if (effect.scope !== 'target' && effect.scope !== 'descendants') {
        return reject(
            `${REASON_PREFIX} does not reach past the named target, and this command's scope is ${effect.scope}`
        );
    }
    // A deletion is never something a request delegated by describing a sound; an explicit request to
    // remove an object carries its own vocabulary and grounds on the ordinary route.
    if ((effect.removes ?? []).length > 0) {
        return reject(`${REASON_PREFIX} never removes existing objects`);
    }
    const groundingRules = getExecutableAppActionGroundingRules(input.call.name);
    if (groundingRules === null) {
        return reject(`${REASON_PREFIX} cannot admit the unknown command ${input.call.name}`);
    }
    const targetAdmission = admitTargets({
        call: input.call,
        context: input.context,
        hasAdmittedDeviceCreation: input.hasAdmittedDeviceCreation,
        index: input.index,
        targetRules: groundingRules.targetRules,
    });
    if (targetAdmission.status === 'rejected') {
        return reject(targetAdmission.reason);
    }
    const creationAdmission = admitCreations({
        authority: input.authority,
        context: input.context,
        creates: effect.creates ?? [],
        slotUsage: input.slotUsage,
        targets: targetAdmission.targets,
    });
    if (creationAdmission.status === 'rejected') {
        return reject(creationAdmission.reason);
    }
    return {
        admission: { status: 'admitted', targets: targetAdmission.targets },
        usedSlotIndexes: creationAdmission.usedSlotIndexes,
    };
}

/**
 * What the admitted creative authority itself grounds, decided once for the whole batch.
 *
 * A request that describes a sound rather than an object names no command, no target and no value,
 * so the per-action prompt-vocabulary rules can never be satisfied for it. This reads the same
 * question off the application's own record of what the request was admitted to mean: the effect the
 * handler declares, the objects the authority names, and the creation slots it published. Nothing
 * here reads provider prose, and a call outside the record is refused with the reason that names it.
 */
export function admitCreativeCommandBatch(input: {
    authority: CreativeRequestAuthority;
    calls: readonly ToolCallResult[];
    context: ProjectContext;
}): ReadonlyMap<number, CreativeCallAdmission> {
    const index = indexAuthority(input.authority);
    const admissionsByCallIndex = new Map<number, CreativeCallAdmission>();
    const slotUsage = new Map<number, number>();
    let hasAdmittedDeviceCreation = false;
    for (const [callIndex, call] of input.calls.entries()) {
        const { admission, usedSlotIndexes } = admitCall({
            authority: input.authority,
            call,
            context: input.context,
            hasAdmittedDeviceCreation,
            index,
            slotUsage,
        });
        admissionsByCallIndex.set(callIndex, admission);
        if (admission.status !== 'admitted') {
            continue;
        }
        for (const slotIndex of usedSlotIndexes) {
            slotUsage.set(slotIndex, (slotUsage.get(slotIndex) ?? 0) + 1);
        }
        if (call.name === 'addDevice') {
            hasAdmittedDeviceCreation = true;
        }
    }
    return admissionsByCallIndex;
}
