import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { type Macro } from '../../../models/Macro';
import { macroStore } from '../../../stores/macroStore';
import { playMacro } from '../playback';

const STORAGE_KEY = 'sourdaw:macros';

const { executeAppActionMock } = vi.hoisted(() => ({
    executeAppActionMock: vi
        .fn<typeof import('../../executeAppAction').executeAppAction>()
        .mockResolvedValue(undefined),
}));

vi.mock('../../executeAppAction', () => ({
    executeAppAction: executeAppActionMock,
}));

describe('playMacro', () => {
    const macro: Macro = {
        id: 'play-1',
        name: 'Two steps',
        actions: [{ type: 'togglePlayback' }, { type: 'toggleLoop' }],
        createdAt: 0,
    };

    beforeEach(() => {
        localStorage.removeItem(STORAGE_KEY);
        macroStore.set({ macros: [macro], recording: false, currentRecording: [] });
        executeAppActionMock.mockClear();
    });

    afterEach(() => {
        localStorage.removeItem(STORAGE_KEY);
    });

    it('should execute each action with a shared undo group', async () => {
        await playMacro('play-1');

        expect(executeAppActionMock).toHaveBeenCalledTimes(2);
        const [firstAction, firstOptions] = executeAppActionMock.mock.calls[0] as [
            import('#/utils/handlerContract').AppAction,
            import('#/utils/handlerContract').ExecuteOptions | undefined,
        ];
        const [secondAction, secondOptions] = executeAppActionMock.mock.calls[1] as [
            import('#/utils/handlerContract').AppAction,
            import('#/utils/handlerContract').ExecuteOptions | undefined,
        ];
        expect(firstAction).toEqual({ type: 'togglePlayback' });
        expect(secondAction).toEqual({ type: 'toggleLoop' });
        expect(firstOptions?.groupId).toBe(secondOptions?.groupId);
        expect(firstOptions?.groupLabel).toBe('Macro: Two steps');
    });

    it('plays a macro holding a singleton action alongside a batch-capable action without throwing', async () => {
        // drawClip and moveClips are domain-singleton handlers: playback runs
        // them through the same sequential per-action dispatch as everything
        // else instead of refusing the macro outright.
        const mixedMacro: Macro = {
            id: 'mixed-1',
            name: 'Draw then trim',
            actions: [
                {
                    type: 'drawClip',
                    payload: { trackId: 't1', startBeat: 0, endBeat: 4, name: 'Clip 0', type: 'audio', ripple: false },
                },
                { type: 'trimClipEnd', payload: { clipId: 'clip-1', newEndBeat: 6 } },
            ],
            createdAt: 0,
        };
        macroStore.set({ macros: [mixedMacro], recording: false, currentRecording: [] });

        await expect(playMacro('mixed-1')).resolves.toBeUndefined();

        expect(executeAppActionMock).toHaveBeenCalledTimes(2);
        expect(executeAppActionMock.mock.calls.map(([action]) => action.type)).toEqual(['drawClip', 'trimClipEnd']);
        // The singleton keeps its individual dispatch; the batch-capable
        // companion still rides the macro's shared group.
        const firstOptions = executeAppActionMock.mock.calls[0]![1];
        const secondOptions = executeAppActionMock.mock.calls[1]![1];
        expect(firstOptions?.groupId).toBe(secondOptions?.groupId);
        expect(secondOptions?.groupLabel).toBe('Macro: Draw then trim');
    });

    it('clears the recorded duplicateClipAt copy id so replay mints a fresh copy, not a no-op', async () => {
        // The recorded gesture's undo consumed the recorded copy id: replaying
        // with the id pinned would find the copy still present and silently
        // no-write. The clone must lose targetClipId; the stored macro keeps it.
        const duplicateMacro: Macro = {
            id: 'duplicate-1',
            name: 'Duplicate then trim',
            actions: [
                {
                    type: 'duplicateClipAt',
                    payload: { clipId: 'c1', destinationTrackId: 't2', startBeat: 8, targetClipId: 'recorded-copy' },
                },
                { type: 'trimClipEnd', payload: { clipId: 'c1', newEndBeat: 6 } },
            ],
            createdAt: 0,
        };
        macroStore.set({ macros: [duplicateMacro], recording: false, currentRecording: [] });

        await playMacro('duplicate-1');

        expect(executeAppActionMock.mock.calls[0]![0]).toEqual({
            type: 'duplicateClipAt',
            payload: { clipId: 'c1', destinationTrackId: 't2', startBeat: 8 },
        });
        expect(macroStore.value?.macros[0]?.actions[0]).toEqual({
            type: 'duplicateClipAt',
            payload: { clipId: 'c1', destinationTrackId: 't2', startBeat: 8, targetClipId: 'recorded-copy' },
        });
    });

    it('should no-op when macro id is missing', async () => {
        await playMacro('missing');
        expect(executeAppActionMock).not.toHaveBeenCalled();
    });

    it('should no-op when macroStore value is null', async () => {
        macroStore.set(null);
        await playMacro('play-1');
        expect(executeAppActionMock).not.toHaveBeenCalled();
    });

    it('regenerates automation IDs and remaps later references on every playback', async () => {
        const automationMacro: Macro = {
            id: 'automation-1',
            name: 'Automation steps',
            actions: [
                {
                    type: 'addAutomationLane',
                    payload: {
                        trackId: 'track-1',
                        parameterId: 'gain',
                        parameterName: 'Gain',
                        laneId: 'recorded-lane',
                    },
                },
                {
                    type: 'addAutomationPoint',
                    payload: {
                        laneId: 'recorded-lane',
                        pointId: 'recorded-point',
                        beat: 4,
                        value: 0.5,
                    },
                },
                { type: 'setAutomationLaneEnabled', payload: { laneId: 'recorded-lane', enabled: false } },
                {
                    type: 'removeAutomationPoint',
                    payload: { laneId: 'recorded-lane', pointIndex: 0, pointId: 'recorded-point' },
                },
            ],
            createdAt: 0,
        };
        macroStore.set({ macros: [automationMacro], recording: false, currentRecording: [] });
        let generatedLaneId = 0;
        let generatedPointId = 0;
        executeAppActionMock.mockImplementation((action) => {
            if (action.type === 'addAutomationLane' && action.payload.laneId === undefined) {
                generatedLaneId += 1;
                action.payload.laneId = `replayed-lane-${String(generatedLaneId)}`;
            }
            if (action.type === 'addAutomationPoint' && action.payload.pointId === undefined) {
                generatedPointId += 1;
                action.payload.pointId = `replayed-point-${String(generatedPointId)}`;
            }
            return Promise.resolve();
        });

        await playMacro('automation-1');
        await playMacro('automation-1');

        expect(executeAppActionMock.mock.calls.map(([action]) => action)).toEqual([
            {
                type: 'addAutomationLane',
                payload: {
                    trackId: 'track-1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    laneId: 'replayed-lane-1',
                },
            },
            {
                type: 'addAutomationPoint',
                payload: { laneId: 'replayed-lane-1', pointId: 'replayed-point-1', beat: 4, value: 0.5 },
            },
            { type: 'setAutomationLaneEnabled', payload: { laneId: 'replayed-lane-1', enabled: false } },
            {
                type: 'removeAutomationPoint',
                payload: { laneId: 'replayed-lane-1', pointIndex: 0, pointId: 'replayed-point-1' },
            },
            {
                type: 'addAutomationLane',
                payload: {
                    trackId: 'track-1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    laneId: 'replayed-lane-2',
                },
            },
            {
                type: 'addAutomationPoint',
                payload: { laneId: 'replayed-lane-2', pointId: 'replayed-point-2', beat: 4, value: 0.5 },
            },
            { type: 'setAutomationLaneEnabled', payload: { laneId: 'replayed-lane-2', enabled: false } },
            {
                type: 'removeAutomationPoint',
                payload: { laneId: 'replayed-lane-2', pointIndex: 0, pointId: 'replayed-point-2' },
            },
        ]);
        expect(macroStore.value?.macros[0]?.actions).toEqual(automationMacro.actions);
    });

    it('remaps point IDs embedded in recorded automation restore snapshots', async () => {
        const restoreMacro: Macro = {
            id: 'automation-restore',
            name: 'Automation restore',
            actions: [
                {
                    type: 'addAutomationLane',
                    payload: {
                        trackId: 'track-1',
                        parameterId: 'gain',
                        parameterName: 'Gain',
                        laneId: 'recorded-lane',
                    },
                },
                {
                    type: 'addAutomationPoint',
                    payload: {
                        laneId: 'recorded-lane',
                        pointId: 'recorded-point',
                        beat: 4,
                        value: 0.5,
                    },
                },
                {
                    type: 'restoreAutomationLanePoints',
                    payload: {
                        laneId: 'recorded-lane',
                        points: [
                            {
                                id: 'recorded-point',
                                beat: 4,
                                value: 0.5,
                                curve: 'linear',
                                tension: 0,
                            },
                        ],
                        expectedPoints: [
                            {
                                id: 'recorded-point',
                                beat: 4,
                                value: 0.75,
                                curve: 'linear',
                                tension: 0,
                            },
                        ],
                    },
                },
                {
                    type: 'removeAutomationPoint',
                    payload: { laneId: 'recorded-lane', pointIndex: 0, pointId: 'recorded-point' },
                },
            ],
            createdAt: 0,
        };
        macroStore.set({ macros: [restoreMacro], recording: false, currentRecording: [] });
        executeAppActionMock.mockImplementation((action) => {
            if (action.type === 'addAutomationLane') {
                action.payload.laneId = 'replayed-lane';
            }
            if (action.type === 'addAutomationPoint') {
                action.payload.pointId = 'replayed-point';
            }
            return Promise.resolve();
        });

        await playMacro(restoreMacro.id);

        expect(executeAppActionMock.mock.calls[2]?.[0]).toEqual({
            type: 'restoreAutomationLanePoints',
            payload: {
                laneId: 'replayed-lane',
                points: [
                    {
                        id: 'replayed-point',
                        beat: 4,
                        value: 0.5,
                        curve: 'linear',
                        tension: 0,
                    },
                ],
                expectedPoints: [
                    {
                        id: 'replayed-point',
                        beat: 4,
                        value: 0.75,
                        curve: 'linear',
                        tension: 0,
                    },
                ],
            },
        });
        expect(executeAppActionMock.mock.calls[3]?.[0]).toMatchObject({
            payload: { laneId: 'replayed-lane', pointId: 'replayed-point' },
        });
    });

    it('remaps later actions to the canonical lane returned by a no-op add', async () => {
        const noOpLaneMacro: Macro = {
            id: 'automation-existing-lane',
            name: 'Existing automation lane',
            actions: [
                {
                    type: 'addAutomationLane',
                    payload: {
                        trackId: 'track-1',
                        parameterId: 'gain',
                        parameterName: 'Gain',
                        laneId: 'recorded-lane',
                    },
                },
                {
                    type: 'addAutomationPoint',
                    payload: { laneId: 'recorded-lane', pointId: 'recorded-point', beat: 4, value: 0.5 },
                },
            ],
            createdAt: 0,
        };
        macroStore.set({ macros: [noOpLaneMacro], recording: false, currentRecording: [] });
        executeAppActionMock.mockImplementation((action) => {
            if (action.type === 'addAutomationLane') {
                action.payload.laneId = 'existing-lane';
            }
            if (action.type === 'addAutomationPoint') {
                action.payload.pointId = 'replayed-point';
            }
            return Promise.resolve();
        });

        await playMacro(noOpLaneMacro.id);

        expect(executeAppActionMock.mock.calls.map(([action]) => action)).toEqual([
            {
                type: 'addAutomationLane',
                payload: {
                    trackId: 'track-1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    laneId: 'existing-lane',
                },
            },
            {
                type: 'addAutomationPoint',
                payload: { laneId: 'existing-lane', pointId: 'replayed-point', beat: 4, value: 0.5 },
            },
        ]);
    });

    it('should regenerate adjustment IDs and remap later references without mutating the macro', async () => {
        const adjustmentMacro: Macro = {
            id: 'adjustment-1',
            name: 'Adjustment steps',
            actions: [
                {
                    type: 'createAdjustmentLayer',
                    payload: { name: 'Layer', effectType: 'volume', layerId: 'recorded-layer' },
                },
                { type: 'setLayerMix', payload: { layerId: 'recorded-layer', mix: 0.5 } },
                {
                    type: 'addAdjustmentRegion',
                    payload: {
                        layerId: 'recorded-layer',
                        startBeat: 0,
                        endBeat: 4,
                        regionId: 'recorded-region',
                    },
                },
                {
                    type: 'moveAdjustmentRegion',
                    payload: { regionId: 'recorded-region', startBeat: 4, endBeat: 8 },
                },
            ],
            createdAt: 0,
        };
        macroStore.set({ macros: [adjustmentMacro], recording: false, currentRecording: [] });
        executeAppActionMock.mockImplementation((action) => {
            if (action.type === 'createAdjustmentLayer') {
                action.payload.layerId = 'replayed-layer';
            }
            if (action.type === 'addAdjustmentRegion') {
                action.payload.regionId = 'replayed-region';
            }
            return Promise.resolve();
        });

        await playMacro('adjustment-1');

        expect(executeAppActionMock.mock.calls.map(([action]) => action)).toEqual([
            {
                type: 'createAdjustmentLayer',
                payload: { name: 'Layer', effectType: 'volume', layerId: 'replayed-layer' },
            },
            { type: 'setLayerMix', payload: { layerId: 'replayed-layer', mix: 0.5 } },
            {
                type: 'addAdjustmentRegion',
                payload: {
                    layerId: 'replayed-layer',
                    startBeat: 0,
                    endBeat: 4,
                    regionId: 'replayed-region',
                },
            },
            {
                type: 'moveAdjustmentRegion',
                payload: { regionId: 'replayed-region', startBeat: 4, endBeat: 8 },
            },
        ]);
        expect(macroStore.value?.macros[0]?.actions).toEqual(adjustmentMacro.actions);
    });

    it('should regenerate recorded VCA IDs and remap references independently on every playback', async () => {
        const vcaMacro: Macro = {
            id: 'vca-1',
            name: 'VCA steps',
            actions: [
                {
                    type: 'createVcaGroup',
                    payload: { name: 'Drums', trackIds: ['track-1'], vcaGroupId: 'recorded-vca' },
                },
                { type: 'assignToVca', payload: { trackId: 'track-2', vcaGroupId: 'recorded-vca' } },
                { type: 'setVcaGain', payload: { vcaGroupId: 'recorded-vca', gain: 0.75 } },
            ],
            createdAt: 0,
        };
        macroStore.set({ macros: [vcaMacro], recording: false, currentRecording: [] });
        let generatedId = 0;
        executeAppActionMock.mockImplementation((action) => {
            if (action.type === 'createVcaGroup' && action.payload.vcaGroupId === undefined) {
                generatedId += 1;
                action.payload.vcaGroupId = `replayed-vca-${String(generatedId)}`;
            }
            return Promise.resolve();
        });

        await playMacro('vca-1');
        await playMacro('vca-1');

        expect(executeAppActionMock.mock.calls.map(([action]) => action)).toEqual([
            {
                type: 'createVcaGroup',
                payload: { name: 'Drums', trackIds: ['track-1'], vcaGroupId: 'replayed-vca-1' },
            },
            { type: 'assignToVca', payload: { trackId: 'track-2', vcaGroupId: 'replayed-vca-1' } },
            { type: 'setVcaGain', payload: { vcaGroupId: 'replayed-vca-1', gain: 0.75 } },
            {
                type: 'createVcaGroup',
                payload: { name: 'Drums', trackIds: ['track-1'], vcaGroupId: 'replayed-vca-2' },
            },
            { type: 'assignToVca', payload: { trackId: 'track-2', vcaGroupId: 'replayed-vca-2' } },
            { type: 'setVcaGain', payload: { vcaGroupId: 'replayed-vca-2', gain: 0.75 } },
        ]);
        expect(macroStore.value?.macros[0]?.actions).toEqual(vcaMacro.actions);
    });

    it('regenerates chord IDs and remaps later chord actions on every playback', async () => {
        const chordMacro: Macro = {
            id: 'chords-1',
            name: 'Chord steps',
            actions: [
                {
                    type: 'addChordEvent',
                    payload: { eventId: 'recorded-chord', beat: 0, root: 0, quality: 'major', duration: 4 },
                },
                { type: 'moveChordEvent', payload: { eventId: 'recorded-chord', beat: 8 } },
            ],
            createdAt: 0,
        };
        macroStore.set({ macros: [chordMacro], recording: false, currentRecording: [] });
        let generatedId = 0;
        executeAppActionMock.mockImplementation((action) => {
            if (action.type === 'addChordEvent' && action.payload.eventId === undefined) {
                generatedId += 1;
                action.payload.eventId = `replayed-chord-${String(generatedId)}`;
            }
            return Promise.resolve();
        });

        await playMacro('chords-1');
        await playMacro('chords-1');

        const replayedIds = executeAppActionMock.mock.calls.map(([action]) => {
            if (action.type === 'addChordEvent' || action.type === 'moveChordEvent') {
                return action.payload.eventId;
            }
            throw new Error(`Unexpected chord macro action: ${action.type}`);
        });
        expect(replayedIds).toEqual(['replayed-chord-1', 'replayed-chord-1', 'replayed-chord-2', 'replayed-chord-2']);
    });

    it('regenerates recorded marker/section IDs and remaps references on every playback', async () => {
        // A macro recorded with caller-minted marker/section ids (batch-4 undo
        // inverses put them on the payload). Replaying it twice must mint fresh
        // ids per playback — duplicate ids would make a later removeMarker (or
        // an undo of addMarker, whose inverse is removeMarker) delete BOTH
        // entries sharing the id, and duplicate React keys in the marker list.
        const markerMacro: Macro = {
            id: 'markers-1',
            name: 'Marker steps',
            actions: [
                { type: 'addMarker', payload: { beat: 4, name: 'Intro', markerId: 'recorded-marker' } },
                { type: 'setMarkerColor', payload: { markerId: 'recorded-marker', color: '#f00' } },
                {
                    type: 'addSection',
                    payload: { startBeat: 0, endBeat: 8, name: 'Verse', sectionId: 'recorded-section' },
                },
                { type: 'renameSection', payload: { sectionId: 'recorded-section', name: 'Chorus' } },
                { type: 'removeMarker', payload: { markerId: 'recorded-marker' } },
            ],
            createdAt: 0,
        };
        macroStore.set({ macros: [markerMacro], recording: false, currentRecording: [] });
        let generatedMarkerId = 0;
        let generatedSectionId = 0;
        executeAppActionMock.mockImplementation((action) => {
            if (action.type === 'addMarker' && action.payload.markerId === undefined) {
                generatedMarkerId += 1;
                action.payload.markerId = `replayed-marker-${String(generatedMarkerId)}`;
            }
            if (action.type === 'addSection' && action.payload.sectionId === undefined) {
                generatedSectionId += 1;
                action.payload.sectionId = `replayed-section-${String(generatedSectionId)}`;
            }
            return Promise.resolve();
        });

        await playMacro('markers-1');
        await playMacro('markers-1');

        expect(executeAppActionMock.mock.calls.map(([action]) => action)).toEqual([
            { type: 'addMarker', payload: { beat: 4, name: 'Intro', markerId: 'replayed-marker-1' } },
            { type: 'setMarkerColor', payload: { markerId: 'replayed-marker-1', color: '#f00' } },
            {
                type: 'addSection',
                payload: { startBeat: 0, endBeat: 8, name: 'Verse', sectionId: 'replayed-section-1' },
            },
            { type: 'renameSection', payload: { sectionId: 'replayed-section-1', name: 'Chorus' } },
            { type: 'removeMarker', payload: { markerId: 'replayed-marker-1' } },
            { type: 'addMarker', payload: { beat: 4, name: 'Intro', markerId: 'replayed-marker-2' } },
            { type: 'setMarkerColor', payload: { markerId: 'replayed-marker-2', color: '#f00' } },
            {
                type: 'addSection',
                payload: { startBeat: 0, endBeat: 8, name: 'Verse', sectionId: 'replayed-section-2' },
            },
            { type: 'renameSection', payload: { sectionId: 'replayed-section-2', name: 'Chorus' } },
            { type: 'removeMarker', payload: { markerId: 'replayed-marker-2' } },
        ]);
        // The stored macro keeps its recorded ids — replay never mutates it.
        expect(macroStore.value?.macros[0]?.actions).toEqual(markerMacro.actions);
    });

    it('regenerates recorded track-alternative IDs and remaps references on every playback', async () => {
        // Batch 5 put caller-minted alternativeIds on createTrackAlternative
        // payloads for undo. Replaying a recorded macro twice must mint fresh
        // ids per playback, or both plays share one alternative id (duplicate
        // React keys; delete/undo would hit both plays' alternatives).
        const alternativeMacro: Macro = {
            id: 'alternatives-1',
            name: 'Alternative steps',
            actions: [
                {
                    type: 'createTrackAlternative',
                    payload: { trackId: 't1', name: 'Take 2', duplicateActive: false, alternativeId: 'recorded-alt' },
                },
                {
                    type: 'renameTrackAlternative',
                    payload: { trackId: 't1', alternativeId: 'recorded-alt', name: 'Take 2 (final)' },
                },
                {
                    type: 'switchTrackAlternative',
                    payload: { trackId: 't1', alternativeId: 'recorded-alt' },
                },
            ],
            createdAt: 0,
        };
        macroStore.set({ macros: [alternativeMacro], recording: false, currentRecording: [] });
        let generatedId = 0;
        executeAppActionMock.mockImplementation((action) => {
            if (action.type === 'createTrackAlternative' && action.payload.alternativeId === undefined) {
                generatedId += 1;
                action.payload.alternativeId = `replayed-alt-${String(generatedId)}`;
            }
            return Promise.resolve();
        });

        await playMacro('alternatives-1');
        await playMacro('alternatives-1');

        expect(executeAppActionMock.mock.calls.map(([action]) => action)).toEqual([
            {
                type: 'createTrackAlternative',
                payload: { trackId: 't1', name: 'Take 2', duplicateActive: false, alternativeId: 'replayed-alt-1' },
            },
            {
                type: 'renameTrackAlternative',
                payload: { trackId: 't1', alternativeId: 'replayed-alt-1', name: 'Take 2 (final)' },
            },
            { type: 'switchTrackAlternative', payload: { trackId: 't1', alternativeId: 'replayed-alt-1' } },
            {
                type: 'createTrackAlternative',
                payload: { trackId: 't1', name: 'Take 2', duplicateActive: false, alternativeId: 'replayed-alt-2' },
            },
            {
                type: 'renameTrackAlternative',
                payload: { trackId: 't1', alternativeId: 'replayed-alt-2', name: 'Take 2 (final)' },
            },
            { type: 'switchTrackAlternative', payload: { trackId: 't1', alternativeId: 'replayed-alt-2' } },
        ]);
        expect(macroStore.value?.macros[0]?.actions).toEqual(alternativeMacro.actions);
    });

    it('remaps fallbackAlternativeId on recorded deleteTrackAlternative payloads (revertAction-recorded create inverse)', async () => {
        // revertAction replays a create's undo inverse without
        // skipMacroRecording, so a recorded macro can contain a
        // deleteTrackAlternative whose fallbackAlternativeId references another
        // recorded create's id. Replay must remap both references or the delete
        // degrades to the first-in-list fallback and restores the wrong active
        // alternative.
        const inverseMacro: Macro = {
            id: 'alternatives-inverse-1',
            name: 'Alternative inverse steps',
            actions: [
                {
                    type: 'createTrackAlternative',
                    payload: { trackId: 't1', name: 'Take 1', duplicateActive: false, alternativeId: 'recorded-alt-a' },
                },
                {
                    type: 'createTrackAlternative',
                    payload: { trackId: 't1', name: 'Take 2', duplicateActive: false, alternativeId: 'recorded-alt-b' },
                },
                {
                    type: 'deleteTrackAlternative',
                    payload: {
                        trackId: 't1',
                        alternativeId: 'recorded-alt-b',
                        fallbackAlternativeId: 'recorded-alt-a',
                    },
                },
            ],
            createdAt: 0,
        };
        macroStore.set({ macros: [inverseMacro], recording: false, currentRecording: [] });
        let generatedId = 0;
        executeAppActionMock.mockImplementation((action) => {
            if (action.type === 'createTrackAlternative' && action.payload.alternativeId === undefined) {
                generatedId += 1;
                action.payload.alternativeId = `replayed-alt-${String(generatedId)}`;
            }
            return Promise.resolve();
        });

        await playMacro('alternatives-inverse-1');
        await playMacro('alternatives-inverse-1');

        expect(executeAppActionMock.mock.calls.map(([action]) => action)).toEqual([
            {
                type: 'createTrackAlternative',
                payload: { trackId: 't1', name: 'Take 1', duplicateActive: false, alternativeId: 'replayed-alt-1' },
            },
            {
                type: 'createTrackAlternative',
                payload: { trackId: 't1', name: 'Take 2', duplicateActive: false, alternativeId: 'replayed-alt-2' },
            },
            {
                type: 'deleteTrackAlternative',
                payload: {
                    trackId: 't1',
                    alternativeId: 'replayed-alt-2',
                    fallbackAlternativeId: 'replayed-alt-1',
                },
            },
            {
                type: 'createTrackAlternative',
                payload: { trackId: 't1', name: 'Take 1', duplicateActive: false, alternativeId: 'replayed-alt-3' },
            },
            {
                type: 'createTrackAlternative',
                payload: { trackId: 't1', name: 'Take 2', duplicateActive: false, alternativeId: 'replayed-alt-4' },
            },
            {
                type: 'deleteTrackAlternative',
                payload: {
                    trackId: 't1',
                    alternativeId: 'replayed-alt-4',
                    fallbackAlternativeId: 'replayed-alt-3',
                },
            },
        ]);
        expect(macroStore.value?.macros[0]?.actions).toEqual(inverseMacro.actions);
    });

    it('regenerates sidechain route IDs and remaps later inverse references on every playback', async () => {
        const sidechainMacro: Macro = {
            id: 'sidechain-route-1',
            name: 'Sidechain route',
            actions: [
                {
                    type: 'addSidechainRoute',
                    payload: {
                        sourceTrackId: 'kick',
                        targetTrackId: 'bass',
                        routeId: 'recorded-route',
                        targetDeviceId: 'compressor-1',
                        targetParameterId: 'threshold',
                        gain: 0.75,
                    },
                },
                {
                    type: 'removeSidechainRoute',
                    payload: {
                        sourceTrackId: 'kick',
                        targetTrackId: 'bass',
                        routeId: 'recorded-route',
                        targetDeviceId: 'compressor-1',
                        targetParameterId: 'threshold',
                        gain: 0.75,
                    },
                },
            ],
            createdAt: 0,
        };
        macroStore.set({ macros: [sidechainMacro], recording: false, currentRecording: [] });
        let generatedRouteId = 0;
        executeAppActionMock.mockImplementation((action) => {
            if (action.type === 'addSidechainRoute' && action.payload.routeId === undefined) {
                generatedRouteId += 1;
                action.payload.routeId = `replayed-route-${String(generatedRouteId)}`;
            }
            return Promise.resolve();
        });

        await playMacro('sidechain-route-1');
        await playMacro('sidechain-route-1');

        expect(executeAppActionMock.mock.calls.map(([action]) => action)).toEqual([
            {
                type: 'addSidechainRoute',
                payload: {
                    sourceTrackId: 'kick',
                    targetTrackId: 'bass',
                    routeId: 'replayed-route-1',
                    targetDeviceId: 'compressor-1',
                    targetParameterId: 'threshold',
                    gain: 0.75,
                },
            },
            {
                type: 'removeSidechainRoute',
                payload: {
                    sourceTrackId: 'kick',
                    targetTrackId: 'bass',
                    routeId: 'replayed-route-1',
                    targetDeviceId: 'compressor-1',
                    targetParameterId: 'threshold',
                    gain: 0.75,
                },
            },
            {
                type: 'addSidechainRoute',
                payload: {
                    sourceTrackId: 'kick',
                    targetTrackId: 'bass',
                    routeId: 'replayed-route-2',
                    targetDeviceId: 'compressor-1',
                    targetParameterId: 'threshold',
                    gain: 0.75,
                },
            },
            {
                type: 'removeSidechainRoute',
                payload: {
                    sourceTrackId: 'kick',
                    targetTrackId: 'bass',
                    routeId: 'replayed-route-2',
                    targetDeviceId: 'compressor-1',
                    targetParameterId: 'threshold',
                    gain: 0.75,
                },
            },
        ]);
        expect(macroStore.value?.macros[0]?.actions).toEqual(sidechainMacro.actions);
    });
});
