import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { executePlannedActions } from '../executePlannedActions';
import { executePromptActionGroup } from '../executePromptActionGroup';
import { notifyAiChange } from '../notifyAiChange';

const mocks = vi.hoisted(() => ({
    projectRevision: { value: 'revision-1' },
    executePlannedActions: vi.fn(),
    notifyAiChange: vi.fn(),
    agentRunLifecycle: { transitionPhase: vi.fn() },
    issueApprovalBinding: vi.fn(() => ({ token: 'exact-approval' })),
}));

vi.mock('#/modules/Command/useCases', () => ({
    generateGroupId: () => ({ groupId: 'group-1', groupLabel: 'Prompt action' }),
    isExecutableAppActionType: (type: string) => type !== 'removeAllTracks',
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: () => mocks.projectRevision.value,
}));
vi.mock('../executePlannedActions', () => ({ executePlannedActions: mocks.executePlannedActions }));
vi.mock('../notifyAiChange', () => ({ notifyAiChange: mocks.notifyAiChange }));
vi.mock('../agentRunLifecycle', () => ({ agentRunLifecycle: mocks.agentRunLifecycle }));
vi.mock('../issueAgentCommandApprovalBinding', () => ({
    issueAgentCommandApprovalBinding: mocks.issueApprovalBinding,
}));

describe('executePromptActionGroup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.projectRevision.value = 'revision-1';
        mocks.executePlannedActions.mockResolvedValue({ status: 'committed', actions: [] });
    });

    const admitted = () => ({
        runId: 'prompt-run-1',
        prepared: {
            commandBatch: { serialized: 'command-batch', authority: { projectId: 'revision-1' } } as never,
            agentApproval: null,
            requiresConfirmation: false,
        },
    });

    it('dispatches only an already-admitted command batch outside presentation code', async () => {
        const action = { type: 'togglePlayback' } satisfies AppAction;

        await executePromptActionGroup({
            actions: [action],
            prompt: 'Play',
            projectRevision: 'revision-1',
            ...admitted(),
        });

        expect(vi.mocked(executePlannedActions)).toHaveBeenCalledWith(
            expect.objectContaining({ actions: [action], prompt: 'Play', projectRevision: 'revision-1' })
        );
    });

    it('rejects actions outside the approved command boundary before compilation or dispatch', async () => {
        await executePromptActionGroup({
            actions: [{ type: 'removeAllTracks' }],
            prompt: 'Delete everything',
            projectRevision: 'revision-1',
            ...admitted(),
        });

        expect(vi.mocked(executePlannedActions)).not.toHaveBeenCalled();
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith(
            'Command not executed: one or more actions are not available through the approved command boundary.',
            []
        );
    });

    it('keeps an admitted prompt run non-terminal until execution records its outcome', async () => {
        const action = { type: 'togglePlayback' } satisfies AppAction;

        await executePromptActionGroup({
            actions: [action],
            prompt: 'Play',
            projectRevision: 'revision-1',
            ...admitted(),
        });

        expect(mocks.agentRunLifecycle.transitionPhase).toHaveBeenCalledWith(
            expect.objectContaining({ runId: 'prompt-run-1', phase: 'completed' })
        );
    });

    it('never creates a synthetic execution run while dispatching an admitted run', async () => {
        const action = { type: 'togglePlayback' } satisfies AppAction;

        await executePromptActionGroup({
            actions: [action],
            prompt: 'Play',
            projectRevision: 'revision-1',
            ...admitted(),
        });

        expect(vi.mocked(executePlannedActions)).toHaveBeenCalledWith(
            expect.objectContaining({ runId: 'prompt-run-1' })
        );
    });

    it('binds the exact application-issued approval to the admitted command batch', async () => {
        const action = { type: 'togglePlayback' } satisfies AppAction;
        const approval = { actorId: 'artist-1', fingerprint: 'compiled-risk-fingerprint' } as never;
        const commandBatch = { serialized: 'command-batch', authority: { projectId: 'revision-1' } } as never;

        await executePromptActionGroup({
            actions: [action],
            prompt: 'Play',
            projectRevision: 'revision-1',
            runId: 'prompt-run-1',
            prepared: { commandBatch, agentApproval: approval, requiresConfirmation: true },
        });

        expect(mocks.issueApprovalBinding).toHaveBeenCalledWith({ approval, commandBatch });
        expect(vi.mocked(executePlannedActions)).toHaveBeenCalledWith(
            expect.objectContaining({
                commandBatch: expect.objectContaining({ approvalBinding: { token: 'exact-approval' } }),
            })
        );
    });
});
