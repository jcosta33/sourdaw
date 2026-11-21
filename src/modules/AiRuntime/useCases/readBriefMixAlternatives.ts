import { type RequestedBriefMixAlternative } from '../models/BriefReading';

import { getBriefMixIntentCatalog } from './getBriefMixIntentCatalog';
import { type BriefMixIntent, readBriefMixIntent } from './readBriefMixIntent';

export const BRIEF_ALTERNATIVES_MAX = 3;
export const BRIEF_ALTERNATIVE_NAME_MAX_LENGTH = 40;

type MixDescriptor = BriefMixIntent['requestedDescriptors'][number];

/** A reading whose characters are the recipe catalogue's own descriptors, not any string. */
export type CatalogBriefMixAlternative = RequestedBriefMixAlternative & {
    requestedDescriptors: readonly MixDescriptor[];
};

type ReadMixIntentWithAlternatives =
    | { status: 'read'; mixIntent: BriefMixIntent; alternatives: readonly CatalogBriefMixAlternative[] }
    | { status: 'invalid'; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const NOT_A_SELECTION = 'mixIntent: provide a valid selection from the current catalog.';
const READING_SHAPE = 'mixIntent.alternatives: each reading is an object with only a name and requestedDescriptors.';

function invalid(reason: string): ReadMixIntentWithAlternatives {
    return { status: 'invalid', reason };
}

function readAlternative(value: unknown, descriptors: readonly MixDescriptor[]): CatalogBriefMixAlternative | string {
    if (!isRecord(value) || Object.keys(value).some((key) => key !== 'name' && key !== 'requestedDescriptors')) {
        return READING_SHAPE;
    }
    if (typeof value.name !== 'string' || !Array.isArray(value.requestedDescriptors)) {
        return READING_SHAPE;
    }
    const name = value.name.trim();
    if (name.length === 0 || name.length > BRIEF_ALTERNATIVE_NAME_MAX_LENGTH) {
        return `mixIntent.alternatives: each reading needs a name of 1 to ${String(BRIEF_ALTERNATIVE_NAME_MAX_LENGTH)} characters.`;
    }
    const requested: unknown[] = value.requestedDescriptors;
    if (requested.length === 0) {
        return `mixIntent.alternatives: reading "${name}" needs at least one character.`;
    }
    if (new Set(requested).size !== requested.length) {
        return `mixIntent.alternatives: reading "${name}" repeats a character.`;
    }
    const selected: MixDescriptor[] = [];
    for (const descriptor of requested) {
        const known = descriptors.find((candidate) => candidate === descriptor);
        if (known === undefined) {
            return `mixIntent.alternatives: reading "${name}" names an unknown character "${String(descriptor)}".`;
        }
        selected.push(known);
    }
    return { name, requestedDescriptors: selected };
}

function describeDuplicate(alternatives: readonly RequestedBriefMixAlternative[]): string | null {
    const names = new Set<string>();
    const sets = new Set<string>();
    for (const alternative of alternatives) {
        const name = alternative.name.toLowerCase();
        if (names.has(name)) {
            return `mixIntent.alternatives: two readings have the same name "${alternative.name}".`;
        }
        names.add(name);
        const characters = [...alternative.requestedDescriptors].toSorted().join(',');
        if (sets.has(characters)) {
            return `mixIntent.alternatives: two readings stand for the same characters; "${alternative.name}" repeats one.`;
        }
        sets.add(characters);
    }
    return null;
}

/**
 * Reads `brief.compile`'s `mixIntent`: the two-key selection exactly as before, plus optional named
 * readings. Absent, `null` and `[]` mean none. Readings are offered only in place of a selection, so a
 * single reading, four or more, or readings beside a selection are refused with the rule they break.
 */
export function readBriefMixIntentWithAlternatives(value: unknown): ReadMixIntentWithAlternatives {
    if (!isRecord(value)) {
        return invalid(NOT_A_SELECTION);
    }
    const { alternatives: provided, ...selection } = value;
    const mixIntent = readBriefMixIntent(selection);
    if (mixIntent === null) {
        return invalid(NOT_A_SELECTION);
    }
    if (provided === undefined || provided === null) {
        return { status: 'read', mixIntent, alternatives: [] };
    }
    if (!Array.isArray(provided)) {
        return invalid('mixIntent.alternatives: provide a list of readings, or null when the request has one reading.');
    }
    const offered: unknown[] = provided;
    if (offered.length === 0) {
        return { status: 'read', mixIntent, alternatives: [] };
    }
    if (offered.length > BRIEF_ALTERNATIVES_MAX) {
        return invalid(
            `mixIntent.alternatives: at most three readings are allowed; offer the ${String(BRIEF_ALTERNATIVES_MAX)} most likely.`
        );
    }
    if (offered.length === 1) {
        return invalid(
            'mixIntent.alternatives: a single reading belongs in requestedDescriptors; offer two or three readings, or none.'
        );
    }
    if (mixIntent.requestedDescriptors.length > 0) {
        return invalid('mixIntent.requestedDescriptors must be empty when alternatives are offered.');
    }
    const catalog = getBriefMixIntentCatalog();
    const alternatives: CatalogBriefMixAlternative[] = [];
    for (const entry of offered) {
        const read = readAlternative(entry, catalog.descriptors);
        if (typeof read === 'string') {
            return invalid(read);
        }
        alternatives.push(read);
    }
    const duplicate = describeDuplicate(alternatives);
    if (duplicate !== null) {
        return invalid(duplicate);
    }
    return { status: 'read', mixIntent, alternatives };
}
