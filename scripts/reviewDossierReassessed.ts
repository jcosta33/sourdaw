/**
 * The `review-reassessed` dossier event (#4584), split out of `reviewDossier.ts` so that module
 * stays under its `max-lines` ceiling. This owns the event's type, key list, and reader; the
 * caller-authors never write it — the reviewer publication appends exactly one when the escalation
 * gate consumes a reassessment.
 */

import { assertPublicationSafeEvidence } from './evidenceSafety.ts';
import { fail } from './prContract.ts';

export type ReviewReassessedDossierEvent = {
    kind: 'review-reassessed';
    roundsObserved: number;
    threshold: number;
    action: 'split' | 'respec' | 'continue';
    reason: string;
};

export const REVIEW_REASSESSED_EVENT_KEYS = ['kind', 'roundsObserved', 'threshold', 'action', 'reason'] as const;

const REASSESSMENT_ACTIONS: ReadonlySet<string> = new Set(['split', 'respec', 'continue']);

function describeValue(value: unknown): string {
    return JSON.stringify(value) ?? typeof value;
}

function readNonNegativeInteger(label: string, value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        fail(`review dossier ${label} must be a non-negative safe integer, found ${describeValue(value)}`);
    }
    return value;
}

function readPositiveInteger(label: string, value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        fail(`review dossier ${label} must be a positive safe integer, found ${describeValue(value)}`);
    }
    return value;
}

function readAction(label: string, value: unknown): ReviewReassessedDossierEvent['action'] {
    if (typeof value !== 'string' || !REASSESSMENT_ACTIONS.has(value)) {
        fail(`review dossier ${label} must be one of split, respec, continue, found ${describeValue(value)}`);
    }
    return value as ReviewReassessedDossierEvent['action'];
}

function readReason(label: string, value: unknown): string {
    if (typeof value !== 'string' || value.trim() === '') {
        fail(`review dossier ${label} must be a non-blank string, found ${describeValue(value)}`);
    }
    assertPublicationSafeEvidence(`review dossier ${label}`, [value]);
    return value;
}

export function readReviewReassessedEvent(
    record: Record<string, unknown>,
    label: string
): ReviewReassessedDossierEvent {
    return {
        kind: 'review-reassessed',
        roundsObserved: readNonNegativeInteger(`${label} roundsObserved`, record.roundsObserved),
        threshold: readPositiveInteger(`${label} threshold`, record.threshold),
        action: readAction(`${label} action`, record.action),
        reason: readReason(`${label} reason`, record.reason),
    };
}
