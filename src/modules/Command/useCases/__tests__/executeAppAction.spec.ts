import { describe, it, expect, vi, beforeEach } from 'vitest';

import { executeAppAction } from '../executeAppAction';

const mocks = vi.hoisted(() => ({
    logger: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        setWriters: vi.fn(),
    },
    setSemanticContext: vi.fn(),
    clearSemanticContext: vi.fn(),
    pushActionHistoryEntry: vi.fn(),
    pushUndo: vi.fn(),
    recordAction: vi.fn(),
    mockHandler: {
        execute: vi.fn(),
        describe: vi.fn(() => ({ label: 'Mock Label' })),
        undoable: true,
    },
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: mocks.logger }));

// Mock the exact file paths to ensure interception
vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    setSemanticContext: mocks.setSemanticContext,
    clearSemanticContext: mocks.clearSemanticContext,
    getDsoSnapshotHandlers: () => ({}),
}));

vi.mock('#/modules/CrdtDocument/stores', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    pushActionHistoryEntry: mocks.pushActionHistoryEntry,
}));

vi.mock('../../stores/undoStore', () => ({
    pushUndo: mocks.pushUndo,
    undoStore: { value: {} },
}));

vi.mock('../macro/recording/recordAction', () => ({ recordAction: mocks.recordAction }));

// Mock all the individual re-exports that executeAppAction might call via its lazy registry
vi.mock('#/modules/Arrangement', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getArrangementHandlers: () => ({ testAction: mocks.mockHandler }),
}));

vi.mock('#/modules/Transport', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getTransportHandlers: () => ({}),
}));

vi.mock('#/modules/Workspace', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getWorkspaceHandlers: () => ({}),
    getScratchPadHandlers: () => ({}),
}));

vi.mock('#/modules/Automation', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getAutomationHandlers: () => ({}),
}));

vi.mock('#/modules/AiGeneration', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getGenerationHandlers: () => ({}),
    getAiMidiHandlers: () => ({}),
}));

vi.mock('#/modules/AudioAnalysis', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getAnalysisHandlers: () => ({}),
}));

vi.mock('#/modules/Collaboration', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getCollaborationHandlers: () => ({}),
}));

vi.mock('#/modules/Plugin', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getPluginHostHandlers: () => ({}),
}));

vi.mock('#/modules/AiRuntime', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getAiOrganizationHandlers: () => ({}),
}));

vi.mock('#/modules/MIDI', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getChordTrackHandlers: () => ({}),
    getMidiRoutingHandlers: () => ({}),
    getPatternInstanceHandlers: () => ({}),
}));

vi.mock('#/modules/Project', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getSongStructureHandlers: () => ({}),
    getVersionControlHandlers: () => ({}),
}));

vi.mock('#/modules/AudioEngine', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getFinalFeatureHandlers: () => ({}),
}));

describe('executeAppAction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('logs error if no handler is found', async () => {
        await executeAppAction({ type: 'unknownAction', payload: {} } as any);
        expect(mocks.logger.error).toHaveBeenCalled();
    });

    it('executes a registered handler', async () => {
        await executeAppAction({ type: 'testAction', payload: { foo: 'bar' } } as any);

        expect(mocks.mockHandler.execute).toHaveBeenCalledWith({ type: 'testAction', payload: { foo: 'bar' } });
        expect(mocks.setSemanticContext).toHaveBeenCalledWith(expect.objectContaining({ message: 'Mock Label' }));
        expect(mocks.pushUndo).toHaveBeenCalled();
        expect(mocks.pushActionHistoryEntry).toHaveBeenCalled();
    });
});
