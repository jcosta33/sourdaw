import { afterEach, expect, it, vi } from 'vitest';

import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { installTransactionalIndexedDb } from '#/infra/testing/installTransactionalIndexedDb';
import { createCrdtProject } from '#/modules/CrdtDocument/useCases';
import { projectStore } from '#/modules/Project/stores';

import { AGENT_CONTEXT_RECEIPT_EVIDENCE_MAX_CHARACTERS } from '../../models/AgentContext';
import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';

let indexedDb: ReturnType<typeof installTransactionalIndexedDb> | undefined;
afterEach(async () => {
    await indexedDb?.dispose();
    indexedDb = undefined;
    vi.unstubAllGlobals();
});

it('refuses a real project receipt that cannot fit the local text context before another turn', async () => {
    vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
    indexedDb = installTransactionalIndexedDb();
    await createCrdtProject('Receipt budget');
    const project = projectStore.value!;
    projectStore.set({
        ...project,
        projectId: '405e744b-dead-843a-9395-86fdcd66368c',
        productionBrief: {
            ...project.productionBrief,
            locks: Array.from({ length: 8 }, (_, index) => ({
                id: `lock-${String(index)}`,
                scope: { kind: 'project' as const },
                statement: `Constraint ${String(index)}: ${String(index).repeat(1_200)}`,
                createdAt: index,
            })),
        },
    });
    const requestTurn = vi
        .fn()
        .mockResolvedValueOnce({
            status: 'complete',
            toolCalls: [{ id: 'read-project', name: 'project.query', arguments: { type: 'project-summary' } }],
        })
        .mockResolvedValueOnce({ status: 'rejected', reason: 'Unexpected second turn' });
    const result = await runApplicationOwnedToolLoop({
        loopId: 'receipt-budget',
        requestTurn,
        terminalToolNames: new Set(['command.batch.propose', 'command.batch.decline']),
        textReceiptCharacterBudget: AGENT_CONTEXT_RECEIPT_EVIDENCE_MAX_CHARACTERS,
    });
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('Expected text budget refusal');
    expect(result.receipts).toMatchObject([{ status: 'success' }]);
    expect(result.reason).toBe('Application tool receipts exceeded the bounded text context budget.');
    expect(requestTurn).toHaveBeenCalledTimes(1);
    expect(result.receipts).toHaveLength(1);
    const receipt = result.receipts[0]!;
    expect(receipt).toMatchObject({ callId: 'read-project', toolName: 'project.query', status: 'success' });
    expect(receipt.data).toMatchObject({ items: [{ locks: projectStore.value!.productionBrief.locks }] });
    const bytes = new TextEncoder().encode(JSON.stringify(receipt)).byteLength;
    expect(bytes).toBeGreaterThan(8_192);
    expect(bytes).toBeLessThanOrEqual(16_384);
});
