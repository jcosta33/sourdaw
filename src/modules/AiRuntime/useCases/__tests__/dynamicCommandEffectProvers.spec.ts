import { afterEach, describe, expect, it } from 'vitest';

import { midiStore } from '#/modules/MIDI/stores';
import { type AppAction, type AppActionType } from '#/utils/handlerContract';

import { automationTransformByActionType } from '../../models/AutomationTransformByActionType';
import { dynamicEffectProofKindByActionType } from '../../models/DynamicEffectProofKindByActionType';
import { type ProjectContext } from '../../models/ProjectContext';
import { proveDynamicCommandEffects } from '../dynamicCommandEffectProvers';

const baseContext: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 16,
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

function isAppActionType(value: string): value is AppActionType {
    return Object.hasOwn(dynamicEffectProofKindByActionType, value);
}

describe('dynamic command effect provers', () => {
    afterEach(() => {
        midiStore.set(null);
    });

    it('maps exactly these action types to their proof kind', () => {
        const actionTypes = Object.keys(dynamicEffectProofKindByActionType).filter(isAppActionType);
        const provenTypes = actionTypes.filter((type) => dynamicEffectProofKindByActionType[type] !== 'none');
        const pairs = provenTypes.map((type) => [type, dynamicEffectProofKindByActionType[type]]);
        const proven = pairs.sort();

        expect(proven).toEqual([
            ['clearSolos', 'clearSolos'],
            ['duplicateClip', 'duplicateClip'],
            ['duplicateClipToNextBar', 'duplicateClip'],
            ['duplicateTrack', 'duplicateTrack'],
            ['invertAutomation', 'automationLaneRewrite'],
            ['quantizeAutomation', 'automationLaneRewrite'],
            ['removeClip', 'removeClip'],
            ['removeTrack', 'removeTrack'],
            ['reverseAutomation', 'automationLaneRewrite'],
            ['scaleAutomation', 'automationLaneRewrite'],
            ['stretchAutomation', 'automationLaneRewrite'],
            ['thinAutomation', 'automationLaneRewrite'],
        ]);
    });

    it('proves automation lane rewrites for exactly the types the transform record marks', () => {
        const actionTypes = Object.keys(dynamicEffectProofKindByActionType).filter(isAppActionType);
        const proven = actionTypes
            .filter((type) => dynamicEffectProofKindByActionType[type] === 'automationLaneRewrite')
            .sort();
        const transforms = actionTypes.filter((type) => automationTransformByActionType[type]).sort();

        expect(proven).toEqual(transforms);
    });

    it('proves nothing for an untrusted inherited action type', () => {
        const action: AppAction = JSON.parse('{"type":"constructor","payload":{}}');
        const effects = {
            affectedTrackIds: new Set<string>(),
            affectedClipIds: new Set<string>(),
            affectedTargetIds: new Set<string>(),
            automationPoints: 0,
            deletedObjects: 0,
        };

        expect(Object.hasOwn(dynamicEffectProofKindByActionType, action.type)).toBe(false);
        expect(() =>
            proveDynamicCommandEffects({
                actionType: action.type,
                context: baseContext,
                payload: {},
                protectedTargetIds: undefined,
                effects,
            })
        ).not.toThrow();
        expect(effects.affectedTrackIds.size).toBe(0);
    });

    it('counts a removed clip holding hundreds of thousands of MIDI notes', () => {
        const noteCount = 250_000;
        const notes = Array.from({ length: noteCount }, (_, index) => ({
            id: `note-${index}`,
            pitch: 60,
            startBeat: 0,
            duration: 1,
            velocity: 100,
        }));
        midiStore.set({ notesByClipId: { 'clip-big': notes }, ccByClipId: {}, pitchBendByClipId: {} });
        const effects = {
            affectedTrackIds: new Set<string>(),
            affectedClipIds: new Set<string>(),
            affectedTargetIds: new Set<string>(),
            automationPoints: 0,
            deletedObjects: 0,
        };
        const track: ProjectContext['tracks'][number] = {
            id: 'track-1',
            name: 'track-1',
            kind: 'audio',
            muted: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            gain: 0.8,
            pan: 0,
            automationMode: 'read',
            clipCount: 1,
            deviceCount: 0,
            clips: [{ id: 'clip-big', name: 'Big', type: 'midi', startBeat: 0, endBeat: 4, noteCount }],
            devices: [],
        };

        proveDynamicCommandEffects({
            actionType: 'removeClip',
            context: { ...baseContext, tracks: [track] },
            payload: { clipId: 'clip-big' },
            protectedTargetIds: undefined,
            effects,
        });

        expect(effects.deletedObjects).toBe(noteCount);
        expect(effects.affectedTargetIds.size).toBe(noteCount);
    });
});
