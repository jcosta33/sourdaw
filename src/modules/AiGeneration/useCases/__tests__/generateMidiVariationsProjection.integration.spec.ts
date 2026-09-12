import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, markerStore, trackStore, type Clip } from '#/modules/Arrangement/stores';
import { createTrack, setArrangementEventBus, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore } from '#/modules/Command/stores';
import {
    executeAppAction,
    registerProductionCommandHandlers,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { projectClipMidiEvents } from '#/modules/MIDI/useCases';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { generateMidiVariations } from '../generateMidiVariations';

// #3764 — generated variations must be rebased to the draft's coordinate
// origin: real stores, real action batches, and the real groove projection.
// Each variation copied the source's midiOffsetBeats (and loop geometry), so a
// source trimmed by 4 beats shifted the generated zero-based material out of
// the draft's audible window, and the prompt labeled unrebased source
// coordinates "relative to clip start".

const mocks = vi.hoisted(() => ({
    generateWebLlmCompletion: vi.fn(),
    resolveBackend: vi.fn(() => 'cloud' as const),
    streamCloudChatCompletion: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AiRuntime/useCases')>()),
    generateWebLlmCompletion: mocks.generateWebLlmCompletion,
    resolveBackend: mocks.resolveBackend,
    streamCloudChatCompletion: mocks.streamCloudChatCompletion,
}));

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

type ArrangementTrackEvents = {
    'track.added': { trackId: string; name: string; kind: string };
    'track.removed': { trackId: string };
    'track.selectionChanged': { trackId: string | null; previousTrackId: string | null };
};

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

type PromptNote = { pitch: number; startBeat: number; duration: number; velocity: number };

function draftClips(sourceName: string): Clip[] {
    return (
        trackStore.value?.tracks
            .flatMap((track) => track.clips)
            .filter((clip) => clip.name.startsWith(`${sourceName} (Var `)) ?? []
    );
}

type ProjectableNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
};

function notesFor(clipId: string): ProjectableNote[] {
    return (midiStore.value?.notesByClipId[clipId] ?? []).map((note) => ({
        id: note.id,
        pitch: note.pitch,
        startBeat: note.startBeat,
        duration: note.duration,
        velocity: note.velocity,
    }));
}

/**
 * The same projection the transport scheduler performs for a clip: notes +
 * geometry (including the clip's own trim offset and loop expansion) in,
 * audible timeline events out.
 */
function projectedEvents(clip: Clip): { startBeat: number; duration: number; pitch: number }[] {
    const loopProjection = projectClipLoopExpansion({
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled: clip.loopEnabled ?? false,
    });
    return projectClipMidiEvents({
        events: notesFor(clip.id),
        clipId: clip.id,
        clipStartBeat: clip.startBeat,
        clipEndBeat: clip.endBeat,
        iterationStartBeat: clip.startBeat,
        loopLengthBeats: loopProjection.loopLengthBeats,
        midiOffsetBeats: clip.midiOffsetBeats ?? 0,
        loopEnabled: clip.loopEnabled ?? false,
    }).map((event) => ({ startBeat: event.startBeat, duration: event.duration, pitch: event.pitch }));
}

async function createSourceClip(clip: Partial<Clip> & { id: string; endBeat: number; name: string }): Promise<void> {
    await executeAppAction({
        type: 'addClip',
        payload: {
            id: clip.id,
            trackId: 't1',
            startBeat: clip.startBeat ?? 0,
            endBeat: clip.endBeat,
            name: clip.name,
            type: 'midi',
            ...(clip.midiOffsetBeats !== undefined ? { midiOffsetBeats: clip.midiOffsetBeats } : {}),
            ...(clip.loopEnabled !== undefined ? { loopEnabled: clip.loopEnabled } : {}),
            ...(clip.loopLength !== undefined ? { loopLength: clip.loopLength } : {}),
        },
    });
}

async function addSourceNotes(clipId: string, notes: ReadonlyArray<PromptNote>): Promise<void> {
    await executeAppAction({ type: 'addNotes', payload: { clipId, notes: [...notes] } });
}

describe('generateMidiVariations rebases drafts to their own origin (#3764)', () => {
    let notifications: NotifyPayload[] = [];
    let unsubscribeFromNotifications: () => void = () => undefined;
    let capturedUserMessages: string[] = [];
    let cannedVariationsJson = '';

    beforeEach(() => {
        Container.clear();
        const notificationEventBus = createEventBus<NotificationEvents>();
        notifications = [];
        unsubscribeFromNotifications = notificationEventBus.on('ui.notify', (notification) => {
            notifications.push(notification);
        });
        setNotificationEventBus(notificationEventBus);
        setArrangementEventBus(createEventBus<ArrangementTrackEvents>());
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('variations projection integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        automationStore.set({ lanes: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        markerStore.set({ markers: [], sections: [] });
        setTrackStoreState({
            ...defaultTrackState,
            tracks: [createTrack({ id: 't1', name: 'Keys', kind: 'midi' })],
            selectedTrackId: 't1',
        });
        capturedUserMessages = [];
        cannedVariationsJson = '';
        mocks.resolveBackend.mockReturnValue('cloud');
        mocks.generateWebLlmCompletion.mockReset();
        mocks.streamCloudChatCompletion.mockReset();
        mocks.streamCloudChatCompletion.mockImplementation(
            (messages: ReadonlyArray<{ content: string }>, onToken: (token: string) => void) => {
                capturedUserMessages.push(messages.at(-1)?.content ?? '');
                onToken(cannedVariationsJson);
                return Promise.resolve({ status: 'complete' });
            }
        );
    });

    afterEach(() => {
        resetActionReplayAuthority();
        clearHandlerRegistry();
        setTrackStoreState({ ...defaultTrackState });
        markerStore.set({ markers: [], sections: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        unsubscribeFromNotifications();
        unsubscribeFromNotifications = () => undefined;
        Container.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('yields audible drafts for a trimmed source and labels prompt coordinates as sent', async () => {
        cannedVariationsJson = JSON.stringify({
            variations: [
                [
                    { pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
                    { pitch: 62, startBeat: 2, duration: 2, velocity: 90 },
                ],
                [{ pitch: 64, startBeat: 1, duration: 2, velocity: 80 }],
                [{ pitch: 67, startBeat: 0, duration: 4, velocity: 70 }],
            ],
        });
        // Visible window [8, 12); material origin 4, so the stored notes
        // 4..6 and 6..8 are the audible phrase.
        await createSourceClip({ id: 'src', startBeat: 8, endBeat: 12, midiOffsetBeats: 4, name: 'Verse' });
        await addSourceNotes('src', [
            { pitch: 60, startBeat: 4, duration: 2, velocity: 100 },
            { pitch: 64, startBeat: 6, duration: 2, velocity: 90 },
        ]);

        await expect(generateMidiVariations('src')).resolves.toBe(3);

        // The prompt receives clip-relative coordinates, exactly as labeled.
        const prompt = capturedUserMessages.at(-1) ?? '';
        expect(prompt).toContain('relative to clip start');
        expect(prompt).toContain('start=0.00');
        expect(prompt).toContain('start=2.00');
        expect(prompt).not.toContain('start=4.00');
        expect(prompt).not.toContain('start=6.00');

        const drafts = draftClips('Verse');
        expect(drafts).toHaveLength(3);
        expect(drafts.map((clip) => clip.startBeat)).toEqual([12, 16, 20]);
        // Drafts are fresh material: no copied trim offset, no copied loop.
        expect(drafts.every((clip) => clip.midiOffsetBeats === undefined)).toBe(true);
        expect(drafts.every((clip) => !clip.loopEnabled)).toBe(true);

        // Every generated note is audible from the draft's visible start.
        const [first, second, third] = drafts;
        if (!first || !second || !third) {
            throw new Error('Expected three variation drafts');
        }
        expect(projectedEvents(first)).toEqual([
            { startBeat: 12, duration: 1, pitch: 60 },
            { startBeat: 14, duration: 2, pitch: 62 },
        ]);
        expect(projectedEvents(second)).toEqual([{ startBeat: 17, duration: 2, pitch: 64 }]);
        expect(projectedEvents(third)).toEqual([{ startBeat: 20, duration: 4, pitch: 67 }]);
    });

    it('yields audible drafts for a looped source whose loop region is what the listener hears', async () => {
        cannedVariationsJson = JSON.stringify({
            variations: [
                [
                    { pitch: 60, startBeat: 0, duration: 2, velocity: 100 },
                    { pitch: 62, startBeat: 4, duration: 2, velocity: 90 },
                    { pitch: 64, startBeat: 6, duration: 2, velocity: 80 },
                ],
                [{ pitch: 67, startBeat: 0, duration: 4, velocity: 70 }],
                [{ pitch: 69, startBeat: 2, duration: 2, velocity: 60 }],
            ],
        });
        // A 4-beat loop over material [2, 6) sounding across the visible
        // [0, 8): the audible phrase is the stored notes 2..4 and 4..6.
        await createSourceClip({
            id: 'src',
            startBeat: 0,
            endBeat: 8,
            midiOffsetBeats: 2,
            loopEnabled: true,
            loopLength: 4,
            name: 'Groove',
        });
        await addSourceNotes('src', [
            { pitch: 60, startBeat: 2, duration: 2, velocity: 100 },
            { pitch: 64, startBeat: 4, duration: 2, velocity: 90 },
        ]);

        await expect(generateMidiVariations('src')).resolves.toBe(3);

        // Only the loop-region notes drive the prompt, rebased to clip start.
        const prompt = capturedUserMessages.at(-1) ?? '';
        expect(prompt).toContain('start=0.00');
        expect(prompt).toContain('start=2.00');
        expect(prompt).not.toContain('start=4.00');

        const drafts = draftClips('Groove');
        expect(drafts).toHaveLength(3);
        expect(drafts.map((clip) => clip.startBeat)).toEqual([8, 16, 24]);
        const [first, second, third] = drafts;
        if (!first || !second || !third) {
            throw new Error('Expected three variation drafts');
        }
        expect(projectedEvents(first)).toEqual([
            { startBeat: 8, duration: 2, pitch: 60 },
            { startBeat: 12, duration: 2, pitch: 62 },
            { startBeat: 14, duration: 2, pitch: 64 },
        ]);
        expect(projectedEvents(second)).toEqual([{ startBeat: 16, duration: 4, pitch: 67 }]);
        expect(projectedEvents(third)).toEqual([{ startBeat: 26, duration: 2, pitch: 69 }]);
    });
});
