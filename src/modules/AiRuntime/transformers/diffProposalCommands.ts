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
 * The payload fields that say which object a command acts on, as the payload carries them. Two
 * commands of one type on the same targets are the same command changed; anything else in the
 * payload is a value the refinement may have changed.
 */
const TARGET_IDENTITY_FIELDS = ['trackId', 'busId', 'deviceId', 'parameterId', 'sendId'] as const;

type KeyedCommand = { key: string; actionType: string; label: string; payload: Readonly<Record<string, unknown>> };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function targetIdentity(actionType: string, payload: Readonly<Record<string, unknown>>): string {
    const targets = TARGET_IDENTITY_FIELDS.flatMap((field) =>
        typeof payload[field] === 'string' ? [`${field}=${payload[field]}`] : []
    );
    return [actionType, ...targets].join('|');
}

/** Each command under its identity, numbered within it, so two alike commands pair in order. */
function keyCommands(proposal: ProposalCommands): KeyedCommand[] {
    const occurrences = new Map<string, number>();
    return proposal.actions.map((action, index) => {
        const payload = isRecord(action.payload) ? action.payload : {};
        const identity = targetIdentity(action.type, payload);
        const occurrence = occurrences.get(identity) ?? 0;
        occurrences.set(identity, occurrence + 1);
        return {
            key: `${identity}#${String(occurrence)}`,
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
 * What a replacement proposal changes against the proposal it replaced, command by command. A
 * command is matched by its action type and the targets its payload names; a match whose payload
 * differs is changed, with each differing field's previous and new value, and an unmatched command
 * was added or removed. Commands left exactly as they were are counted, not listed.
 */
export function diffProposalCommands(previous: ProposalCommands, next: ProposalCommands): ProposalCommandDiff {
    const unmatchedPrevious = new Map(keyCommands(previous).map((command) => [command.key, command]));
    const changes: ProposalCommandChange[] = [];
    let unchangedCount = 0;
    for (const command of keyCommands(next)) {
        const counterpart = unmatchedPrevious.get(command.key);
        if (counterpart === undefined) {
            changes.push({ kind: 'added', actionType: command.actionType, label: command.label });
            continue;
        }
        unmatchedPrevious.delete(command.key);
        const fields = changedFields(counterpart.payload, command.payload);
        if (fields.length === 0) {
            unchangedCount += 1;
            continue;
        }
        changes.push({ kind: 'changed', actionType: command.actionType, label: command.label, fields });
    }
    for (const command of unmatchedPrevious.values()) {
        changes.push({ kind: 'removed', actionType: command.actionType, label: command.label });
    }
    return { changes, unchangedCount };
}
