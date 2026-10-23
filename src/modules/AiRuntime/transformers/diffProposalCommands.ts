import { formatDecibels } from '#/utils/audioLevelLaw';
import { canonicalJson } from '#/utils/canonicalDigest';

import { PROPOSAL_DECIBEL_FORMAT } from './proposalDecibelFormat';

type ProposalCommands = {
    actions: ReadonlyArray<{ type: string; payload?: unknown }>;
    actionLabels: readonly string[];
};

type ChangedField = { field: string; previous: string | null; next: string | null };

type ProposalCommandChange =
    | { kind: 'added'; actionType: string; label: string }
    | { kind: 'removed'; actionType: string; label: string }
    | { kind: 'changed'; actionType: string; label: string; fields: ChangedField[] };

type ProposalCommandDiff = { changes: ProposalCommandChange[]; unchangedCount: number };

/**
 * Which object a command acts on, read from the action registry by the caller: the object itself, and
 * the members of any set of sources or placements it acts on there. A creation id is no target, so it
 * never pairs a fresh object with an old one.
 */
export type CommandObjectIdentity = (
    actionType: string,
    payload: Readonly<Record<string, unknown>>
) => { object: string; members: readonly string[]; membersAreSources: boolean };

type KeyedCommand = {
    identity: string;
    object: string;
    members: ReadonlySet<string>;
    membersAreSources: boolean;
    actionType: string;
    label: string;
    payload: Readonly<Record<string, unknown>>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keep the command's target identity and payload separate so exact occurrences can pair first. */
function keyCommands(proposal: ProposalCommands, objectIdentity: CommandObjectIdentity): KeyedCommand[] {
    return proposal.actions.map((action, index) => {
        const payload = isRecord(action.payload) ? action.payload : {};
        const { object, members, membersAreSources } = objectIdentity(action.type, payload);
        return {
            identity: canonicalJson([object, members]),
            object,
            members: new Set(members),
            membersAreSources,
            actionType: action.type,
            label: proposal.actionLabels[index] ?? action.type,
            payload,
        };
    });
}

/** A field value as a musician reads it: decibel fields with their unit, as the labels state them. */
function renderValue(field: string, value: unknown): string | null {
    if (value === undefined) {
        return null;
    }
    if (typeof value === 'number' && field.endsWith('Db')) {
        return `${formatDecibels(value, PROPOSAL_DECIBEL_FORMAT)} dB`;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return canonicalJson(value);
}

/** A field's exact value for comparison, `null` when the payload leaves it out. */
function exactValue(payload: Readonly<Record<string, unknown>>, field: string): string | null {
    return Object.hasOwn(payload, field) ? canonicalJson(payload[field]) : null;
}

function changedFields(
    previous: Readonly<Record<string, unknown>>,
    next: Readonly<Record<string, unknown>>
): ChangedField[] {
    const fields = Array.from(new Set([...Object.keys(previous), ...Object.keys(next)]));
    return fields
        .filter((field) => exactValue(previous, field) !== exactValue(next, field))
        .map((field) => ({
            field,
            previous: renderValue(field, previous[field]),
            next: renderValue(field, next[field]),
        }));
}

function sharesMember(left: KeyedCommand, right: KeyedCommand): boolean {
    return Array.from(left.members).some((member) => right.members.has(member));
}

type PairingState = {
    previousCommands: readonly KeyedCommand[];
    nextCommands: readonly KeyedCommand[];
    /** Each paired next command's previous command, by index. */
    pairs: Map<number, number>;
    pairedPrevious: Set<number>;
};

/**
 * Pair each unpaired next command with the one unpaired previous command `related` admits, when that
 * previous command admits no other unpaired next command either; any other count is ambiguous lineage.
 */
function pairUniquely(state: PairingState, related: (previous: KeyedCommand, next: KeyedCommand) => boolean): void {
    const { previousCommands, nextCommands, pairs, pairedPrevious } = state;
    const unpairedNext = (index: number) => !pairs.has(index);
    const unpairedPrevious = (index: number) => !pairedPrevious.has(index);
    for (const [nextIndex, command] of nextCommands.entries()) {
        if (!unpairedNext(nextIndex)) {
            continue;
        }
        const previousCandidates = previousCommands.flatMap((candidate, index) =>
            unpairedPrevious(index) && related(candidate, command) ? [index] : []
        );
        const [previousIndex] = previousCandidates;
        if (previousCandidates.length !== 1 || previousIndex === undefined) {
            continue;
        }
        const previousCommand = previousCommands[previousIndex]!;
        const nextCandidates = nextCommands.filter(
            (candidate, index) => unpairedNext(index) && related(previousCommand, candidate)
        );
        if (nextCandidates.length !== 1) {
            continue;
        }
        pairs.set(nextIndex, previousIndex);
        pairedPrevious.add(previousIndex);
    }
}

/**
 * What a replacement proposal changes against the proposal it replaced, command by command.
 * Exact command occurrences match first. A differing command is paired by type and target only
 * when one unpaired occurrence remains on each side; then a command acting on a set of sources or
 * placements pairs with the one on the same object whose set shares a member, and a set of sources
 * pairs by type and object alone when that is the only one on each side. Anything else is ambiguous
 * lineage, and the comparison reports additions and removals without claiming which old value changed.
 */
export function diffProposalCommands(
    previous: ProposalCommands,
    next: ProposalCommands,
    objectIdentity: CommandObjectIdentity
): ProposalCommandDiff {
    const previousCommands = keyCommands(previous, objectIdentity);
    const nextCommands = keyCommands(next, objectIdentity);
    const state: PairingState = { previousCommands, nextCommands, pairs: new Map(), pairedPrevious: new Set() };
    // Preserve exact occurrences before pairing changed peers. Removing the first of two clips on
    // one track must leave the second clip unchanged even though its occurrence number shifted.
    const exactNext = new Set<number>();
    for (const [nextIndex, command] of nextCommands.entries()) {
        const previousIndex = previousCommands.findIndex(
            (candidate, index) =>
                !state.pairedPrevious.has(index) &&
                candidate.identity === command.identity &&
                canonicalJson(candidate.payload) === canonicalJson(command.payload)
        );
        if (previousIndex >= 0) {
            state.pairedPrevious.add(previousIndex);
            state.pairs.set(nextIndex, previousIndex);
            exactNext.add(nextIndex);
        }
    }
    pairUniquely(state, (left, right) => left.identity === right.identity);
    pairUniquely(state, (left, right) => left.object === right.object && sharesMember(left, right));
    pairUniquely(
        state,
        (left, right) => left.object === right.object && left.membersAreSources && right.membersAreSources
    );
    const changes: ProposalCommandChange[] = [];
    for (const [nextIndex, command] of nextCommands.entries()) {
        const previousIndex = state.pairs.get(nextIndex);
        if (previousIndex === undefined) {
            changes.push({ kind: 'added', actionType: command.actionType, label: command.label });
            continue;
        }
        const fields = changedFields(previousCommands[previousIndex]!.payload, command.payload);
        if (fields.length > 0) {
            changes.push({ kind: 'changed', actionType: command.actionType, label: command.label, fields });
        }
    }
    for (const [index, command] of previousCommands.entries()) {
        if (!state.pairedPrevious.has(index)) {
            changes.push({ kind: 'removed', actionType: command.actionType, label: command.label });
        }
    }
    return { changes, unchangedCount: exactNext.size };
}
