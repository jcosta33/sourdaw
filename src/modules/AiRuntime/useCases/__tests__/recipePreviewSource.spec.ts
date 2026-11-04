import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';

import { type RetainedCompilation } from '../../models/RetainedCompilation';
import { type ToolCallResult } from '../../models/ToolCallResult';
import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';
import { executeAnalysisMeasure } from '../executeAnalysisMeasure';
import { executeRecipeExpansion } from '../executeRecipeExpansion';
import { getProjectContext } from '../getProjectContext';
import { parseAnalysisMeasureArguments } from '../parseAnalysisMeasureArguments';

const scope = { kind: 'master' };
const range = { startBeat: 0, endBeat: 8 };

describe('recipe preview source arguments', () => {
    it('accepts an earlier recipe call as the only preview source', () => {
        expect(
            parseAnalysisMeasureArguments({ scope, range, subject: 'preview', recipeCallId: 'expanded-1' })
        ).toMatchObject({ status: 'valid', value: { subject: { kind: 'preview', recipeCallId: 'expanded-1' } } });
    });

    it.each([
        { subject: 'preview' },
        { subject: 'preview', recipeCallId: '' },
        { subject: 'preview', recipeCallId: 'x'.repeat(257) },
        { subject: 'preview', recipeCallId: ['expanded-1'] },
        { subject: 'preview', recipeCallId: null },
        { subject: 'preview', recipeCallId: 'expanded-1', proposal: { schemaVersion: 1, items: [] } },
        { subject: 'project', recipeCallId: 'expanded-1' },
        { recipeCallId: 'expanded-1' },
    ])('refuses absent, malformed or conflicting source: %j', (source) => {
        expect(parseAnalysisMeasureArguments({ scope, range, ...source }).status).toBe('invalid');
    });
});

const revision = 'recipe-revision';
const expand: ToolCallResult = {
    id: 'expand-1',
    name: 'recipe.expand',
    arguments: { recipeId: 'drums-punchy', targetId: 'drums' },
};
const measure: ToolCallResult = {
    id: 'measure-1',
    name: 'analysis.measure',
    arguments: { scope, range, subject: 'preview', recipeCallId: 'expand-1' },
};
const end: ToolCallResult = { id: 'end-1', name: 'answer.respond', arguments: { answer: 'Done', evidenceCallIds: [] } };

beforeEach(() => {
    trackStore.set({
        tracks: [createTrack({ id: 'drums', name: 'Drums', kind: 'audio' })],
        selectedTrackId: null,
        ghostClips: [],
    });
});
afterEach(() => trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] }));

function runTurns(turns: ToolCallResult[][], maxReceiptBytesPerCall?: number) {
    const context = getProjectContext();
    const observed: RetainedCompilation[][] = [];
    const requestTurn = vi.fn();
    for (const toolCalls of [...turns, [end]]) {
        requestTurn.mockResolvedValueOnce({ status: 'complete', toolCalls });
    }
    const loopInput: Parameters<typeof runApplicationOwnedToolLoop>[0] = {
        loopId: 'recipe-source-run',
        terminalToolNames: new Set(['answer.respond']),
        requestTurn,
        recipe: {
            toolName: 'recipe.expand',
            revision,
            execute: (call, ids) => executeRecipeExpansion({ call, ...ids, context, revision }),
        },
        measurement: {
            toolName: 'analysis.measure',
            revision,
            execute: async (call, ids) => {
                observed.push(Array.from(ids.retainedCompilations ?? []));
                // Refuse before rendering when only the retention boundary is under test.
                return executeAnalysisMeasure({
                    call,
                    ...ids,
                    projectRevision: revision,
                    sections: [],
                    preview: {
                        context,
                        prompt: 'make drums punchier',
                        runId: 'source-run',
                        readCreativeAuthority: () => undefined,
                        retainedCompilations: [],
                    },
                });
            },
        },
    };
    if (maxReceiptBytesPerCall !== undefined) {
        loopInput.limits = { maxReceiptBytesPerCall };
    }
    const result = runApplicationOwnedToolLoop(loopInput);
    return { result, observed };
}

describe('prior-turn receipt admission owns recipe availability', () => {
    it('hides a same-turn expansion even though the concurrent read has finished', async () => {
        const { result, observed } = runTurns([[expand, measure]]);
        const completed = await result;
        expect(completed.receipts.find((receipt) => receipt.callId === 'expand-1')?.status).toBe('success');
        expect(observed).toEqual([[]]);
    });

    it('exposes only the earlier successful admitted recipe on a later turn', async () => {
        const { result, observed } = runTurns([[expand], [measure]]);
        await result;
        expect(observed).toMatchObject([
            [{ callId: 'expand-1', kind: 'recipe', revision, commands: expect.any(Array) }],
        ]);
    });

    it('never exposes a failed expansion', async () => {
        const { result, observed } = runTurns([
            [{ ...expand, arguments: { recipeId: 'missing', targetId: 'drums' } }],
            [measure],
        ]);
        const completed = await result;
        expect(completed.receipts.find((receipt) => receipt.callId === 'expand-1')?.status).toBe('failure');
        expect(observed).toEqual([[]]);
    });

    it('never exposes commands whose success receipt exceeded the admission budget', async () => {
        const { result, observed } = runTurns([[expand], [measure]], 1024);
        const completed = await result;
        expect(completed.receipts.find((receipt) => receipt.callId === 'expand-1')?.status).toBe('failure');
        expect(observed).toEqual([[]]);
    });

    it('refuses duplicate tool-call identities before a later measurement can replace retention', async () => {
        const { result } = runTurns([[expand], [{ ...measure, id: 'expand-1' }]]);
        expect(await result).toMatchObject({ status: 'rejected', reason: expect.stringContaining('duplicate') });
    });
});

describe('recipe source lookup before preview creation', () => {
    it.each(['unknown', 'stale', 'transform', 'preview'] as const)(
        'refuses a %s reference without retained commands or figures',
        async (kind) => {
            const context = getProjectContext();
            const expansion = executeRecipeExpansion({
                call: expand,
                callId: 'expand-1',
                turn: 1,
                ordinal: 1,
                context,
                revision,
            });
            if (expansion.commands === null || expansion.recipe === null) {
                throw new Error('Expected recipe fixture expansion');
            }
            const recipe: RetainedCompilation = {
                callId: 'expand-1',
                revision,
                commands: expansion.commands,
                kind: 'recipe',
                recipe: expansion.recipe,
            };
            const wrongPreview: RetainedCompilation = {
                ...recipe,
                kind: 'preview',
                measuredPreview: {
                    scope: { kind: 'master' },
                    range: { ...range, sectionId: null },
                    targets: [],
                    revision,
                    batchContentHash: 'unused',
                },
            };
            let retained: RetainedCompilation[];
            if (kind === 'unknown') {
                retained = [];
            } else if (kind === 'stale') {
                retained = [{ ...recipe, revision: 'old' }];
            } else if (kind === 'transform') {
                retained = [{ ...recipe, kind: 'transform' }];
            } else {
                retained = [wrongPreview];
            }
            const read = await executeAnalysisMeasure({
                call: measure,
                callId: 'measure-1',
                turn: 2,
                projectRevision: revision,
                sections: [],
                preview: {
                    context,
                    prompt: 'make drums punchier',
                    runId: 'source-run',
                    retainedCompilations: retained,
                    readCreativeAuthority: () => undefined,
                },
            });
            expect(read).toMatchObject({
                commands: null,
                measuredPreview: null,
                receipt: { status: 'failure', error: { code: 'preview-proposal-rejected' } },
            });
        }
    );
});
