import { readFileSync } from 'node:fs';

import { canonicalJson, parseMarkerPayload } from './canonicalRecord.ts';
import { assertPublicationSafeEvidence } from './evidenceSafety.ts';
import { fail } from './prContract.ts';

const MARKER = 'sourdaw-retirement-v1';
const SHA = /^[0-9a-f]{40}$/u;
const DECIMAL = /^[1-9][0-9]*$/u;
const MAX_FINDINGS = 100;
const MAX_EVIDENCE = 8;

export type RetirementRecord = {
    format: 'retirement-v1';
    pr: number;
    head: string;
    base: string;
    rationale: string;
    evidence: { url: string; observation: string }[];
    findings: {
        rootCommentId: string;
        threadId: string;
        authorRepairCommentId: string;
        reviewerConfirmationCommentId: string;
    }[];
    reviewBodies: { reviewId: string; rootCommentIds: string[] }[];
};

function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        fail(`${label} must be an object`);
    }
    const entries = Object.keys(value).sort();
    if (entries.join(',') !== [...keys].sort().join(',')) {
        fail(`${label} has missing or unexpected fields`);
    }
    return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
    if (typeof value !== 'string') {
        fail(`${label} must be text`);
    }
    assertPublicationSafeEvidence(label, [value]);
    return value;
}

function id(value: unknown, label: string): string {
    if (typeof value !== 'string' || !DECIMAL.test(value)) {
        fail(`${label} must be a decimal ID`);
    }
    return value;
}

function nodeId(value: unknown, label: string): string {
    const result = text(value, label);
    if (!/^[A-Za-z0-9_=-]{3,128}$/u.test(result)) {
        fail(`${label} must be a node ID`);
    }
    return result;
}

function array(value: unknown, label: string, max: number): unknown[] {
    if (!Array.isArray(value) || value.length > max) {
        fail(`${label} must be an array of at most ${max}`);
    }
    return value;
}

export function assertRetirementRecord(value: unknown): asserts value is RetirementRecord {
    const root = object(
        value,
        ['format', 'pr', 'head', 'base', 'rationale', 'evidence', 'findings', 'reviewBodies'],
        'retirement'
    );
    if (root.format !== 'retirement-v1') {
        fail('retirement format must be retirement-v1');
    }
    if (typeof root.pr !== 'number' || !Number.isSafeInteger(root.pr) || root.pr < 1) {
        fail('retirement pr is invalid');
    }
    if (typeof root.head !== 'string' || !SHA.test(root.head)) {
        fail('retirement head must be a lower-case SHA');
    }
    text(root.base, 'retirement base');
    text(root.rationale, 'retirement rationale');
    if (typeof root.base !== 'string' || root.base.length > 128) {
        fail('retirement base is too long');
    }
    const evidence = array(root.evidence, 'retirement evidence', MAX_EVIDENCE);
    if (evidence.length === 0) {
        fail('retirement evidence is required');
    }
    for (const item of evidence) {
        const entry = object(item, ['url', 'observation'], 'retirement evidence entry');
        const url = text(entry.url, 'retirement evidence URL');
        text(entry.observation, 'retirement evidence observation');
        if (!url.startsWith('https://github.com/jcosta33/sourdaw/')) {
            fail('retirement evidence URL must name this repository');
        }
    }
    const findings = array(root.findings, 'retirement findings', MAX_FINDINGS);
    const roots = new Set<string>();
    const threads = new Set<string>();
    for (const item of findings) {
        const entry = object(
            item,
            ['rootCommentId', 'threadId', 'authorRepairCommentId', 'reviewerConfirmationCommentId'],
            'retirement finding'
        );
        const rootId = id(entry.rootCommentId, 'retirement finding root');
        const thread = nodeId(entry.threadId, 'retirement finding thread');
        id(entry.authorRepairCommentId, 'retirement author repair');
        id(entry.reviewerConfirmationCommentId, 'retirement reviewer confirmation');
        if (roots.has(rootId) || threads.has(thread)) {
            fail('retirement findings repeat a root or thread');
        }
        roots.add(rootId);
        threads.add(thread);
    }
    const bodies = array(root.reviewBodies, 'retirement review bodies', MAX_FINDINGS);
    const reviews = new Set<string>();
    for (const item of bodies) {
        const entry = object(item, ['reviewId', 'rootCommentIds'], 'retirement review body');
        const reviewId = nodeId(entry.reviewId, 'retirement review ID');
        if (reviews.has(reviewId)) {
            fail('retirement review body repeats a review');
        }
        reviews.add(reviewId);
        const ids = array(entry.rootCommentIds, 'retirement review roots', MAX_FINDINGS);
        if (ids.length === 0) {
            fail('retirement requested review must map at least one root');
        }
        const unique = new Set(ids.map((item) => id(item, 'retirement review root')));
        if (unique.size !== ids.length || [...unique].some((item) => !roots.has(item))) {
            fail('retirement review roots must be unique covered findings');
        }
    }
}

export function parseRetirementRecord(source: string): RetirementRecord {
    const line = source.trim().startsWith(MARKER) ? source.trim().slice(MARKER.length).trim() : source.trim();
    const value = parseMarkerPayload(line, 'retirement');
    assertRetirementRecord(value);
    return value;
}

export function readRetirementRecordFile(path: string): RetirementRecord {
    let source: string;
    try {
        source = readFileSync(path, 'utf8');
    } catch (error) {
        return fail(`cannot read retirement record ${path}: ${String(error)}`);
    }
    return parseRetirementRecord(source);
}

export function renderRetirementMarker(record: RetirementRecord): string {
    assertRetirementRecord(record);
    return `${MARKER} ${canonicalJson(record)}`;
}
