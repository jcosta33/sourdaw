import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import { TooltipProvider } from '#/components/ui/tooltip';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import * as stores from '#/modules/Arrangement/stores';
import * as arrangement from '#/modules/Arrangement/useCases';
import * as history from '#/modules/Command/stores';
import * as command from '#/modules/Command/useCases';
import * as crdt from '#/modules/CrdtDocument/useCases';

import { MixerPanel } from '../MixerPanel';

const runtime = { arrangement, stores, crdt, command, history };

function tracks() {
    const state = runtime.stores.trackStore.value;
    if (!state) {
        throw new Error('Expected a live mixer track aggregate');
    }
    return state.tracks;
}

function mix() {
    return tracks().map(({ id, gain, pan, muted, soloed }) => ({ id, gain, pan, muted, soloed }));
}

function expectAuthority() {
    act(() => {
        flushAutomergeStorageWrites();
    });
    expect(runtime.crdt.getCrdtDoc('root')?.tracks).toEqual(structuredClone({ tracks: tracks() }));
}

function expectOtherContent() {
    const target = tracks().find((track) => track.id === 'snapshot-a');
    expect(target?.clips).toEqual([
        expect.objectContaining({ id: 'later-clip', name: 'Later content edit', startBeat: 2, endBeat: 5 }),
    ]);
    expect(target?.devices).toEqual([]);
    expect(tracks().find((track) => track.id === 'unmatched')).toMatchObject({
        name: 'Unmatched',
        gain: 0.6,
        pan: 15,
        muted: false,
        soloed: false,
    });
}

describe('mounted mixer snapshot project truth and history', () => {
    beforeEach(() => {
        registerProjectSlotProjections();
        registerDeviceEnginePorts();
        configureAutomergeStoragePort(null);
        runtime.crdt.resetCrdtProjectAuthority('Mixer snapshot integration');
        runtime.crdt.registerCrdtStorageRuntime();
        runtime.history.clearHandlerRegistry();
        runtime.history.registerHandlerMap(runtime.arrangement.getArrangementHandlers());
        runtime.command.clearUndoHistory();
        runtime.command.resetActionReplayAuthority();
        runtime.arrangement.setArrangementEventBus({ emit: () => Promise.resolve() });
        for (const snapshot of runtime.arrangement.getMixerSnapshots()) {
            runtime.arrangement.deleteMixerSnapshot(snapshot.id);
        }
        const first = runtime.arrangement.createTrack({
            id: 'snapshot-a',
            name: 'First',
            kind: 'midi',
            withoutDefaultDevice: true,
        });
        const second = runtime.arrangement.createTrack({
            id: 'snapshot-b',
            name: 'Second',
            kind: 'midi',
            withoutDefaultDevice: true,
        });
        runtime.arrangement.restoreTrackSnapshot({
            tracks: [
                { ...first, gain: 0.25, pan: -30, muted: false, soloed: true },
                { ...second, gain: 0.75, pan: 45, muted: true, soloed: false },
            ],
            selectedTrackId: first.id,
        });
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        cleanup();
        runtime.command.clearUndoHistory();
        runtime.command.resetActionReplayAuthority();
        runtime.history.clearHandlerRegistry();
        for (const snapshot of runtime.arrangement.getMixerSnapshots()) {
            runtime.arrangement.deleteMixerSnapshot(snapshot.id);
        }
        runtime.arrangement.restoreTrackSnapshot({ tracks: [], selectedTrackId: null });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        runtime.crdt.removeCrdtDoc('root');
    });

    it('recalls saved mix through actual callback Undo and Redo while retaining unmatched tracks and later clip edits', async () => {
        render(
            <TooltipProvider>
                <MixerPanel />
            </TooltipProvider>
        );
        const saved = mix();
        fireEvent.click(screen.getByRole('button', { name: 'Save mixer snapshot', exact: true }));
        expect(runtime.arrangement.getMixerSnapshots()).toHaveLength(1);

        await act(async () => {
            const unmatched = runtime.arrangement.createTrack({
                id: 'unmatched',
                name: 'Unmatched',
                kind: 'midi',
                withoutDefaultDevice: true,
            });
            runtime.arrangement.restoreTrackSnapshot({
                tracks: [
                    { ...tracks()[0]!, gain: 0.8, pan: 70, muted: true, soloed: false },
                    { ...tracks()[1]!, gain: 0.1, pan: -20, muted: false, soloed: true },
                    { ...unmatched, gain: 0.6, pan: 15 },
                ],
                selectedTrackId: 'snapshot-a',
            });
            await runtime.command.executeAppAction({
                type: 'addClip',
                payload: {
                    id: 'later-clip',
                    trackId: 'snapshot-a',
                    name: 'Before later edit',
                    type: 'midi',
                    startBeat: 2,
                    endBeat: 5,
                },
            });
            runtime.command.clearUndoHistory();
        });
        const beforeRecall = mix();
        expectAuthority();
        fireEvent.click(screen.getByRole('button', { name: 'Recall mixer snapshot', exact: true }));
        fireEvent.click(screen.getByRole('button', { name: 'Snapshot 1', exact: true }));
        expect(screen.queryByRole('button', { name: 'Snapshot 1', exact: true })).not.toBeInTheDocument();
        expect(mix()).toEqual([...saved, beforeRecall[2]]);
        expect(runtime.history.undoHistoryStore.value?.past).toEqual([
            expect.objectContaining({ kind: 'callback', label: 'Recall mixer snapshot' }),
        ]);
        expectAuthority();
        expect(
            within(screen.getByRole('group', { name: 'First channel' })).getByRole('slider', { name: 'First gain' })
        ).toHaveAttribute('aria-valuenow', '0.25');

        await act(async () => {
            await runtime.command.executeAppAction(
                { type: 'renameClip', payload: { clipId: 'later-clip', name: 'Later content edit' } },
                { skipUndo: true }
            );
        });
        expectOtherContent();

        await act(async () => {
            expect((await runtime.command.undo()).headConsumed).toBe(true);
        });
        expect(mix()).toEqual(beforeRecall);
        expect(runtime.history.undoHistoryStore.value?.past).toHaveLength(0);
        expect(runtime.history.undoHistoryStore.value?.future).toHaveLength(1);
        expectOtherContent();
        expectAuthority();
        expect(
            within(screen.getByRole('group', { name: 'First channel' })).getByRole('slider', { name: 'First gain' })
        ).toHaveAttribute('aria-valuenow', '0.8');

        await act(async () => {
            await runtime.command.redo();
        });
        expect(mix()).toEqual([...saved, beforeRecall[2]]);
        expect(runtime.history.undoHistoryStore.value?.past).toHaveLength(1);
        expect(runtime.history.undoHistoryStore.value?.future).toHaveLength(0);
        expectOtherContent();
        expectAuthority();
        expect(
            within(screen.getByRole('group', { name: 'First channel' })).getByRole('slider', { name: 'First gain' })
        ).toHaveAttribute('aria-valuenow', '0.25');
    });
});
