import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { captureCommandBatchPreflightState } from '#/app/captureCommandBatchPreflightState';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Clip, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, runtimeGraphTopology, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import {
    configureRuntimeGraphProjectRevisionValidator,
    configureRuntimeGraphTopologyValidator,
} from '#/modules/AudioEngine/useCases';
import { configureCollaborationAssetOwner } from '#/modules/Collaboration/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    commandBatchPreflightPort,
    compileVersionedCommandBatchEnvelope,
    migrateLegacyAppActionToVersionedCommandEnvelope,
    resetActionReplayAuthority,
    serializeVersionedCommandEnvelope,
    setActionHistoryMetadataPort,
} from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { type MidiClipNoteSnapshot } from '#/utils/handlerContract';

import { type ExecutableRuntimeAction } from '../../models/ExecutableRuntimeAction';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    proposePendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { compileAgentRiskApproval } from '../compileAgentRiskApproval';
import { confirmPendingChatActions } from '../confirmPendingChatActions';

const fixtureStorageOwners = vi.hoisted(() => new Map<string, { flushPendingUnscopedWrite(): void }>());

vi.mock('#/infra/store/storage/createAutomergeStorage', async (importOriginal) => {
    const original = await importOriginal<typeof import('#/infra/store/storage/createAutomergeStorage')>();
    return {
        ...original,
        createAutomergeStorage: (...args: Parameters<typeof original.createAutomergeStorage>) => {
            const storage = original.createAutomergeStorage(...args);
            fixtureStorageOwners.set(`${args[0]}:${args[1]}`, storage);
            return storage;
        },
    };
});

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const LEAD_NOTES: MidiClipNoteSnapshot[] = [
    { id: 'lead-root', pitch: 60, startBeat: 0, duration: 2, velocity: 100, channel: 0 },
    { id: 'lead-third', pitch: 64, startBeat: 0, duration: 2, velocity: 92, channel: 0 },
];

const ADDED_LEAD_NOTES: MidiClipNoteSnapshot[] = [
    { id: 'lead-arp-offbeat', pitch: 67, startBeat: 0.5, duration: 0.5, velocity: 88, channel: 0 },
];

const PAD_NOTES: MidiClipNoteSnapshot[] = [
    { id: 'pad-root', pitch: 48, startBeat: 0, duration: 4, velocity: 70, channel: 0 },
];

const ADDED_PAD_NOTES: MidiClipNoteSnapshot[] = [
    { id: 'pad-arp-offbeat', pitch: 55, startBeat: 0.5, duration: 0.5, velocity: 66, channel: 0 },
];

const COLLABORATOR_PAD_NOTES: MidiClipNoteSnapshot[] = [
    ...PAD_NOTES,
    { id: 'pad-collaborator', pitch: 52, startBeat: 2, duration: 1, velocity: 64, channel: 0 },
];

function createClip(id: string, trackId: string, name: string): Clip {
    return {
        id,
        trackId,
        name,
        startBeat: 0,
        endBeat: 4,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
    };
}

function createTrack(id: string, name: string, clipId: string): Track {
    return {
        id,
        name,
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ffffff',
        clips: [createClip(clipId, id, `${name} Phrase`)],
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 72,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: '',
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

function flushFixtureProjectWrites(): void {
    for (const slot of ['tracks', 'midi']) {
        const storage = fixtureStorageOwners.get(`root:${slot}`);
        if (!storage) {
            throw new Error(`Expected fixture-owned ${slot} storage adapter`);
        }
        storage.flushPendingUnscopedWrite();
    }
}

function arpeggiateAction(input: {
    addedNotes: MidiClipNoteSnapshot[];
    clipId: string;
    expectedNotes: MidiClipNoteSnapshot[];
    trackId: string;
    trackName: string;
}): ExecutableRuntimeAction {
    return {
        type: 'arpeggiate',
        payload: {
            clipId: input.clipId,
            expectedTrackId: input.trackId,
            trackName: input.trackName,
            expectedTrackFrozen: false,
            clipName: `${input.trackName} Phrase`,
            expectedClipLocked: false,
            expectedNotes: input.expectedNotes,
            addedNotes: input.addedNotes,
        },
    };
}

function propose(input: { actions: ExecutableRuntimeAction[]; id: string; protectedTrackId: string }): void {
    const projectRevision = captureProjectRevision();
    const commandBatch = compileVersionedCommandBatchEnvelope({
        runId: input.id,
        batchId: input.id,
        projectId: projectRevision,
        baseRevision: projectRevision,
        intent: 'add a syncopated arpeggio without touching the protected track',
        protectedTargetIds: [input.protectedTrackId],
        commands: input.actions.map((action) =>
            serializeVersionedCommandEnvelope(
                migrateLegacyAppActionToVersionedCommandEnvelope({
                    action,
                    expectedEffect: action.type,
                    normalizedProjectRevision: projectRevision,
                    options: { groupId: input.id, groupLabel: 'Arpeggiate', source: 'prompt' },
                })
            )
        ),
    });
    proposePendingActionConfirmation({
        id: input.id,
        prompt: 'add a syncopated arpeggio',
        assistantMessageId: 'assistant-1',
        actions: input.actions,
        actionLabels: input.actions.map((action) => action.type),
        commandBatch,
        agentApproval: compileAgentRiskApproval({ commandBatch }),
        protectedUnchanged: [{ id: input.protectedTrackId, name: 'Pad' }],
        executionMode: 'atomic',
        projectRevision,
    });
}

/**
 * A remote patch that reaches the live projection after the batch captured its
 * baseline, and that the batch's own staged document therefore never sees.
 */
function landCollaboratorPadNoteBeforePostcondition(): void {
    let landed = false;
    commandBatchPreflightPort.setProvider((input) => {
        if (input.projectDocument && !landed) {
            landed = true;
            const state = midiStore.value;
            if (!state) {
                throw new Error('Expected MIDI state for the collaborator note');
            }
            midiStore.set({
                ...state,
                notesByClipId: { ...state.notesByClipId, 'clip-pad': COLLABORATOR_PAD_NOTES },
            });
        }
        return captureCommandBatchPreflightState(input);
    });
}

describe('protected target authority under collaborator drift', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('protected target collaborator drift test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        commandBatchPreflightPort.setProvider(captureCommandBatchPreflightState);
        configureCollaborationAssetOwner({ captureOwnerId: () => 'project:protected-target-collaborator-drift' });
        configureRuntimeGraphProjectRevisionValidator(
            (expectedProjectRevision) => captureProjectRevision() === expectedProjectRevision
        );
        configureRuntimeGraphTopologyValidator(runtimeGraphTopology.matchesCurrentProject);
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getMidiNoteTransformHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        clearAiHistory();
        clearPendingActionConfirmations();
        setArrangementEventBus({ emit: () => Promise.resolve() });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({
            tracks: [createTrack('track-lead', 'Lead', 'clip-lead'), createTrack('track-pad', 'Pad', 'clip-pad')],
            selectedTrackId: 'track-lead',
            ghostClips: [],
        });
        midiStore.set({
            notesByClipId: { 'clip-lead': structuredClone(LEAD_NOTES), 'clip-pad': structuredClone(PAD_NOTES) },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        flushFixtureProjectWrites();
        chatStore.set({
            messages: [{ id: 'assistant-1', role: 'assistant', content: 'Awaiting confirmation', timestamp: 1 }],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        });
    });

    afterEach(() => {
        commandBatchPreflightPort.setProvider(null);
        configureRuntimeGraphProjectRevisionValidator(null);
        configureRuntimeGraphTopologyValidator(null);
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        clearAiHistory();
        clearPendingActionConfirmations();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('commits a batch whose protected track only a collaborator changed', async () => {
        propose({
            actions: [
                arpeggiateAction({
                    addedNotes: ADDED_LEAD_NOTES,
                    clipId: 'clip-lead',
                    expectedNotes: LEAD_NOTES,
                    trackId: 'track-lead',
                    trackName: 'Lead',
                }),
            ],
            id: 'confirmation-untouched-protected-track',
            protectedTrackId: 'track-pad',
        });
        landCollaboratorPadNoteBeforePostcondition();

        await expect(
            confirmPendingChatActions({ confirmationId: 'confirmation-untouched-protected-track' })
        ).resolves.toEqual({ status: 'executed' });

        expect(midiStore.value?.notesByClipId['clip-lead']).toEqual([...LEAD_NOTES, ...ADDED_LEAD_NOTES]);
        // Committing re-projects the stores from this batch's own staged document,
        // so the protected clip carries exactly what the batch left it: nothing.
        expect(midiStore.value?.notesByClipId['clip-pad']).toEqual(PAD_NOTES);
        expect(getPendingActionConfirmation('confirmation-untouched-protected-track')?.status).toBe('executed');
    });

    it('refuses a batch that writes notes into a clip on its own protected track', async () => {
        propose({
            actions: [
                arpeggiateAction({
                    addedNotes: ADDED_PAD_NOTES,
                    clipId: 'clip-pad',
                    expectedNotes: PAD_NOTES,
                    trackId: 'track-pad',
                    trackName: 'Pad',
                }),
            ],
            id: 'confirmation-protected-track-written',
            protectedTrackId: 'track-pad',
        });

        const result = await confirmPendingChatActions({ confirmationId: 'confirmation-protected-track-written' });

        expect(result.status).toBe('failed');
        expect(midiStore.value?.notesByClipId['clip-pad']).toEqual(PAD_NOTES);
        expect(undoStore.value?.past).toEqual([]);
        expect(getPendingActionConfirmation('confirmation-protected-track-written')?.executedActions).toEqual([]);
    });
});
