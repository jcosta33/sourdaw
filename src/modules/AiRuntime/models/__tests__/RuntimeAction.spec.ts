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

        expect(RUNTIME_ACTION_TYPES).toHaveLength(239);
        expect(new Set(RUNTIME_ACTION_TYPES).size).toBe(RUNTIME_ACTION_TYPES.length);
        expect(RUNTIME_ACTION_TYPES).not.toContain('replayGeneratedMidi');
        expect(digest >>> 0).toBe(3_627_151_884);
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
        ]);
        expectTypeOf<PayloadHasKey<'duplicateClip', 'targetClipId'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'addAutomationLane', 'laneId'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'addAutomationPoint', 'pointId'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'removeAutomationPoint', 'pointId'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'setAutomationMode', 'expectedMode'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'addSidechainRoute', 'routeId'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'addSidechainRoute', 'targetDeviceId'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'removeSidechainRoute', 'routeId'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'removeSidechainRoute', 'gain'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'quantizeNotes', 'strength'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'quantizeNotes', 'swing'>>().toEqualTypeOf<false>();
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
    });
});
