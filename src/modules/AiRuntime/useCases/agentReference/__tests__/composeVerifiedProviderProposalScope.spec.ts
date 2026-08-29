import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
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
        const actions = structuredClone(regionActions);

        composeFor({ actions, workflowCapabilityId: 'syncopated-arpeggio' });

        expect(actions).toEqual(regionActions);
    });
});
