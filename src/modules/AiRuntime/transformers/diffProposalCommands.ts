import { formatDecibels } from '#/utils/audioLevelLaw';
import { canonicalJson } from '#/utils/canonicalDigest';

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
 * Which object a command acts on, read from the action registry by the caller; two commands pair
 * only when it is the same. A creation id is no target, so it never pairs a fresh object with an old one.
 */
export type CommandObjectIdentity = (actionType: string, payload: Readonly<Record<string, unknown>>) => string;

type KeyedCommand = { identity: string; actionType: string; label: string; payload: Readonly<Record<string, unknown>> };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keep the command's target identity and payload separate so exact occurrences can pair first. */
function keyCommands(proposal: ProposalCommands, objectIdentity: CommandObjectIdentity): KeyedCommand[] {
    return proposal.actions.map((action, index) => {
        const payload = isRecord(action.payload) ? action.payload : {};
        return {
            identity: objectIdentity(action.type, payload),
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
        return `${formatDecibels(value, { trimTrailingZeros: true })} dB`;
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

/**
 * What a replacement proposal changes against the proposal it replaced, command by command.
 * Exact command occurrences match first. A differing command is paired by type and target only
 * when one unmatched occurrence remains on each side; otherwise its lineage is ambiguous and the
 * comparison reports additions and removals without claiming which old value changed.
 */
export function diffProposalCommands(
    previous: ProposalCommands,
    next: ProposalCommands,
    objectIdentity: CommandObjectIdentity
): ProposalCommandDiff {
    const previousCommands = keyCommands(previous, objectIdentity);
    const nextCommands = keyCommands(next, objectIdentity);
    const matchedPrevious = new Set<number>();
    const exactNext = new Set<number>();
    // Preserve exact occurrences before pairing changed peers. Removing the first of two clips on
    // one track must leave the second clip unchanged even though its occurrence number shifted.
    for (const [nextIndex, command] of nextCommands.entries()) {
        const previousIndex = previousCommands.findIndex(
            (candidate, index) =>
                !matchedPrevious.has(index) &&
                candidate.identity === command.identity &&
                canonicalJson(candidate.payload) === canonicalJson(command.payload)
        );
        if (previousIndex >= 0) {
            matchedPrevious.add(previousIndex);
            exactNext.add(nextIndex);
        }
    }
    const changes: ProposalCommandChange[] = [];
    for (const [nextIndex, command] of nextCommands.entries()) {
        if (exactNext.has(nextIndex)) {
            continue;
        }
        const previousCandidates = previousCommands.flatMap((candidate, index) =>
            !matchedPrevious.has(index) && candidate.identity === command.identity ? [index] : []
        );
        const nextCandidates = nextCommands.filter(
            (candidate, index) => !exactNext.has(index) && candidate.identity === command.identity
        );
        if (previousCandidates.length !== 1 || nextCandidates.length !== 1) {
            changes.push({ kind: 'added', actionType: command.actionType, label: command.label });
            continue;
        }
        const previousIndex = previousCandidates[0]!;
        matchedPrevious.add(previousIndex);
        const fields = changedFields(previousCommands[previousIndex]!.payload, command.payload);
        if (fields.length === 0) {
            continue;
        }
        changes.push({ kind: 'changed', actionType: command.actionType, label: command.label, fields });
    }
    for (const [index, command] of previousCommands.entries()) {
        if (!matchedPrevious.has(index)) {
            changes.push({ kind: 'removed', actionType: command.actionType, label: command.label });
        }
    }
    return { changes, unchangedCount: exactNext.size };
}
