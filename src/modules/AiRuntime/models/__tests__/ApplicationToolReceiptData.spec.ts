import { describe, expect, it } from 'vitest';

import { type ApplicationToolReceipt } from '../ApplicationOwnedTool';
import { classifyApplicationToolReceiptData } from '../ApplicationToolReceiptData';

function receipt(status: ApplicationToolReceipt['status'], data: unknown): ApplicationToolReceipt {
    return {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId: 'read-onsets',
        toolName: 'analysis.detectTransients',
        turn: 1,
        status,
        revision: status === 'success' ? 'a'.repeat(64) : null,
        data,
        summary: 'Read source onsets.',
        warnings: [],
        error:
            status === 'success'
                ? null
                : {
                      code: 'cancelled',
                      safeMessage: 'Cancelled.',
                      retryable: false,
                  },
    };
}

describe('transient onset receipt data policy', () => {
    it('classifies successful numeric onset evidence as measurement', () => {
        expect(
            classifyApplicationToolReceiptData(
                receipt('success', {
                    kind: 'transient-onset-read',
                    timeAxis: 'source-buffer',
                    hits: [{ sampleOffset: 512, sourceSeconds: 512 / 48_000, confidence: 0.8 }],
                })
            )
        ).toEqual(['measurement']);
    });

    it('does not add measurement classification for failed or unrelated receipts', () => {
        expect(classifyApplicationToolReceiptData(receipt('failure', { kind: 'transient-onset-read' }))).toEqual([]);
        expect(classifyApplicationToolReceiptData(receipt('success', { kind: 'project-query' }))).toEqual([]);
    });
});
