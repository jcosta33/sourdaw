import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ProjectContext } from '../../../models/ProjectContext';
import { getApplicationWorkflowScope } from '../getApplicationWorkflowScope';

const {
    mockGetApplicationProtectedObjects,
    mockGetArticulationTransferPromptScope,
    mockGetBassProcessingCopyPromptScope,
    mockGetDrumPreviewBranchesPromptScope,
    mockGetDrumRoutingPromptScope,
    mockGetMidiOverlapTransformPromptScope,
    mockGetSyncopatedArpeggioPromptScope,
} = vi.hoisted(() => ({
    mockGetApplicationProtectedObjects: vi.fn(),
    mockGetArticulationTransferPromptScope: vi.fn(),
    mockGetBassProcessingCopyPromptScope: vi.fn(),
    mockGetDrumPreviewBranchesPromptScope: vi.fn(),
    mockGetDrumRoutingPromptScope: vi.fn(),
    mockGetMidiOverlapTransformPromptScope: vi.fn(),
    mockGetSyncopatedArpeggioPromptScope: vi.fn(),
}));

vi.mock('../getApplicationProtectedObjects', () => ({
    getApplicationProtectedObjects: mockGetApplicationProtectedObjects,
}));
vi.mock('../getArticulationTransferPromptScope', () => ({
    getArticulationTransferPromptScope: mockGetArticulationTransferPromptScope,
}));
vi.mock('../getBassProcessingCopyPromptScope', () => ({
    getBassProcessingCopyPromptScope: mockGetBassProcessingCopyPromptScope,
}));
vi.mock('../getDrumPreviewBranchesPromptScope', () => ({
    getDrumPreviewBranchesPromptScope: mockGetDrumPreviewBranchesPromptScope,
}));
vi.mock('../getDrumRoutingPromptScope', () => ({
    getDrumRoutingPromptScope: mockGetDrumRoutingPromptScope,
}));
vi.mock('../getMidiOverlapTransformPromptScope', () => ({
    getMidiOverlapTransformPromptScope: mockGetMidiOverlapTransformPromptScope,
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

const protectedTargetIds = ['protected-explicit', 'protected-workflow'];

function scopeFor(workflowCapabilityId: Parameters<typeof getApplicationWorkflowScope>[0]['workflowCapabilityId']) {
    return getApplicationWorkflowScope({
        actions: [],
        context,
        prompt: 'Keep the explicit reference unchanged.',
        workflowCapabilityId,
    });
}

describe('getApplicationWorkflowScope', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetApplicationProtectedObjects.mockReturnValue([
            { id: protectedTargetIds[0], name: 'Explicit reference' },
            { id: protectedTargetIds[1], name: 'Workflow protection' },
        ]);
        for (const resolver of [
            mockGetArticulationTransferPromptScope,
            mockGetBassProcessingCopyPromptScope,
            mockGetDrumPreviewBranchesPromptScope,
            mockGetDrumRoutingPromptScope,
            mockGetMidiOverlapTransformPromptScope,
            mockGetSyncopatedArpeggioPromptScope,
        ]) {
            resolver.mockReturnValue({ status: 'invalid', reason: 'not selected' });
        }
    });

    it('derives bass-processing targets and target ranges', () => {
        mockGetBassProcessingCopyPromptScope.mockReturnValue({
            status: 'request',
            entries: [
                {
                    layer: { id: 'layer-bass', affectedTrackIds: ['track-bass', 'track-bass-double'] },
                    targetRegion: { startBeat: 32, endBeat: 40 },
                },
            ],
            targetSection: { id: 'section-chorus-two' },
        });

        expect(scopeFor('bass-processing-copy')).toEqual({
            targetIds: ['layer-bass', 'track-bass', 'track-bass-double', 'section-chorus-two'],
            targetRanges: [{ startBeat: 32, endBeat: 40 }],
            protectedTargetIds,
            protectedRanges: [],
        });
    });

    it('derives articulation-transfer targets and relative note ranges', () => {
        mockGetArticulationTransferPromptScope.mockReturnValue({
            status: 'request',
            clipPairs: [
                {
                    trackId: 'track-strings',
                    sourceClipId: 'clip-chorus-one',
                    targetClipId: 'clip-chorus-two',
                    notePairs: [{ relativeStartBeat: 0 }, { relativeStartBeat: 3.5 }],
                },
            ],
        });

        expect(scopeFor('articulation-transfer')).toEqual({
            targetIds: ['track-strings', 'clip-chorus-one', 'clip-chorus-two'],
            targetRanges: [{ startBeat: 0, endBeat: 3.5 }],
            protectedTargetIds,
            protectedRanges: [],
        });
    });

    it('derives MIDI-overlap targets and absolute note ranges', () => {
        mockGetMidiOverlapTransformPromptScope.mockReturnValue({
            status: 'request',
            entries: [
                {
                    clipId: 'clip-keys',
                    trackId: 'track-keys',
                    expectedNotes: [{ startBeat: 8 }, { startBeat: 15.75 }],
                },
            ],
        });

        expect(scopeFor('midi-overlap-shortening')).toEqual({
            targetIds: ['clip-keys', 'track-keys'],
            targetRanges: [{ startBeat: 8, endBeat: 15.75 }],
            protectedTargetIds,
            protectedRanges: [],
        });
    });

    it('derives syncopated-arpeggio targets without inventing ranges', () => {
        mockGetSyncopatedArpeggioPromptScope.mockReturnValue({
            status: 'request',
            trackId: 'track-synth',
            clipId: 'clip-synth',
        });

        expect(scopeFor('syncopated-arpeggio')).toEqual({
            targetIds: ['track-synth', 'clip-synth'],
            targetRanges: [],
            protectedTargetIds,
            protectedRanges: [],
        });
    });

    it('derives drum-preview targets and the application section range', () => {
        mockGetDrumPreviewBranchesPromptScope.mockReturnValue({
            status: 'request',
            snare: { trackId: 'track-snare', clipId: 'clip-snare' },
            hiHat: { trackId: 'track-hats', clipId: 'clip-hats' },
            section: { startBeat: 16, endBeat: 48 },
        });

        expect(scopeFor('drum-preview-branches')).toEqual({
            targetIds: ['track-snare', 'track-hats', 'clip-snare', 'clip-hats'],
            targetRanges: [{ startBeat: 16, endBeat: 48 }],
            protectedTargetIds,
            protectedRanges: [],
        });
    });

    it('derives exact drum-routing bus and track targets', () => {
        mockGetDrumRoutingPromptScope.mockReturnValue({
            status: 'request',
            busId: 'bus-drums',
            targetIds: ['track-kick', 'track-snare', 'track-hats'],
        });

        expect(scopeFor('drum-routing')).toEqual({
            targetIds: ['bus-drums', 'track-kick', 'track-snare', 'track-hats'],
            targetRanges: [],
            protectedTargetIds,
            protectedRanges: [],
        });
    });

    it('leaves unsupported workflow capabilities to the generic compiler scope path', () => {
        expect(scopeFor('shared-vocal-fx-buses')).toBeUndefined();
        expect(mockGetApplicationProtectedObjects).not.toHaveBeenCalled();
    });
});
