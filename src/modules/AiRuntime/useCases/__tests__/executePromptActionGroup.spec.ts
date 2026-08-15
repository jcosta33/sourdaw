import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { compilePlannedActionCommandBatch } from '../compilePlannedActionCommandBatch';
import { executePlannedActions } from '../executePlannedActions';
import { executePromptActionGroup } from '../executePromptActionGroup';
import { notifyAiChange } from '../notifyAiChange';

const mocks = vi.hoisted(() => ({
    projectRevision: { value: 'revision-1' },
    compilePlannedActionCommandBatch: vi.fn(() => ({
        commandBatch: { serialized: 'command-batch', authority: { projectId: 'revision-1' } },
        commandEnvelopes: ['command-envelope'],
    })),
    executePlannedActions: vi.fn(),
    notifyAiChange: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    generateGroupId: () => ({ groupId: 'group-1', groupLabel: 'Prompt action' }),
    isExecutableAppActionType: (type: string) => type !== 'removeAllTracks',
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: () => mocks.projectRevision.value,
}));
vi.mock('../compilePlannedActionCommandBatch', () => ({
    compilePlannedActionCommandBatch: mocks.compilePlannedActionCommandBatch,
}));
vi.mock('../describePlannedAction', () => ({
    describePlannedAction: ({ action }: { action: AppAction }) => action.type,
}));
vi.mock('../executePlannedActions', () => ({ executePlannedActions: mocks.executePlannedActions }));
vi.mock('../getProjectContext', () => ({ getProjectContext: () => ({ tracks: [] }) }));
vi.mock('../notifyAiChange', () => ({ notifyAiChange: mocks.notifyAiChange }));

describe('executePromptActionGroup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.projectRevision.value = 'revision-1';
        mocks.executePlannedActions.mockResolvedValue({ status: 'committed', actions: [] });
    });

    it('owns command compilation, approval revalidation, and dispatch outside presentation code', async () => {
        const action = { type: 'togglePlayback' } satisfies AppAction;

        await executePromptActionGroup({ actions: [action], prompt: 'Play', projectRevision: 'revision-1' });

        expect(vi.mocked(compilePlannedActionCommandBatch)).toHaveBeenCalledWith(
            expect.objectContaining({
                actions: [action],
                actionLabels: ['togglePlayback'],
                autoCommit: true,
                projectRevision: 'revision-1',
            })
        );
        const compileInput = vi.mocked(compilePlannedActionCommandBatch).mock.calls[0]?.[0];
        expect(compileInput?.autoCommitApproval?.()).toEqual({ status: 'valid' });
        mocks.projectRevision.value = 'revision-2';
        expect(compileInput?.autoCommitApproval?.()).toEqual({
            status: 'invalid',
            reason: 'The command-palette source revision is stale.',
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
        });

        expect(vi.mocked(compilePlannedActionCommandBatch)).not.toHaveBeenCalled();
        expect(vi.mocked(executePlannedActions)).not.toHaveBeenCalled();
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith(
            'Command not executed: one or more actions are not available through the approved command boundary.',
            []
        );
    });
});
