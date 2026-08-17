import { describe, expect, expectTypeOf, it } from 'vitest';

import { RUNTIME_ACTION_TYPES, type RuntimeAction } from '../RuntimeAction';

type RuntimePayload<ActionType extends RuntimeAction['type']> =
    Extract<RuntimeAction, { type: ActionType }> extends { payload: infer Payload } ? Payload : never;
type PayloadHasKey<
    ActionType extends RuntimeAction['type'],
    Key extends PropertyKey,
> = Key extends keyof RuntimePayload<ActionType> ? true : false;

describe('RuntimeAction', () => {
    it('admits the exact duplicate-free compatibility action census', () => {
        let digest = 2_166_136_261;
        for (const actionType of RUNTIME_ACTION_TYPES) {
            for (const character of `${actionType}\n`) {
                digest = Math.imul(digest ^ character.charCodeAt(0), 16_777_619);
            }
        }

        expect(RUNTIME_ACTION_TYPES).toHaveLength(246);
        expect(new Set(RUNTIME_ACTION_TYPES).size).toBe(RUNTIME_ACTION_TYPES.length);
        expect(RUNTIME_ACTION_TYPES).not.toContain('replayGeneratedMidi');
        expect(RUNTIME_ACTION_TYPES).not.toContain('stemSeparate');
        expect(RUNTIME_ACTION_TYPES).toContain('automateSendRanges');
        expect(RUNTIME_ACTION_TYPES).toContain('renderProjectSections');
        expect(digest >>> 0).toBe(1_665_486_056);
    });

    it('derives initiating payloads without exposing command-owned replay fields', () => {
        type EmptyCollabSessionPayloadAllowed = {} extends RuntimePayload<'createCollabSession'> ? true : false;
        type RuntimeAddNotesNote = RuntimePayload<'addNotes'>['notes'][number];
        type RuntimeAddNotesNoteHasId = 'id' extends keyof RuntimeAddNotesNote ? true : false;
        const actions: RuntimeAction[] = [
            { type: 'duplicateClip', payload: { clipId: 'clip-1' } },
            {
                type: 'addAutomationLane',
                payload: { trackId: 'track-1', parameterId: 'gain', parameterName: 'Gain' },
            },
            { type: 'addAutomationPoint', payload: { laneId: 'lane-1', beat: 4, value: 0.5 } },
            { type: 'removeAutomationPoint', payload: { laneId: 'lane-1', pointIndex: 0 } },
            { type: 'setAutomationLaneEnabled', payload: { laneId: 'lane-1', enabled: false } },
            { type: 'setAutomationMode', payload: { trackId: 'track-1', mode: 'touch' } },
            { type: 'addSidechainRoute', payload: { sourceTrackId: 'track-1', targetTrackId: 'track-2' } },
            { type: 'removeSidechainRoute', payload: { sourceTrackId: 'track-1', targetTrackId: 'track-2' } },
            { type: 'quantizeNotes', payload: { clipId: 'clip-1', gridSize: 0.25 } },
            { type: 'removeShortMidiOverlaps', payload: { clipId: 'clip-1', maximumOverlapMs: 30 } },
            {
                type: 'copyMidiArticulations',
                payload: { sourceClipId: 'clip-1', targetClipId: 'clip-2' },
            },
            {
                type: 'createDrumPreviewBranches',
                payload: {
                    sectionId: 'section-eight-bars',
                    candidateCount: 3,
                    varyingRoles: ['snare', 'hi-hat'],
                },
            },
            { type: 'transposeNotes', payload: { clipId: 'clip-1', semitones: 7 } },
            { type: 'scaleAutomation', payload: { laneId: 'lane-1', factor: 1.5 } },
            { type: 'stretchAutomation', payload: { laneId: 'lane-1', factor: 2 } },
            { type: 'createVcaGroup', payload: { name: 'Band', trackIds: ['track-1'] } },
            { type: 'createCollabSession', payload: { name: 'Mix review' } },
            { type: 'lockClip', payload: { clipId: 'clip-1', locked: true } },
            { type: 'muteClip', payload: { clipId: 'clip-1', muted: true } },
            { type: 'setClipColor', payload: { clipId: 'clip-1', color: '#112233' } },
            { type: 'setClipFade', payload: { clipId: 'clip-1', fadeInBeats: 1, fadeOutBeats: 2 } },
            { type: 'setClipLoop', payload: { clipId: 'clip-1', enabled: true } },
            { type: 'glueClips', payload: { clipIds: ['clip-1', 'clip-2'] } },
            { type: 'setPunchEnabled', payload: { enabled: true } },
            {
                type: 'addAdjustmentRegion',
                payload: {
                    layerId: 'layer-bass-eq',
                    startBeat: 48,
                    endBeat: 64,
                    blend: 0.75,
                    fadeInBeats: 0.5,
                    fadeOutBeats: 0.25,
                },
            },
            {
                type: 'automateTrackGainRange',
                payload: { trackIds: ['bus-drums', 'bus-bass'], sectionName: 'Chorus Two', gainDb: 1.5 },
            },
        ];

        expect(actions.map((action) => action.type)).toEqual([
            'duplicateClip',
            'addAutomationLane',
            'addAutomationPoint',
            'removeAutomationPoint',
            'setAutomationLaneEnabled',
            'setAutomationMode',
            'addSidechainRoute',
            'removeSidechainRoute',
            'quantizeNotes',
            'removeShortMidiOverlaps',
            'copyMidiArticulations',
            'createDrumPreviewBranches',
            'transposeNotes',
            'scaleAutomation',
            'stretchAutomation',
            'createVcaGroup',
            'createCollabSession',
            'lockClip',
            'muteClip',
            'setClipColor',
            'setClipFade',
            'setClipLoop',
            'glueClips',
            'setPunchEnabled',
            'addAdjustmentRegion',
            'automateTrackGainRange',
        ]);
        expectTypeOf<PayloadHasKey<'duplicateClip', 'targetClipId'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'addTrack', 'id'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'addTrack', 'color'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'addTrack', 'initialAlternativeId'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'addTrack', 'gain'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'addAutomationLane', 'laneId'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'addAutomationPoint', 'pointId'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'removeAutomationPoint', 'pointId'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'setAutomationMode', 'expectedMode'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'addSidechainRoute', 'routeId'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'addSidechainRoute', 'targetDeviceId'>>().toEqualTypeOf<true>();
        expectTypeOf<PayloadHasKey<'removeSidechainRoute', 'routeId'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'removeSidechainRoute', 'gain'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'quantizeNotes', 'strength'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'quantizeNotes', 'swing'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'removeShortMidiOverlaps', 'expectedTempo'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'removeShortMidiOverlaps', 'expectedTrackId'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'removeShortMidiOverlaps', 'trackName'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'removeShortMidiOverlaps', 'expectedTrackFrozen'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'removeShortMidiOverlaps', 'clipName'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'removeShortMidiOverlaps', 'expectedClipLocked'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'removeShortMidiOverlaps', 'expectedNotes'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'copyMidiArticulations', 'notePairs'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'copyMidiArticulations', 'trackId'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'copyMidiArticulations', 'expectedSourceNotes'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'copyMidiArticulations', 'expectedTargetNotes'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'copyMidiArticulations', 'expectedTrackFrozen'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'copyMidiArticulations', 'expectedSourceClipLocked'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'copyMidiArticulations', 'expectedTargetClipLocked'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'createDrumPreviewBranches', 'candidates'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'createDrumPreviewBranches', 'expectedDocuments'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'scaleAutomation', 'anchor'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'stretchAutomation', 'anchorBeat'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'createVcaGroup', 'vcaGroupId'>>().toEqualTypeOf<false>();
        expectTypeOf<RuntimeAddNotesNoteHasId>().toEqualTypeOf<false>();
        expectTypeOf<EmptyCollabSessionPayloadAllowed>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'lockClip', 'expectedLocked'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'muteClip', 'expectedMuted'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'setClipColor', 'expectedColor'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'setClipFade', 'expectedFadeInBeats'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'setClipFade', 'expectedFadeOutBeats'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'glueClips', 'targetClipId'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'glueClips', 'expected'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'glueClips', 'replacement'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'setPunchEnabled', 'expectedEnabled'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'addAdjustmentRegion', 'regionId'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'addAdjustmentRegion', 'expectedLayer'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'addAdjustmentRegion', 'expectedTracks'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'muteTrack', 'expectedMuted'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'setTrackGain', 'expectedGain'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'setTrackPan', 'expectedPan'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'automateTrackGainRange', 'sectionId'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'automateTrackGainRange', 'expectedTracks'>>().toEqualTypeOf<false>();
    });
});
