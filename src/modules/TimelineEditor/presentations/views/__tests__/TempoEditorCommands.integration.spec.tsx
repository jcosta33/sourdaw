import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, normalizeTrack, resolveClipsWithComping } from '#/modules/Arrangement/useCases';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, undoHistoryStore } from '#/modules/Command/stores';
import { clearUndoHistory, registerProductionCommandHandlers, undo } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    getDrumPreviewBranchHandlers,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import {
    defaultTransportState,
    readSecondsAtBeat,
    readTempoAtBeat,
    tempoMapStore,
    transportStore,
} from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { getYeastHandlers } from '#/modules/Yeast/useCases';
import { projectAudioLoopPassSegments } from '#/utils/audioSourceTime';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { TempoEditor } from '../TempoEditor';

function sourceEntry(): number {
    const clip = resolveClipsWithComping('audio', trackStore.value!.tracks[0]!.clips)[0];
    if (!clip) {
        throw new Error('Expected the actual audio programme');
    }
    const segment = projectAudioLoopPassSegments({
        clip,
        loopLengthBeats: clip.loopLength ?? clip.endBeat - clip.startBeat,
        iterationStartBeat: clip.startBeat,
        iterationEndBeat: clip.endBeat,
        stretchRatio: 1,
        tempoAtClipStart: readTempoAtBeat({ beat: clip.startBeat }),
        secondsAtBeat: (beat) => readSecondsAtBeat({ beat }),
    })[0];
    if (!segment) {
        throw new Error('Expected an audible source interval');
    }
    return segment.sourceStartSeconds;
}

describe('visible tempo-map command entry', () => {
    beforeEach(() => {
        Container.clear();
        setNotificationEventBus(
            createEventBus<{ 'ui.notify': NotifyPayload; 'ui.confirm': ConfirmPayload; 'ui.prompt': PromptPayload }>()
        );
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('visible tempo-map command');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        clearUndoHistory();
        sessionStorage.removeItem('sourdaw-undo-session');
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        tempoMapStore.set({ changes: [] });
        takeLaneStore.set({ lanes: [] });
        trackStore.set({
            tracks: [
                normalizeTrack({
                    id: 'audio',
                    name: 'Audio',
                    kind: 'audio',
                    clips: [
                        {
                            id: 'source',
                            trackId: 'audio',
                            name: 'Distinct bursts',
                            type: 'audio',
                            startBeat: 0,
                            endBeat: 12,
                            audioBufferId: 'bursts',
                            audioOffsetBeats: 8,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                            gain: 1,
                            color: '',
                            locked: false,
                            muted: false,
                        },
                    ],
                }),
            ],
            selectedTrackId: 'audio',
            ghostClips: [],
        });
        flushAutomergeStorageWrites();
        registerProductionCommandHandlers([
            getArrangementHandlers(),
            getAudioRenderingHandlers(),
            getAutomationHandlers(),
            getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
            getMidiNoteTransformHandlers(),
            getTransportHandlers(),
            getYeastHandlers(),
        ]);
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        clearUndoHistory();
        clearHandlerRegistry();
        takeLaneStore.set({ lanes: [] });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        tempoMapStore.set({ changes: [] });
        transportStore.set({ ...defaultTransportState });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        Container.clear();
    });

    it('adds, edits and removes visible rows with one command per gesture while retaining the imported phrase', async () => {
        expect(sourceEntry()).toBe(4);
        render(
            <TooltipProvider>
                <TempoEditor />
            </TooltipProvider>
        );
        fireEvent.click(screen.getByRole('button', { name: 'Toggle tempo map' }));
        expect(screen.getByRole('dialog', { name: 'Tempo map editor' })).toBeTruthy();
        fireEvent.change(screen.getByRole('spinbutton', { name: 'New tempo change beat' }), { target: { value: '0' } });
        fireEvent.change(screen.getByRole('spinbutton', { name: 'New tempo change BPM' }), {
            target: { value: '240' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Add tempo change' }));
        await waitFor(() => {
            flushAutomergeStorageWrites();
            expect(getCrdtDoc('root')).toMatchObject({
                tempoMap: { changes: [{ beat: 0, tempo: 240, curve: 'instant' }] },
            });
            expect(screen.getByRole('button', { name: '240 BPM at beat 0. Click to edit.' })).toBeTruthy();
        });
        expect(tempoMapStore.value!.changes).toHaveLength(1);
        await waitFor(() => expect(undoHistoryStore.value?.past).toHaveLength(1));
        expect.soft(undoHistoryStore.value?.past).toHaveLength(1);
        expect.soft(sourceEntry()).toBe(4);
        fireEvent.click(screen.getByRole('button', { name: '240 BPM at beat 0. Click to edit.' }));
        const edit = screen.getByRole('spinbutton', { name: 'Edit tempo at beat 0' });
        fireEvent.change(edit, { target: { value: '180' } });
        fireEvent.keyDown(edit, { key: 'Enter' });
        fireEvent.blur(edit);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: '180 BPM at beat 0. Click to edit.' })).toBeTruthy();
            expect(undoHistoryStore.value?.past).toHaveLength(2);
        });
        expect(sourceEntry()).toBe(4);
        fireEvent.click(screen.getByRole('button', { name: 'Remove tempo change at beat 0' }));
        await waitFor(() => {
            expect(tempoMapStore.value!.changes).toHaveLength(0);
            expect(undoHistoryStore.value?.past).toHaveLength(3);
        });
        expect(sourceEntry()).toBe(4);
        expect((await undo()).headConsumed).toBe(true);
        await waitFor(() =>
            expect(screen.getByRole('button', { name: '180 BPM at beat 0. Click to edit.' })).toBeTruthy()
        );
        expect(sourceEntry()).toBe(4);
    });
});
