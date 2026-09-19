import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { querySemanticProject } from '#/modules/Project/useCases';

import { AUTO_TOOL_CHOICE } from '../../repositories/cloudLlm/cloudInference/hostedToolPlan';
import {
    type ApplicationOwnedToolLoopInterpretationAdmission,
    runApplicationOwnedToolLoop,
} from '../applicationOwnedToolLoop';

vi.mock('#/modules/Project/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/useCases')>()),
    querySemanticProject: vi.fn(),
}));

/**
 * The loop-level directive contract every hosted turn relies on: earlier turns stay free to
 * read, discover, or interpret, while only the final allowed turn — including the extra turn a
 * creative interpretation buys — forces the terminal tool set. A provider reply that still
 * carries no tool call on that forced turn is a refusal, not an implicit no-op.
 */
describe('application-owned tool loop directive forcing', () => {
    beforeEach(() => {
        vi.mocked(querySemanticProject).mockReturnValue({
            schema: 'sourdaw.semantic-project-query',
            schemaVersion: 1,
            projectId: 'project-1',
            projectSchemaVersion: 1,
            revision: { documentIdentityEpoch: 1, mutationEpoch: 1, documents: [] },
            revisionToken: 'revision-1',
            queryType: 'project-summary',
            page: { offset: 0, limit: 20, total: 0 },
            items: [],
            nextCursor: null,
            warnings: [],
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('sends auto on every turn but the final one, and forces the terminal set there', async () => {
        let turn = 0;
        const requestTurn = vi.fn(async (_input: { turn: number; directive: unknown }) => {
            turn += 1;
            if (turn < 4) {
                return {
                    status: 'complete' as const,
                    toolCalls: [
                        { id: `read-${String(turn)}`, name: 'project.query', arguments: { type: 'project-summary' } },
                    ],
                };
            }
            return {
                status: 'complete' as const,
                toolCalls: [{ id: 'final-call', name: 'setTempo', arguments: { bpm: 128 } }],
            };
        });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-directive-final',
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
        });

        expect(result).toMatchObject({ status: 'complete', turns: 4 });
        expect(requestTurn).toHaveBeenCalledTimes(4);
        for (const call of requestTurn.mock.calls.slice(0, 3)) {
            expect((call[0] as { directive: unknown }).directive).toEqual(AUTO_TOOL_CHOICE);
        }
        const finalCall = requestTurn.mock.calls[3]?.[0] as { directive: unknown } | undefined;
        expect(finalCall?.directive).toEqual({
            mode: 'required',
            toolNames: ['setTempo'],
        });
    });

    it('forces the terminal set on the creative-interpretation extra turn too', async () => {
        const admitted: ApplicationOwnedToolLoopInterpretationAdmission = {
            status: 'admitted',
            receipt: { data: { chosen: 'a' }, summary: 'Admitted interpretation A.' },
        };
        let turn = 0;
        const requestTurn = vi.fn(async (_input: { turn: number; directive: unknown }) => {
            turn += 1;
            if (turn === 1) {
                return {
                    status: 'complete' as const,
                    toolCalls: [{ id: 'interpretation-1', name: 'selectCreativeInterpretation', arguments: {} }],
                };
            }
            if (turn < 5) {
                return {
                    status: 'complete' as const,
                    toolCalls: [
                        { id: `read-${String(turn)}`, name: 'project.query', arguments: { type: 'project-summary' } },
                    ],
                };
            }
            return {
                status: 'complete' as const,
                toolCalls: [{ id: 'final-call', name: 'setTempo', arguments: { bpm: 128 } }],
            };
        });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-directive-creative-final',
            terminalToolNames: new Set(['setTempo']),
            interpretation: { toolName: 'selectCreativeInterpretation', admit: () => admitted },
            requestTurn,
        });

        expect(result).toMatchObject({ status: 'complete', turns: 5 });
        expect(requestTurn).toHaveBeenCalledTimes(5);
        const firstCall = requestTurn.mock.calls[0]?.[0] as { directive: unknown } | undefined;
        expect(firstCall?.directive).toEqual(AUTO_TOOL_CHOICE);
        for (const call of requestTurn.mock.calls.slice(1, 4)) {
            expect((call[0] as { directive: unknown }).directive).toEqual(AUTO_TOOL_CHOICE);
        }
        const finalCall = requestTurn.mock.calls[4]?.[0] as { directive: unknown } | undefined;
        expect(finalCall?.directive).toEqual({
            mode: 'required',
            toolNames: ['setTempo'],
        });
    });

    it('rejects a forced final turn whose reply carries no tool call, instead of completing it as a no-op', async () => {
        const requestTurn = vi.fn().mockResolvedValue({ status: 'complete', toolCalls: [] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-directive-empty-final',
            terminalToolNames: new Set(['setTempo']),
            limits: { maxTurns: 1 },
            requestTurn,
        });

        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Provider returned no tool call on the final application tool-loop turn.',
            turns: 1,
        });
        const onlyCall = requestTurn.mock.calls[0]?.[0] as { directive: unknown } | undefined;
        expect(onlyCall?.directive).toEqual({
            mode: 'required',
            toolNames: ['setTempo'],
        });
    });
});
