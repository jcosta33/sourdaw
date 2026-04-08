import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import {
    executeSetWorkspaceMode,
    executeRemoveAutomationPoint,
    executeImportMidiFile,
} from './workspaceHandlers';

describe('workspaceHandlers injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('executeSetWorkspaceMode forwards mode', () => {
        const setWorkspaceMode = vi.fn();
        injectDependencies(executeSetWorkspaceMode, { setWorkspaceMode });

        executeSetWorkspaceMode({ type: 'setWorkspaceMode', payload: { mode: 'arrange' } });

        expect(setWorkspaceMode).toHaveBeenCalledWith('arrange');
    });

    it('executeRemoveAutomationPoint removes by lane and point index', () => {
        const removeAutomationPoint = vi.fn();
        const getAutomationStoreState = vi.fn(() => ({
            lanes: [
                {
                    id: 'lane-1',
                    points: [{ beat: 4, value: 0.5, curve: 'linear' as const, tension: 0 }],
                },
            ],
        }));
        injectDependencies(executeRemoveAutomationPoint, { getAutomationStoreState, removeAutomationPoint });

        executeRemoveAutomationPoint({
            type: 'removeAutomationPoint',
            payload: { laneId: 'lane-1', pointIndex: 0 },
        });

        expect(removeAutomationPoint).toHaveBeenCalledWith('lane-1', 4);
    });

    it('executeImportMidiFile notifies on file dialog failure', async () => {
        const pickFiles = vi.fn(() => Promise.reject(new Error('dialog')));
        const importMidiFile = vi.fn();
        const notifyUser = vi.fn();
        injectDependencies(executeImportMidiFile, { pickFiles, importMidiFile, notifyUser });

        executeImportMidiFile();

        await vi.waitFor(() => {
            expect(notifyUser).toHaveBeenCalledWith('Failed to open file dialog', 'error');
        });
    });
});
