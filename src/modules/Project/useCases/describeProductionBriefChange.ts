import { isProductionBrief, type ProductionBrief, type ProductionBriefScope } from '../models/ProductionBrief';

type DescribeInput = {
    before: ProductionBrief;
    /** A command payload carries the brief as data, so it is read as a brief here before it is described. */
    after: unknown;
    /** Display names for the ids the brief names; an id with no name is shown as "an unnamed track". */
    trackNames: Readonly<Record<string, string>>;
    sectionNames: Readonly<Record<string, string>>;
};

function added<Entry extends { id: string }>(before: readonly Entry[], after: readonly Entry[]): Entry[] {
    const held = new Set(before.map((entry) => entry.id));
    return after.filter((entry) => !held.has(entry.id));
}

function removed<Entry extends { id: string }>(before: readonly Entry[], after: readonly Entry[]): Entry[] {
    return added(after, before);
}

type Described = Omit<DescribeInput, 'after'> & { after: ProductionBrief };

function trackName(input: Described, trackId: string): string {
    return input.trackNames[trackId] ?? 'an unnamed track';
}

function sectionName(input: Described, sectionId: string): string {
    return input.sectionNames[sectionId] ?? 'an unnamed section';
}

function scopeLabel(input: Described, scope: ProductionBriefScope): string {
    if (scope.kind === 'track') {
        return trackName(input, scope.trackId);
    }
    if (scope.kind === 'section') {
        return sectionName(input, scope.sectionId);
    }
    return scope.kind === 'project' ? 'whole project' : scope.kind;
}

function describeVision(input: Described): string[] {
    if (input.before.vision === input.after.vision) {
        return [];
    }
    if (input.after.vision === null) {
        return ['Vision: removed'];
    }
    return [`Vision: ${input.after.vision}`];
}

/**
 * One line per entry a brief change adds or removes, in the brief's own field order, so the person
 * confirming it reads exactly what will be written. Locks are never changed by a request, so they are
 * counted rather than listed: the count shows they survive. A payload that is not a brief describes
 * nothing, so the caller can say so instead of showing a change it cannot read.
 */
export function describeProductionBriefChange(described: DescribeInput): string[] | null {
    const { after } = described;
    if (!isProductionBrief(after)) {
        return null;
    }
    const input: Described = { ...described, after };
    const { before } = input;
    const lines = [
        ...describeVision(input),
        ...added(before.references, after.references).map((entry) => `Reference: ${entry.label}`),
        ...removed(before.references, after.references).map((entry) => `Reference removed: ${entry.label}`),
        ...added(before.hardConstraints, after.hardConstraints).map(
            (entry) => `Must hold (${scopeLabel(input, entry.scope)}): ${entry.statement}`
        ),
        ...added(before.preferences, after.preferences).map(
            (entry) => `Preference (${scopeLabel(input, entry.scope)}): ${entry.statement}`
        ),
        ...added(before.sectionGoals, after.sectionGoals).map(
            (entry) => `${sectionName(input, entry.sectionId)} goal: ${entry.statement}`
        ),
        ...added(before.trackRoles, after.trackRoles).map(
            (entry) => `Role: ${trackName(input, entry.trackId)} is the ${entry.role}`
        ),
    ];
    if (after.locks.length > 0) {
        lines.push(`Locks kept: ${String(after.locks.length)}`);
    }
    return lines;
}
