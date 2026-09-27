import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { type Clip, defaultTrackState, markerStore, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, setArrangementEventBus, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
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
import { type AppAction } from '#/utils/handlerContract';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { getProjectContext } from '../../../useCases/getProjectContext';
import { bridgeLlmToolCalls } from '../../llmActionBridge';
import { type ToolCallResult } from '../../toolCallParser';

/**
 * The AI's clip placement calls must not land a clip where the timeline's own
 * drop rule (`isClipDropCompatible`) forbids it: a bus, the master, a folder, or
 * a track of the other kind. Such a clip is never scheduled — a bus or master
 * sums rather than plays, a folder renders no content, and a MIDI clip on an
 * audio track has no instrument — so the move silently mutes the material.
 *
 * Everything past the provider is real: the bridge the AI calls with the real
 * project context, then the real `executeAppAction` over the production handler
 * maps against a real Automerge document. Refusal at any layer satisfies the
 * contract; the only failure is the clip arriving on the incompatible track.
 */

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

function clip(id: string, trackId: string, type: Clip['type']): Clip {
    return {
        id,
        trackId,
        name: id,
        startBeat: 0,
        endBeat: 4,
        type,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
    };
}

function trackIdHoldingClip(clipId: string): string | undefined {
    return trackStore.value?.tracks.find((track) => track.clips.some((candidate) => candidate.id === clipId))?.id;
}

function clipCountOn(trackId: string): number {
    return trackStore.value?.tracks.find((track) => track.id === trackId)?.clips.length ?? 0;
}

async function runAiCall(call: ToolCallResult): Promise<void> {
    const bridged = bridgeLlmToolCalls({ calls: [call], context: getProjectContext(), projectPunchRegion: () => null });
    for (const action of bridged.actions) {
        await executeAppAction(action as AppAction).catch(() => undefined);
    }
}

describe('AI clip placement refuses destinations the timeline forbids', () => {
    beforeEach(() => {
        Container.clear();
        setNotificationEventBus(createEventBus<NotificationEvents>());
        setArrangementEventBus(createEventBus<ArrangementTrackEvents>());
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('ai clip placement destination');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        automationStore.set({ lanes: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        markerStore.set({ markers: [], sections: [] });

        const keys = createTrack({ id: 't-keys', name: 'Keys', kind: 'midi', withoutDefaultDevice: true });
        const pads = createTrack({ id: 't-pads', name: 'Pads', kind: 'midi', withoutDefaultDevice: true });
        const vocal = createTrack({ id: 't-vocal', name: 'Vocal', kind: 'audio' });
        setTrackStoreState({
            ...defaultTrackState,
            tracks: [
                { ...keys, clips: [clip('c-keys', 't-keys', 'midi')] },
                pads,
                { ...vocal, clips: [clip('c-vocal', 't-vocal', 'audio')] },
                createTrack({ id: 't-bus', name: 'Drum Bus', kind: 'bus' }),
                createTrack({ id: 't-folder', name: 'Strings Folder', kind: 'folder' }),
                createTrack({ name: 'Master', kind: 'master' }),
            ],
            selectedTrackId: 't-keys',
        });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        setTrackStoreState(structuredClone(defaultTrackState));
        markerStore.set({ markers: [], sections: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        Container.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('control: moves a MIDI clip onto another MIDI track', async () => {
        await runAiCall({ name: 'moveClip', arguments: { clipId: 'c-keys', trackId: 't-pads', startBeat: 8 } });

        expect(trackIdHoldingClip('c-keys')).toBe('t-pads');
    });

    it('moveClip does not land a MIDI clip on a bus', async () => {
        await runAiCall({ name: 'moveClip', arguments: { clipId: 'c-keys', trackId: 't-bus', startBeat: 8 } });

        expect(trackIdHoldingClip('c-keys')).toBe('t-keys');
    });

    it('moveClip does not land a MIDI clip on an audio track', async () => {
        await runAiCall({ name: 'moveClip', arguments: { clipId: 'c-keys', trackId: 't-vocal', startBeat: 8 } });

        expect(trackIdHoldingClip('c-keys')).toBe('t-keys');
    });

    it('duplicateClipAt does not copy an audio clip onto a folder', async () => {
        await runAiCall({
            name: 'duplicateClipAt',
            arguments: { clipId: 'c-vocal', destinationTrackId: 't-folder', startBeat: 16 },
        });

        expect(clipCountOn('t-folder')).toBe(0);
    });

    it('moveClips does not land an audio clip on the master track', async () => {
        await runAiCall({
            name: 'moveClips',
            arguments: { moves: [{ clipId: 'c-vocal', trackId: 'master', startBeat: 4 }] },
        });

        expect(trackIdHoldingClip('c-vocal')).toBe('t-vocal');
    });
});
