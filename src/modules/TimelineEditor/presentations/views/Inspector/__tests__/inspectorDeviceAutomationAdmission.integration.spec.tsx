import * as Automerge from '@automerge/automerge';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { createMockAudioContext } from '#/helpers/__tests__/audioContext.mock';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { useStore } from '#/infra/store/useStore';
import { defaultTrackState, markerStore, type Track, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getAutomationParameterRange, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { audioEngine, initEngineDeviceCollaborators } from '#/modules/AudioEngine/useCases';
import { automationStore, type AutomationStoreState } from '#/modules/Automation/stores';
import { setAutomationParameterRangeResolver } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore, undoHistoryStore } from '#/modules/Command/stores';
import * as commandUseCases from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import {
    captureProjectTransitionAuthority,
    runProjectLoadTransaction,
    setProjectIdentityTransitionDependencies,
} from '#/modules/Project/useCases';

import { TrackAutomationSection } from '../TrackAutomationSection';

const TRACK_ID = 'guitar';
const DEVICE_ID = 'distortion-1';
const TARGET_ID = 'distortion-1:dist-drive';

function Inspector() {
    const state = useStore(trackStore, defaultTrackState);
    const track = state.tracks.find(({ id }) => id === TRACK_ID);
    if (!track) {
        throw new Error('Missing automation track');
    }
    return <TrackAutomationSection track={track} />;
}

function readRoot() {
    flushAutomergeStorageWrites();
    const root = getCrdtDoc<{ tracks: { tracks: Track[] }; automation: AutomationStoreState }>('root');
    if (!root) {
        throw new Error('Missing project document');
    }
    return { root: Automerge.toJS(root), heads: Automerge.getHeads(root) };
}

describe('Inspector device automation target admission', () => {
    const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');

    beforeEach(async () => {
        Object.assign(audioEngine.context, createMockAudioContext());
        initEngineDeviceCollaborators();
        setAutomationParameterRangeResolver(getAutomationParameterRange);
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
            configurable: true,
            value: vi.fn(),
        });
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Inspector device automation target admission');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        commandUseCases.registerProductionCommandHandlers(
            getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true })
        );
        commandUseCases.clearUndoHistory();
        commandUseCases.resetActionReplayAuthority();
        commandUseCases.setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        const transition = runProjectLoadTransaction();
        expect(await transition.prepare()).toBe(true);
        expect(transition.activate()).toBe(true);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        automationStore.set({ lanes: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        markerStore.set({ markers: [], sections: [] });
        setTrackStoreState({
            ...defaultTrackState,
            selectedTrackId: TRACK_ID,
            tracks: [
                {
                    ...createTrack({ id: TRACK_ID, name: 'Guitar', kind: 'audio' }),
                    devices: [
                        {
                            id: DEVICE_ID,
                            name: 'Distortion',
                            type: 'builtin-distortion',
                            bypassed: false,
                            parameterValues: { 'dist-drive': 20 },
                        },
                    ],
                },
            ],
        });
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        audioEngine.setUseCaseDeviceCollaborators(null);
        commandUseCases.clearUndoHistory();
        commandUseCases.resetActionReplayAuthority();
        clearHandlerRegistry();
        setTrackStoreState(structuredClone(defaultTrackState));
        automationStore.set({ lanes: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        if (scrollIntoView) {
            Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoView);
        } else {
            Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
        }
    });

    function queueDeviceDriveEdit() {
        const authority = captureProjectTransitionAuthority();
        const initial = readRoot();
        expect(initial.root.tracks.tracks[0]?.devices.map(({ id }) => id)).toEqual([DEVICE_ID]);
        expect(initial.root.automation.lanes).toEqual([]);
        expect(undoHistoryStore.value?.past).toEqual([]);

        const release = Promise.withResolvers<void>();
        const finished = Promise.withResolvers<void>();
        const realDispatch = commandUseCases.executeUserAppAction;
        const dispatch = vi
            .spyOn(commandUseCases, 'executeUserAppAction')
            .mockImplementationOnce(async (action, options) => {
                await release.promise;
                try {
                    await realDispatch(action, options);
                } finally {
                    finished.resolve();
                }
            });

        render(<Inspector />);
        fireEvent.click(screen.getByRole('button', { name: 'Add automation lane' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Drive' }));
        expect(dispatch).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                type: 'addAutomationLane',
                payload: expect.objectContaining({ trackId: TRACK_ID, parameterId: TARGET_ID }),
            }),
            expect.any(Object)
        );
        expect(readRoot().heads).toEqual(initial.heads);

        return {
            authority,
            async finish() {
                await act(async () => {
                    release.resolve();
                    await finished.promise;
                });
            },
        };
    }

    it('adds the queued Device Drive lane while the target is retained', async () => {
        const edit = queueDeviceDriveEdit();
        expect(edit.authority.isCurrent()).toBe(true);
        await edit.finish();

        const after = readRoot();
        expect(after.root.automation.lanes.map(({ parameterId }) => parameterId)).toEqual([TARGET_ID]);
        expect(automationStore.value).toEqual(after.root.automation);
        expect(undoHistoryStore.value?.past.at(-1)).toMatchObject({
            action: { type: 'addAutomationLane', payload: { parameterId: TARGET_ID } },
        });
        expect(screen.getByText('Distortion: Drive')).toBeVisible();
    });

    it('rejects the queued Device Drive lane after removing the target', async () => {
        const edit = queueDeviceDriveEdit();
        await act(() => commandUseCases.executeAppAction({ type: 'removeDevice', payload: { deviceId: DEVICE_ID } }));
        expect(readRoot().root.tracks.tracks[0]?.devices).toEqual([]);
        expect(trackStore.value?.tracks[0]?.devices).toEqual([]);
        expect(undoHistoryStore.value?.past.at(-1)).toMatchObject({
            action: { type: 'removeDevice', payload: { deviceId: DEVICE_ID } },
        });

        expect(edit.authority.isCurrent()).toBe(true);
        const before = readRoot();
        const historyBefore = structuredClone(undoHistoryStore.value);
        await edit.finish();

        const after = readRoot();
        expect.soft(after.root.automation.lanes.map(({ parameterId }) => parameterId)).toEqual([]);
        expect.soft(automationStore.value?.lanes.map(({ parameterId }) => parameterId)).toEqual([]);
        expect
            .soft(
                undoHistoryStore.value?.past.map((entry) => (entry.kind === 'action' ? entry.action.type : entry.kind))
            )
            .toEqual(['removeDevice']);
        expect.soft(undoHistoryStore.value).toEqual(historyBefore);
        expect.soft(after.heads).toEqual(before.heads);
        expect.soft(screen.queryByText('Distortion: Drive')).not.toBeInTheDocument();
        expect.soft(screen.queryByRole('alert')).toHaveTextContent('Could not add Distortion: Drive');
    });
});
