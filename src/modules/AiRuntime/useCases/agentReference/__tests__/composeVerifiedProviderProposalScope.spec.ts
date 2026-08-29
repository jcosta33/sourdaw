import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore, type Clip, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { commandTrackDefaultsPort, migrateLegacyAppActionToVersionedCommandEnvelope } from '#/modules/Command/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../../../models/ProjectContext';
import { type ArbitraryCommandListEvidence } from '../../compileArbitraryCommandList';
import { composeVerifiedProviderProposalScope } from '../composeVerifiedProviderProposalScope';

const {
    mockGetApplicationProtectedObjects,
    mockGetBulkDeviceInsertionTrackScope,
    mockGetMutedEmptyTrackDeletionScope,
    mockGetSidechainRoutingPromptScope,
    mockGetSyncopatedArpeggioPromptScope,
} = vi.hoisted(() => ({
    mockGetApplicationProtectedObjects: vi.fn(),
    mockGetBulkDeviceInsertionTrackScope: vi.fn(),
    mockGetMutedEmptyTrackDeletionScope: vi.fn(),
    mockGetSidechainRoutingPromptScope: vi.fn(),
    mockGetSyncopatedArpeggioPromptScope: vi.fn(),
}));

vi.mock('../getApplicationProtectedObjects', () => ({
    getApplicationProtectedObjects: mockGetApplicationProtectedObjects,
}));
vi.mock('../getBulkDeviceInsertionTrackScope', () => ({
    getBulkDeviceInsertionTrackScope: mockGetBulkDeviceInsertionTrackScope,
}));
vi.mock('../getMutedEmptyTrackDeletionScope', () => ({
    getMutedEmptyTrackDeletionScope: mockGetMutedEmptyTrackDeletionScope,
}));
vi.mock('../getSidechainRoutingPromptScope', () => ({
    getSidechainRoutingPromptScope: mockGetSidechainRoutingPromptScope,
}));
vi.mock('../getSyncopatedArpeggioPromptScope', () => ({
    getSyncopatedArpeggioPromptScope: mockGetSyncopatedArpeggioPromptScope,
}));

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 0,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

/** Two commands whose musical time references span 32-40 and 48-56 beats. */
const regionActions: AppAction[] = [
    { type: 'addAdjustmentRegion', payload: { layerId: 'layer-bass-eq', startBeat: 32, endBeat: 40 } },
    { type: 'addAdjustmentRegion', payload: { layerId: 'layer-bass-eq', startBeat: 48, endBeat: 56 } },
];

const beatlessAction: AppAction = {
    type: 'renameTrack',
    payload: { trackId: 'track-bass', name: 'Bass' },
};

const palette = ['#palette-one', '#palette-two', '#palette-three'];

function createGluableClip(id: string, startBeat: number, endBeat: number): Clip {
    return {
        id,
        trackId: 'track-keys',
        name: id,
        startBeat,
        endBeat,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
    };
}

/** Two adjacent plain MIDI clips: the state `glueClips` materializes its command arguments from. */
function seedGluableTrack(): void {
    const track: Track = {
        id: 'track-keys',
        name: 'Keys',
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ffffff',
        clips: [createGluableClip('clip-keys-one', 0, 4), createGluableClip('clip-keys-two', 4, 8)],
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
    trackStore.set({ tracks: [track], selectedTrackId: 'track-keys', ghostClips: [] });
    midiStore.set({
        notesByClipId: {
            'clip-keys-one': [{ id: 'note-one', pitch: 60, startBeat: 0, duration: 1, velocity: 100, channel: 0 }],
            'clip-keys-two': [{ id: 'note-two', pitch: 64, startBeat: 4, duration: 1, velocity: 100, channel: 0 }],
        },
        ccByClipId: {},
        pitchBendByClipId: {},
    });
}

function compilerEvidenceFor(providerKnownTargetIds: readonly string[]): ArbitraryCommandListEvidence {
    return {
        schemaVersion: 1,
        snapshotRevision: 'revision-one',
        providerKnownTargetIds: [...providerKnownTargetIds],
        selectors: [],
        items: [],
        commands: [],
    };
}

function composeFor(input: {
    actions: readonly AppAction[];
    compilerEvidence?: ArbitraryCommandListEvidence;
    workflowCapabilityId?: 'syncopated-arpeggio';
}) {
    return composeVerifiedProviderProposalScope({
        actions: input.actions,
        compilerEvidence: input.compilerEvidence,
        context,
        prompt: 'Add the arpeggio the application projected.',
        workflowCapabilityId: input.workflowCapabilityId,
    });
}

describe('composeVerifiedProviderProposalScope', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        mockGetApplicationProtectedObjects.mockReturnValue([]);
        mockGetBulkDeviceInsertionTrackScope.mockReturnValue(null);
        mockGetMutedEmptyTrackDeletionScope.mockReturnValue(null);
        mockGetSidechainRoutingPromptScope.mockReturnValue({ status: 'invalid', reason: 'not this prompt' });
        mockGetSyncopatedArpeggioPromptScope.mockReturnValue({
            status: 'request',
            trackId: 'track-arp',
            clipId: 'clip-arp',
        });
    });

    afterEach(() => {
        clearHandlerRegistry();
        commandTrackDefaultsPort.setTrackColorProvider(null);
    });

    it('takes the target ranges of a workflow capability from the commands it compiles', () => {
        expect(composeFor({ actions: regionActions, workflowCapabilityId: 'syncopated-arpeggio' })).toEqual({
            targetIds: ['track-arp', 'clip-arp'],
            targetRanges: [
                { startBeat: 32, endBeat: 40 },
                { startBeat: 48, endBeat: 56 },
            ],
            protectedTargetIds: [],
            protectedRanges: [],
        });
    });

    it('takes the target ranges of a compiled command list from the same commands', () => {
        expect(
            composeFor({ actions: regionActions, compilerEvidence: compilerEvidenceFor(['layer-bass-eq']) })
        ).toEqual({
            targetIds: ['layer-bass-eq'],
            targetRanges: [
                { startBeat: 32, endBeat: 40 },
                { startBeat: 48, endBeat: 56 },
            ],
            protectedTargetIds: [],
            protectedRanges: [],
        });
    });

    it('claims no range when the compiled commands touch no beat', () => {
        expect(
            composeFor({ actions: [beatlessAction], workflowCapabilityId: 'syncopated-arpeggio' })?.targetRanges
        ).toEqual([]);
    });

    it('leaves the actions it measures untouched', () => {
        seedGluableTrack();
        const action: AppAction = { type: 'glueClips', payload: { clipIds: ['clip-keys-one', 'clip-keys-two'] } };
        const asProvided = structuredClone(action);

        composeFor({ actions: [action], workflowCapabilityId: 'syncopated-arpeggio' });

        expect(action).toEqual(asProvided);
        // The same compilation, given the action itself, writes the glue plan into it: without the
        // clone the measurement above would have left that plan on the batch the application runs.
        migrateLegacyAppActionToVersionedCommandEnvelope({ action, expectedEffect: 'glueClips' });
        expect(action).not.toEqual(asProvided);
    });

    it('reserves no application default while measuring a plan that creates a track', () => {
        let reservations = 0;
        commandTrackDefaultsPort.setTrackColorProvider(() => palette[reservations++] ?? '#exhausted');
        const addTrack: AppAction = { type: 'addTrack', payload: { name: 'Bass', kind: 'audio' } };

        composeFor({ actions: [addTrack], compilerEvidence: compilerEvidenceFor([]) });
        composeFor({ actions: [addTrack], compilerEvidence: compilerEvidenceFor([]) });
        const compiled = migrateLegacyAppActionToVersionedCommandEnvelope({ action: addTrack });

        expect(compiled.arguments).toMatchObject({ color: palette[0] });
        expect(reservations).toBe(1);
    });
});
