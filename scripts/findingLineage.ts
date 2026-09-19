/**
 * Superseded-finding lineage for a replaced pull request (#3001, spec #2995 AC-014).
 *
 * When a pull request carrying accepted or unresolved findings is superseded, the old pull request
 * may close only once every such finding has exactly one recorded disposition on the replacement:
 * repaired there, transferred to it, or explicitly discarded. This module owns that total map, its
 * canonical marker, and its parser. Marker payloads are key-sorted, whitespace-free JSON so one
 * lineage has exactly one byte representation, and every caller-written field is validated through
 * the review dossier's publication-safety contract rather than a second, drifting set of rules.
 *
 * Parsing never launders a corrupt record into an absent one: a body with no marker line is
 * `undefined`, while a present but malformed marker throws.
 */

import { canonicalJson, lastMarkerLine, parseMarkerPayload, type JsonValue } from './canonicalRecord.ts';
import { fail } from './prContract.ts';
import { assertPublicationSafeEvidence } from './reviewDossier.ts';

export const FINDING_LINEAGE_FORMAT = 'lineage-v1';

export type FindingDisposition = 'repaired' | 'transferred' | 'discarded';

export type FindingLineageEntry = {
    findingId: string;
    disposition: FindingDisposition;
    replacementPr: number | null;
    replacementFindingId: string | null;
    reason: string;
};

export type FindingLineage = {
    format: 'lineage-v1';
    oldPr: number;
    replacementPr: number;
    entries: FindingLineageEntry[];
};

/** One finding as the old pull request carries it; only `oldPr` findings belong in the lineage. */
export type LineageFinding = { findingId: string; pr: number };

/** The marker token; the canonical JSON payload follows it on the same, final record line. */
const LINEAGE_MARKER = `sourdaw-${FINDING_LINEAGE_FORMAT}`;
const SUMMARY_PREFIX = 'Finding lineage:';
const DISPOSITION_LIST = 'repaired, transferred or discarded';

const LINEAGE_KEYS = ['format', 'oldPr', 'replacementPr', 'entries'] as const;
const ENTRY_KEYS = ['findingId', 'disposition', 'replacementPr', 'replacementFindingId', 'reason'] as const;

/** A total map, so a widened disposition union fails to compile here rather than silently refusing. */
const DISPOSITIONS: Record<FindingDisposition, true> = {
    repaired: true,
    transferred: true,
    discarded: true,
};

function describeValue(value: unknown): string {
    return JSON.stringify(value) ?? typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDisposition(value: string): value is FindingDisposition {
    return Object.hasOwn(DISPOSITIONS, value);
}

function readLiteral<Value extends string>(
    label: string,
    value: unknown,
    matches: (candidate: string) => candidate is Value,
    expected: string
): Value {
    if (typeof value !== 'string' || !matches(value)) {
        fail(`finding lineage ${label} must be ${expected}, found ${describeValue(value)}`);
    }
    return value;
}

function readArray(label: string, value: unknown): readonly unknown[] {
    if (!Array.isArray(value)) {
        fail(`finding lineage ${label} must be an array, found ${describeValue(value)}`);
    }
    return value;
}

function readString(label: string, value: unknown): string {
    if (typeof value !== 'string') {
        fail(`finding lineage ${label} must be a string, found ${describeValue(value)}`);
    }
    return value;
}

function readNullableString(label: string, value: unknown): string | null {
    if (value === null) {
        return null;
    }
    return readString(label, value);
}

function readNullableNumber(label: string, value: unknown): number | null {
    if (value === null) {
        return null;
    }
    if (typeof value !== 'number') {
        fail(`finding lineage ${label} must be a number or null, found ${describeValue(value)}`);
    }
    return value;
}

function readPositiveInteger(label: string, value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        fail(`finding lineage ${label} must be a positive safe integer, found ${describeValue(value)}`);
    }
    return value;
}

/**
 * A caller-written field the record publishes. `assertPublicationSafeEvidence` is the dossier's
 * single rule for that, so the field bound, the edge-trim rule and the credential and transcript
 * shapes all come from there rather than from a locally invented copy.
 */
function readSafeString(label: string, value: unknown): string {
    const text = readString(label, value);
    assertPublicationSafeEvidence(`finding lineage ${label}`, [text]);
    return text;
}

function readNullableSafeString(label: string, value: unknown): string | null {
    if (value === null) {
        return null;
    }
    return readSafeString(label, value);
}

/** A reason is optional unless the disposition discards the finding, where a blank one records nothing. */
function readOptionalReason(label: string, value: unknown): string {
    const text = readString(label, value);
    if (text === '') {
        return text;
    }
    return readSafeString(label, text);
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
    const actual = Object.keys(record).sort().join(',');
    const expected = [...allowed].sort().join(',');
    if (actual !== expected) {
        fail(`finding lineage ${label} fields must be ${expected}, found ${actual}`);
    }
}

function readEntry(value: unknown, index: number): FindingLineageEntry {
    const label = `entries[${index}]`;
    if (!isRecord(value)) {
        fail(`finding lineage ${label} must be an object, found ${describeValue(value)}`);
    }
    assertExactKeys(value, ENTRY_KEYS, label);
    return {
        findingId: readString(`${label}.findingId`, value.findingId),
        disposition: readLiteral(`${label}.disposition`, value.disposition, isDisposition, DISPOSITION_LIST),
        replacementPr: readNullableNumber(`${label}.replacementPr`, value.replacementPr),
        replacementFindingId: readNullableString(`${label}.replacementFindingId`, value.replacementFindingId),
        reason: readString(`${label}.reason`, value.reason),
    };
}

function readLineage(value: unknown): FindingLineage {
    if (!isRecord(value)) {
        fail(`finding lineage marker payload must be a JSON object, found ${describeValue(value)}`);
    }
    assertExactKeys(value, LINEAGE_KEYS, 'lineage');
    if (value.format !== FINDING_LINEAGE_FORMAT) {
        fail(`finding lineage format must be ${FINDING_LINEAGE_FORMAT}, found ${describeValue(value.format)}`);
    }
    return {
        format: FINDING_LINEAGE_FORMAT,
        oldPr: readPositiveInteger('oldPr', value.oldPr),
        replacementPr: readPositiveInteger('replacementPr', value.replacementPr),
        entries: readArray('entries', value.entries).map(readEntry),
    };
}

function assertLineageIdentities(lineage: FindingLineage): number {
    if (lineage.format !== FINDING_LINEAGE_FORMAT) {
        fail(`finding lineage format must be ${FINDING_LINEAGE_FORMAT}, found ${describeValue(lineage.format)}`);
    }
    const oldPr = readPositiveInteger('oldPr', lineage.oldPr);
    const replacementPr = readPositiveInteger('replacementPr', lineage.replacementPr);
    if (oldPr === replacementPr) {
        fail(`finding lineage replacementPr must differ from oldPr, found ${oldPr}`);
    }
    return replacementPr;
}

function assertReplacementEntry(
    label: string,
    entry: FindingLineageEntry,
    disposition: 'repaired' | 'transferred',
    replacementPr: number
): void {
    if (entry.replacementPr !== replacementPr) {
        fail(`${label}.replacementPr must be ${replacementPr}, found ${describeValue(entry.replacementPr)}`);
    }
    const replacementFindingId = readNullableSafeString(`${label}.replacementFindingId`, entry.replacementFindingId);
    if (disposition === 'repaired' && replacementFindingId === null) {
        fail(`${label} is repaired, so replacementFindingId must name the finding on pull request ${replacementPr}`);
    }
    readOptionalReason(`${label}.reason`, entry.reason);
}

function assertDiscardedEntry(label: string, entry: FindingLineageEntry): void {
    if (entry.replacementPr !== null) {
        fail(`${label} is discarded, so replacementPr must be null, found ${describeValue(entry.replacementPr)}`);
    }
    if (entry.replacementFindingId !== null) {
        fail(
            `${label} is discarded, so replacementFindingId must be null, found ${describeValue(entry.replacementFindingId)}`
        );
    }
    readSafeString(`${label}.reason`, entry.reason);
}

function assertEntryShape(entry: FindingLineageEntry, index: number, replacementPr: number): string {
    const label = `entries[${index}]`;
    const findingId = readSafeString(`${label}.findingId`, entry.findingId);
    const disposition = readLiteral(`${label}.disposition`, entry.disposition, isDisposition, DISPOSITION_LIST);
    if (disposition === 'discarded') {
        assertDiscardedEntry(label, entry);
    } else {
        assertReplacementEntry(label, entry, disposition, replacementPr);
    }
    return findingId;
}

/** Everything a lineage must satisfy on its own, before it is held against a pull request's findings. */
function assertLineageShape(lineage: FindingLineage): void {
    const replacementPr = assertLineageIdentities(lineage);
    const seen = new Set<string>();
    for (const [index, entry] of lineage.entries.entries()) {
        const findingId = assertEntryShape(entry, index, replacementPr);
        if (seen.has(findingId)) {
            fail(`finding lineage repeats finding id: ${findingId}`);
        }
        seen.add(findingId);
    }
}

/**
 * The total map: every finding the old pull request carries appears in `entries` exactly once, and
 * every entry names one. Emptiness is covered from both sides — an entry is foreign when the old
 * pull request has no findings, and a finding without an entry is missing — so no separate check
 * decides it.
 */
function assertLineageTotality(lineage: FindingLineage, findings: readonly LineageFinding[]): void {
    const expected = new Set<string>();
    for (const finding of findings) {
        if (finding.pr === lineage.oldPr) {
            expected.add(finding.findingId);
        }
    }
    const recorded = new Set<string>();
    for (const entry of lineage.entries) {
        recorded.add(entry.findingId);
        if (!expected.has(entry.findingId)) {
            fail(`finding lineage entry ${entry.findingId} is not a finding on pull request ${lineage.oldPr}`);
        }
    }
    for (const findingId of expected) {
        if (!recorded.has(findingId)) {
            fail(`finding lineage has no entry for finding ${findingId} on pull request ${lineage.oldPr}`);
        }
    }
}

export function assertFindingLineage(lineage: FindingLineage, findings: readonly LineageFinding[]): void {
    assertLineageShape(lineage);
    assertLineageTotality(lineage, findings);
}

function serializeEntry(entry: FindingLineageEntry): JsonValue {
    return {
        findingId: entry.findingId,
        disposition: entry.disposition,
        replacementPr: entry.replacementPr,
        replacementFindingId: entry.replacementFindingId,
        reason: entry.reason,
    };
}

function serializeLineage(lineage: FindingLineage): string {
    return canonicalJson({
        format: lineage.format,
        oldPr: lineage.oldPr,
        replacementPr: lineage.replacementPr,
        entries: lineage.entries.map(serializeEntry),
    });
}

export function summarizeLineage(lineage: FindingLineage): {
    repaired: number;
    transferred: number;
    discarded: number;
} {
    const counts = { repaired: 0, transferred: 0, discarded: 0 };
    for (const entry of lineage.entries) {
        counts[entry.disposition] += 1;
    }
    return counts;
}

export function renderFindingLineage(lineage: FindingLineage): string {
    assertLineageShape(lineage);
    const counts = summarizeLineage(lineage);
    const summary = `${SUMMARY_PREFIX} #${lineage.oldPr} superseded by #${lineage.replacementPr}; repaired ${counts.repaired}, transferred ${counts.transferred}, discarded ${counts.discarded}`;
    return `${summary}\n${LINEAGE_MARKER} ${serializeLineage(lineage)}`;
}

/** The last lineage marker line in `body` wins, so an appended record supersedes an earlier one. */
export function parseFindingLineage(body: string): FindingLineage | undefined {
    const marker = lastMarkerLine(body, LINEAGE_MARKER);
    if (marker === undefined) {
        return undefined;
    }
    const payload = marker.slice(LINEAGE_MARKER.length).trim();
    if (payload === '') {
        fail('finding lineage marker line carries no lineage record');
    }
    const lineage = readLineage(parseMarkerPayload(payload, 'finding lineage'));
    assertLineageShape(lineage);
    return lineage;
}

/** The index of the `"` closing the JSON string literal that opens at `start`. */
function endOfJsonString(text: string, start: number): number {
    let index = start + 1;
    while (index < text.length && text.charAt(index) !== '"') {
        index += text.charAt(index) === '\\' ? 2 : 1;
    }
    return index;
}

/** JSON's four whitespace characters: space, tab, line feed, carriage return. */
function isJsonWhitespace(char: string): boolean {
    return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

/** The index of the next non-whitespace character at or after `start`, or `text.length`. */
function skipJsonWhitespace(text: string, start: number): number {
    let index = start;
    while (index < text.length && isJsonWhitespace(text.charAt(index))) {
        index += 1;
    }
    return index;
}

/**
 * The first member key `text` repeats within one object, or `undefined`. `JSON.parse` collapses a
 * repeated member to its last value before any key check can see it, so the raw bytes are scanned
 * here: a string followed by `:` is a member key, and the object nesting is tracked so only a repeat
 * within that same object counts. A key name repeated across entries, which is ordinary JSON, is not
 * a repetition. Called only on text `JSON.parse` already accepted, so the structure is well formed.
 */
function repeatedMemberKey(text: string): string | undefined {
    const objectKeys: Set<string>[] = [];
    let index = 0;
    while (index < text.length) {
        const char = text.charAt(index);
        if (char === '{') {
            objectKeys.push(new Set());
            index += 1;
            continue;
        }
        if (char === '}') {
            objectKeys.pop();
            index += 1;
            continue;
        }
        if (char === '[' || char === ']') {
            index += 1;
            continue;
        }
        if (char !== '"') {
            index += 1;
            continue;
        }
        const start = index;
        const end = endOfJsonString(text, start);
        index = end + 1;
        if (text.charAt(skipJsonWhitespace(text, index)) !== ':') {
            continue;
        }
        const key: unknown = JSON.parse(text.slice(start, end + 1));
        const keys = objectKeys.at(-1);
        if (keys === undefined || typeof key !== 'string') {
            continue;
        }
        if (keys.has(key)) {
            return key;
        }
        keys.add(key);
    }
    return undefined;
}

/** The bare marker payload as a file may carry it, before any marker line is added. */
function parseBareLineage(text: string): FindingLineage {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return fail('finding lineage document is neither a marker body nor a JSON object');
    }
    const repeated = repeatedMemberKey(text);
    if (repeated !== undefined) {
        return fail(
            `finding lineage document repeats the key ${JSON.stringify(repeated)} instead of reading it last-wins`
        );
    }
    const lineage = readLineage(parsed);
    assertLineageShape(lineage);
    return lineage;
}

/**
 * A lineage document as an orchestrator writes it to disk: either the rendered marker body itself or
 * the bare JSON object its marker line would carry. `parseFindingLineage` owns the marker form and
 * keeps its own contract — no marker line is `undefined` — so the bare form is read here instead of
 * widening that function into treating arbitrary prose as a record.
 */
export function parseFindingLineageDocument(text: string): FindingLineage {
    const marked = parseFindingLineage(text);
    if (marked !== undefined) {
        return marked;
    }
    return parseBareLineage(text);
}
