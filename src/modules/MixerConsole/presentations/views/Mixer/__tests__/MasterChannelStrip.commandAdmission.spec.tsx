import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    captureProjectTransitionAuthority,
    runProjectLoadTransaction,
    setProjectIdentityTransitionDependencies,
} from '#/modules/Project/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';

import { MasterChannelStrip } from '../MasterChannelStrip';

const external = vi.hoisted(() => ({
    promptUser: vi.fn<() => Promise<string | null>>(),
    setMasterGainValue: vi.fn<(value: number) => void>(),
}));

vi.mock('#/utils/Notification/promptUser', () => ({ promptUser: external.promptUser }));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    cancelPendingAudioBufferImport: vi.fn(),
    setMasterGainValue: external.setMasterGainValue,
}));
vi.mock('../MixerLevelReadout', () => ({
    MixerLevelReadout: ({ control }: { control: React.ReactNode }) => <>{control}</>,
}));

async function activateProject(): Promise<void> {
    const transition = runProjectLoadTransaction();
    expect(await transition.prepare()).toBe(true);
    expect(transition.activate()).toBe(true);
}

describe('MasterChannelStrip command admission', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
        transportStore.set({ ...defaultTransportState, masterGain: 80 });
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        await activateProject();
        external.promptUser.mockResolvedValue('0 dB');
    });

    afterEach(() => {
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
    });

    it.each([false, true])(
        'admits the typed entry only while its real Project authority survives the real Command snapshot wait (replace=%s)',
        async (replaceProject) => {
            const enteredWait = Promise.withResolvers<void>();
            const snapshot = Promise.withResolvers<void>();
            configureAutomergeStoragePort({
                getDoc: () => undefined,
                getSemanticMessage: () => undefined,
                hasDoc: () => false,
                mutateDoc: () => undefined,
                waitForSnapshotTransaction: () => {
                    enteredWait.resolve();
                    return snapshot.promise;
                },
            });
            const handler = getTransportHandlers().setMasterGain;
            const execute = vi.fn(handler.execute);
            registerHandlerMap({ setMasterGain: { ...handler, execute } });
            const authority = captureProjectTransitionAuthority();
            render(<MasterChannelStrip widthClass="w-36" />);
            const slider = screen.getByRole('slider', { name: 'Master gain' });

            await act(async () => {
                fireEvent.contextMenu(slider);
            });
            await act(async () => {
                fireEvent.click(screen.getByRole('menuitem', { name: 'Enter Value' }));
                await enteredWait.promise;
            });
            expect(authority.isCurrent()).toBe(true);
            expect(execute).not.toHaveBeenCalled();
            expect(external.setMasterGainValue).toHaveBeenLastCalledWith(1);

            if (replaceProject) {
                await activateProject();
                // Equal gain deliberately defeats an expectedPercent-only guard.
                expect(transportStore.value?.masterGain).toBe(80);
                expect(authority.isCurrent()).toBe(false);
            }
            external.setMasterGainValue.mockClear();
            await act(async () => {
                snapshot.resolve();
                await snapshot.promise;
            });
            await waitFor(() => expect(external.setMasterGainValue).toHaveBeenCalled());

            expect(execute).toHaveBeenCalledTimes(replaceProject ? 0 : 1);
            expect(external.setMasterGainValue).toHaveBeenLastCalledWith(replaceProject ? 0.8 : 1);
            expect(slider).toHaveAttribute('aria-valuenow', replaceProject ? '0.8' : '1');
        }
    );
});
