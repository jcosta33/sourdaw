import { describe, expect, expectTypeOf, it } from 'vitest';

import { getExecutableAppActionToolSchemas } from '#/modules/Command/useCases';
import { FADER_MAX_GAIN, VCA_MAX_GAIN } from '#/utils/audioLevelLaw';

import { type RuntimeAction, type RuntimeActionType } from '../../models/RuntimeAction';
import { PAYLOAD_VALIDATORS } from '../validateActionPayload';
import { validateActions } from '../validateActions';

type PayloadOf<ActionType extends RuntimeActionType> =
    Extract<RuntimeAction, { type: ActionType }> extends { payload: infer Payload } ? Payload : undefined;

type GuardedPayloadCase<ActionType extends RuntimeActionType> = {
    actionType: ActionType;
    validPayload: PayloadOf<ActionType>;
    invalidPayloads: readonly unknown[];
};

function guardedPayloadCase<ActionType extends RuntimeActionType>(
    payloadCase: GuardedPayloadCase<ActionType>
): GuardedPayloadCase<ActionType> {
    return payloadCase;
}

const guardedPayloadContractCases = [
    guardedPayloadCase({
        actionType: 'armTrack',
        validPayload: { trackId: 'track-1', armed: true },
        invalidPayloads: [
            { trackId: '', armed: true },
            { trackId: 'track-1', armed: 'yes' },
            { trackId: 'track-1' },
            { trackId: 'track-1', armed: true, extra: true },
            { trackId: 'track-1', armed: true, midiInputTrackId: null },
            { trackId: 'track-1', armed: true, expectedMidiInputTrackId: 'track-1' },
            { trackId: 'track-1', armed: true, midiInputOwnerId: 'owner-1' },
            { trackId: 'track-1', armed: true, expectedMidiInputOwnerId: 'owner-1' },
        ],
    }),
    guardedPayloadCase({
        actionType: 'setSoloSafe',
        validPayload: { trackId: 'track-1', soloSafe: true },
        invalidPayloads: [
            { trackId: '', soloSafe: true },
            { trackId: 'track-1', soloSafe: 'yes' },
            { trackId: 'track-1' },
            { trackId: 'track-1', soloSafe: true, expected: false },
        ],
    }),
    guardedPayloadCase({
        actionType: 'clearSolos',
        validPayload: undefined,
        invalidPayloads: [{}, null, { trackId: 'track-1' }],
    }),
    guardedPayloadCase({
        actionType: 'muteTrack',
        validPayload: { trackId: 'track-1', muted: true },
        invalidPayloads: [
            { trackId: '', muted: true },
            { trackId: 'track-1', muted: 'yes' },
            { trackId: 'track-1' },
            { trackId: 'track-1', muted: true, expectedMuted: false },
            { trackId: 'track-1', muted: true, extra: true },
            Object.assign({ trackId: 'track-1', muted: true }, { [Symbol('extra')]: true }),
        ],
    }),
    guardedPayloadCase({
        actionType: 'soloTrack',
        validPayload: { trackId: 'track-1', soloed: false },
        invalidPayloads: [
            { trackId: '', soloed: false },
            { trackId: 'track-1', soloed: 0 },
            { trackId: 'track-1' },
            { trackId: 'track-1', soloed: false, extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'reorderTrack',
        validPayload: { trackId: 'track-1', newIndex: 0 },
        invalidPayloads: [
            { trackId: '', newIndex: 0 },
            { trackId: 'track-1', newIndex: -1 },
            { trackId: 'track-1', newIndex: 1.5 },
            { trackId: 'track-1', newIndex: Number.NaN },
            { trackId: 'track-1', newIndex: Number.POSITIVE_INFINITY },
            { trackId: 'track-1', newIndex: 0, extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'setTrackGain',
        validPayload: { trackId: 'track-1', gain: 1 },
        invalidPayloads: [
            { trackId: '', gain: 1 },
            { trackId: 'track-1', gain: -0.01 },
            { trackId: 'track-1', gain: FADER_MAX_GAIN + 0.01 },
            { trackId: 'track-1', gain: Number.NaN },
            { trackId: 'track-1', gain: Number.POSITIVE_INFINITY },
            { trackId: 'track-1', gain: 1, expectedGain: 0.5 },
            { trackId: 'track-1', gain: 1, extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'setTrackPan',
        validPayload: { trackId: 'track-1', pan: -50 },
        invalidPayloads: [
            { trackId: '', pan: 0 },
            { trackId: 'track-1', pan: -50.01 },
            { trackId: 'track-1', pan: 50.01 },
            { trackId: 'track-1', pan: Number.NaN },
            { trackId: 'track-1', pan: Number.NEGATIVE_INFINITY },
            { trackId: 'track-1', pan: Number.POSITIVE_INFINITY },
            { trackId: 'track-1', pan: 0, expectedPan: 12 },
            { trackId: 'track-1', pan: 0, extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'setTrackColor',
        validPayload: { trackId: 'track-1', color: '#Aa00Ff' },
        invalidPayloads: [
            { trackId: '', color: '#aa00ff' },
            { trackId: 'track-1', color: 'purple' },
            { trackId: 'track-1', color: '#a0f' },
            { trackId: 'track-1', color: '#gg00ff' },
            { trackId: 'track-1', color: '#aa00ff', extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'setTrackOutput',
        validPayload: { trackId: 'track-1', outputId: 'bus-1', expectedOutputId: 'master' },
        invalidPayloads: [
            { trackId: '', outputId: 'bus-1' },
            { trackId: 'track-1', outputId: '' },
            { trackId: 'track-1', outputId: 'track-1' },
            { trackId: 'track-1', outputId: 'bus-1', expectedOutputId: '' },
            { trackId: 'track-1', outputId: 'bus-1', expectedOutputId: 1 },
            Object.assign(Object.create({ expectedOutputId: 'master' }), {
                trackId: 'track-1',
                outputId: 'bus-1',
            }),
            { trackId: 'track-1', outputId: 'bus-1', extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'bypassDevice',
        validPayload: { deviceId: 'device-1', bypassed: true },
        invalidPayloads: [
            { deviceId: '', bypassed: true },
            { deviceId: 'device-1', bypassed: 'yes' },
            { deviceId: 'device-1' },
            { deviceId: 'device-1', bypassed: true, extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'removeDevice',
        validPayload: {
            deviceId: 'device-1',
            expectedTrackId: 'track-1',
            expectedDeviceIds: ['eq-1', 'device-1'],
        },
        invalidPayloads: [
            { deviceId: '' },
            { deviceId: 'device-1', expectedTrackId: '' },
            { deviceId: 'device-1', expectedDeviceIds: [''] },
            { deviceId: 'device-1', expectedDeviceIds: [1] },
            { deviceId: 'device-1', extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'setSend',
        validPayload: {
            trackId: 'track-1',
            busId: 'bus-1',
            level: 1,
            expectedLevel: 0,
            expectedPreFader: false,
        },
        invalidPayloads: [
            { trackId: '', busId: 'bus-1', level: 0.5 },
            { trackId: 'track-1', busId: '', level: 0.5 },
            { trackId: 'track-1', busId: 'track-1', level: 0.5 },
            { trackId: 'track-1', busId: 'bus-1', level: -0.01 },
            { trackId: 'track-1', busId: 'bus-1', level: 1.01 },
            { trackId: 'track-1', busId: 'bus-1', level: Number.NaN },
            { trackId: 'track-1', busId: 'bus-1', level: Number.POSITIVE_INFINITY },
            { trackId: 'track-1', busId: 'bus-1', level: 0.5, expectedLevel: 1.01 },
            { trackId: 'track-1', busId: 'bus-1', level: 0.5, expectedLevel: Number.NaN },
            { trackId: 'track-1', busId: 'bus-1', level: 0.5, expectedPreFader: 'yes' },
            Object.assign(Object.create({ expectedLevel: 0.25 }), {
                trackId: 'track-1',
                busId: 'bus-1',
                level: 0.5,
            }),
            Object.assign(Object.create({ expectedPreFader: true }), {
                trackId: 'track-1',
                busId: 'bus-1',
                level: 0.5,
            }),
            Object.assign({ trackId: 'track-1', busId: 'bus-1', level: 0.5 }, { [Symbol('extra')]: true }),
            { trackId: 'track-1', busId: 'bus-1', level: 0.5, extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'addSend',
        validPayload: {
            trackId: 'track-1',
            busId: 'bus-1',
            level: 0,
            preFader: true,
            expectedAbsent: true,
        },
        invalidPayloads: [
            { trackId: '', busId: 'bus-1', level: 0.5 },
            { trackId: 'track-1', busId: '', level: 0.5 },
            { trackId: 'track-1', busId: 'track-1', level: 0.5 },
            { trackId: 'track-1', busId: 'bus-1', level: -0.01 },
            { trackId: 'track-1', busId: 'bus-1', level: 1.01 },
            { trackId: 'track-1', busId: 'bus-1', level: Number.NaN },
            { trackId: 'track-1', busId: 'bus-1', level: Number.NEGATIVE_INFINITY },
            { trackId: 'track-1', busId: 'bus-1', level: 0.5, preFader: 'yes' },
            { trackId: 'track-1', busId: 'bus-1', level: 0.5, expectedAbsent: false },
            Object.assign(Object.create({ preFader: true }), {
                trackId: 'track-1',
                busId: 'bus-1',
                level: 0.5,
            }),
            Object.assign(Object.create({ expectedAbsent: true }), {
                trackId: 'track-1',
                busId: 'bus-1',
                level: 0.5,
            }),
            { trackId: 'track-1', busId: 'bus-1', level: 0.5, extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'removeSend',
        validPayload: {
            trackId: 'track-1',
            busId: 'bus-1',
            expectedLevel: 0,
            expectedPreFader: true,
        },
        invalidPayloads: [
            { trackId: '', busId: 'bus-1' },
            { trackId: 'track-1', busId: '' },
            { trackId: 'track-1', busId: 'track-1' },
            { trackId: 'track-1', busId: 'bus-1', expectedLevel: -0.01 },
            { trackId: 'track-1', busId: 'bus-1', expectedLevel: 1.01 },
            { trackId: 'track-1', busId: 'bus-1', expectedLevel: Number.NaN },
            { trackId: 'track-1', busId: 'bus-1', expectedLevel: Number.POSITIVE_INFINITY },
            { trackId: 'track-1', busId: 'bus-1', expectedPreFader: 'yes' },
            Object.assign(Object.create({ expectedLevel: 0.25 }), {
                trackId: 'track-1',
                busId: 'bus-1',
            }),
            Object.assign(Object.create({ expectedPreFader: true }), {
                trackId: 'track-1',
                busId: 'bus-1',
            }),
            { trackId: 'track-1', busId: 'bus-1', extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'setMasterGain',
        validPayload: { gain: 0.65 },
        invalidPayloads: [
            {},
            { gain: -0.01 },
            { gain: FADER_MAX_GAIN + 0.01 },
            { gain: Number.NaN },
            { gain: 0.65, extra: true },
        ],
    }),

    guardedPayloadCase({
        actionType: 'addDevice',
        validPayload: { trackId: 'track-1', deviceType: 'builtin-eq' },
        invalidPayloads: [
            { trackId: '', deviceType: 'builtin-eq' },
            { trackId: 'track-1', deviceType: '' },
            { trackId: 'track-1' },
            { deviceType: 'builtin-eq' },
            { trackId: 'track-1', deviceType: 'builtin-eq', deviceId: 'internal-id' },
        ],
    }),
    guardedPayloadCase({
        actionType: 'removeDevice',
        validPayload: { deviceId: 'device-1' },
        invalidPayloads: [{ deviceId: '' }, {}, { deviceId: 1 }, { deviceId: 'device-1', trackId: 'track-1' }],
    }),
    guardedPayloadCase({
        actionType: 'createBus',
        validPayload: { name: 'Parallel Reverb' },
        invalidPayloads: [
            { name: '' },
            { name: 42 },
            {},
            { name: 'x'.repeat(121) },
            { name: 'Bad <bus>' },
            { name: 'Bad\u0000Bus' },
            { name: 'Parallel Reverb', busId: 'internal-id' },
        ],
    }),
    guardedPayloadCase({
        actionType: 'duplicateClip',
        validPayload: { clipId: 'clip-1' },
        invalidPayloads: [
            { clipId: '' },
            {},
            { clipId: 1 },
            { clipId: 'clip-1', extra: true },
            { clipId: 'clip-1', targetClipId: 'internal-copy-id' },
        ],
    }),
    guardedPayloadCase({
        actionType: 'duplicateClipToNextBar',
        validPayload: { clipId: 'clip-1' },
        invalidPayloads: [
            { clipId: '' },
            {},
            { clipId: 1 },
            { clipId: 'clip-1', extra: true },
            { clipId: 'clip-1', targetClipId: 'internal-copy-id' },
        ],
    }),
    guardedPayloadCase({
        actionType: 'removeClip',
        validPayload: { clipId: 'clip-1' },
        invalidPayloads: [{ clipId: '' }, {}, { clipId: 1 }, { clipId: 'clip-1', extra: true }],
    }),
    guardedPayloadCase({
        actionType: 'renameClip',
        validPayload: { clipId: 'clip-1', name: 'Verse Lead' },
        invalidPayloads: [
            { clipId: '', name: 'Verse Lead' },
            { clipId: 'clip-1', name: '' },
            { clipId: 'clip-1', name: 1 },
            { clipId: 'clip-1', name: 'Verse Lead', extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'trimClipStart',
        validPayload: { clipId: 'clip-1', newStartBeat: 1 },
        invalidPayloads: [
            { clipId: '', newStartBeat: 1 },
            { clipId: 'clip-1', newStartBeat: -0.01 },
            { clipId: 'clip-1', newStartBeat: Number.NaN },
            { clipId: 'clip-1', newStartBeat: Number.POSITIVE_INFINITY },
            { clipId: 'clip-1', newStartBeat: 1, extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'trimClipEnd',
        validPayload: { clipId: 'clip-1', newEndBeat: 2 },
        invalidPayloads: [
            { clipId: '', newEndBeat: 2 },
            { clipId: 'clip-1', newEndBeat: 0 },
            { clipId: 'clip-1', newEndBeat: Number.NaN },
            { clipId: 'clip-1', newEndBeat: Number.NEGATIVE_INFINITY },
            { clipId: 'clip-1', newEndBeat: 2, extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'nudgeClip',
        validPayload: { clipId: 'clip-1', beats: -0.25 },
        invalidPayloads: [
            { clipId: '', beats: 0.25 },
            { clipId: 'clip-1' },
            { clipId: 'clip-1', beats: 0 },
            { clipId: 'clip-1', beats: Number.NaN },
            { clipId: 'clip-1', beats: Number.POSITIVE_INFINITY },
            { clipId: 'clip-1', beats: 0.25, extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'crossfadeClips',
        validPayload: { clipAId: 'clip-a', clipBId: 'clip-b' },
        invalidPayloads: [
            { clipAId: '', clipBId: 'clip-b' },
            { clipAId: 'clip-a', clipBId: '' },
            { clipAId: 'clip-a', clipBId: 'clip-a' },
            { clipAId: 'clip-a', clipBId: 'clip-b', durationBeats: -0.01 },
            { clipAId: 'clip-a', clipBId: 'clip-b', durationBeats: Number.NaN },
            { clipAId: 'clip-a', clipBId: 'clip-b', extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'setClipGain',
        validPayload: { clipId: 'clip-1', gain: 1.25 },
        invalidPayloads: [
            { clipId: '', gain: 1 },
            { clipId: 'clip-1', gain: -0.01 },
            { clipId: 'clip-1', gain: 2.01 },
            { clipId: 'clip-1', gain: Number.NaN },
            { clipId: 'clip-1', gain: 1, extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'muteClip',
        validPayload: { clipId: 'clip-1', muted: true },
        invalidPayloads: [
            { clipId: '', muted: true },
            { clipId: 'clip-1', muted: 'yes' },
            { clipId: 'clip-1', muted: true, expectedMuted: false },
        ],
    }),
    guardedPayloadCase({
        actionType: 'setClipColor',
        validPayload: { clipId: 'clip-1', color: '#ff5500' },
        invalidPayloads: [
            { clipId: '', color: '#ff5500' },
            { clipId: 'clip-1', color: 'red' },
            { clipId: 'clip-1', color: '#ff5500', expectedColor: '#000000' },
        ],
    }),
    guardedPayloadCase({
        actionType: 'setClipFade',
        validPayload: { clipId: 'clip-1', fadeInBeats: 1, fadeOutBeats: 2 },
        invalidPayloads: [
            { clipId: '', fadeInBeats: 1, fadeOutBeats: 2 },
            { clipId: 'clip-1', fadeInBeats: -1, fadeOutBeats: 2 },
            { clipId: 'clip-1', fadeInBeats: 1, fadeOutBeats: Number.POSITIVE_INFINITY },
            {
                clipId: 'clip-1',
                fadeInBeats: 1,
                fadeOutBeats: 2,
                expectedFadeInBeats: 0,
                expectedFadeOutBeats: 0,
            },
        ],
    }),
    guardedPayloadCase({
        actionType: 'lockClip',
        validPayload: { clipId: 'clip-1', locked: true },
        invalidPayloads: [
            { clipId: '', locked: true },
            { clipId: 'clip-1', locked: 1 },
            { clipId: 'clip-1', locked: true, expectedLocked: false },
        ],
    }),
    guardedPayloadCase({
        actionType: 'setClipLoop',
        validPayload: { clipId: 'clip-1', enabled: true },
        invalidPayloads: [
            { clipId: '', enabled: true },
            { clipId: 'clip-1', enabled: 'yes' },
            { clipId: 'clip-1', enabled: true, expectedEnabled: false },
        ],
    }),
    guardedPayloadCase({
        actionType: 'setClipLoopLength',
        validPayload: { clipId: 'clip-1', loopLength: 4 },
        invalidPayloads: [
            { clipId: '', loopLength: 4 },
            { clipId: 'clip-1', loopLength: 0 },
            { clipId: 'clip-1', loopLength: Number.NaN },
            { clipId: 'clip-1', loopLength: Number.POSITIVE_INFINITY },
            { clipId: 'clip-1', loopLength: 4, extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'normalizeClip',
        validPayload: { clipId: 'clip-1', mode: 'lufs', targetDb: -14 },
        invalidPayloads: [
            { clipId: '' },
            { clipId: 'clip-1', mode: 'momentary' },
            { clipId: 'clip-1', mode: 'peak', targetDb: -14 },
            { clipId: 'clip-1', mode: 'lufs', targetDb: -60.01 },
            { clipId: 'clip-1', mode: 'rms', targetDb: 0.01 },
            { clipId: 'clip-1', mode: 'lufs', targetDb: Number.NaN },
            { clipId: 'clip-1', mode: 'lufs', targetDb: -14, extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'glueClips',
        validPayload: { clipIds: ['clip-1', 'clip-2'] },
        invalidPayloads: [
            { clipIds: [] },
            { clipIds: ['clip-1'] },
            { clipIds: ['clip-1', 'clip-2', 'clip-3'] },
            { clipIds: ['clip-1', 'clip-1'] },
            { clipIds: ['clip-1', ''] },
            { clipIds: ['clip-1', 2] },
            { clipIds: ['clip-1', 'clip-2'], extra: true },
            null,
        ],
    }),
    guardedPayloadCase({
        actionType: 'setClipStretchMode',
        validPayload: { clipId: 'clip-1', mode: 'timestretch' },
        invalidPayloads: [
            { clipId: '', mode: 'timestretch' },
            { clipId: 'clip-1' },
            { clipId: 'clip-1', mode: 'elastic' },
            { clipId: 'clip-1', mode: 'repitch', extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'setClipStretchRatio',
        validPayload: { clipId: 'clip-1', ratio: 1.5 },
        invalidPayloads: [
            { clipId: '', ratio: 1.5 },
            { clipId: 'clip-1' },
            { clipId: 'clip-1', ratio: 0.249 },
            { clipId: 'clip-1', ratio: 4.001 },
            { clipId: 'clip-1', ratio: Number.NaN },
            { clipId: 'clip-1', ratio: 1.5, extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'fitClipToBeats',
        validPayload: { clipId: 'clip-1', targetBeats: 8 },
        invalidPayloads: [
            { clipId: '', targetBeats: 8 },
            { clipId: 'clip-1' },
            { clipId: 'clip-1', targetBeats: 0 },
            { clipId: 'clip-1', targetBeats: -1 },
            { clipId: 'clip-1', targetBeats: Number.NaN },
            { clipId: 'clip-1', targetBeats: Number.NEGATIVE_INFINITY },
            { clipId: 'clip-1', targetBeats: Number.POSITIVE_INFINITY },
            { clipId: 'clip-1', targetBeats: '8' },
            { clipId: 'clip-1', targetBeats: 8, extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'splitClip',
        validPayload: { clipId: 'clip-1', beat: 4 },
        invalidPayloads: [
            { clipId: 'clip-1', splitBeat: 4 },
            { clipId: 'clip-1' },
            { clipId: '', beat: 4 },
            { clipId: 1, beat: 4 },
            { clipId: 'clip-1', beat: -1 },
            { clipId: 'clip-1', beat: Number.NaN },
            { clipId: 'clip-1', beat: Number.NEGATIVE_INFINITY },
            { clipId: 'clip-1', beat: Number.POSITIVE_INFINITY },
            { clipId: 'clip-1', beat: '4' },
            { clipId: 'clip-1', beat: 4, extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'moveClip',
        validPayload: { clipId: 'clip-1', trackId: 'track-2', startBeat: 8 },
        invalidPayloads: [
            { clipId: 'clip-1', newTrackId: 'track-2', newStartBeat: 8 },
            { clipId: 'clip-1', trackId: 'track-2' },
            { clipId: '', trackId: 'track-2', startBeat: 8 },
            { clipId: 'clip-1', trackId: '', startBeat: 8 },
            { clipId: 'clip-1', trackId: 2, startBeat: 8 },
            { clipId: 'clip-1', trackId: 'track-2', startBeat: -1 },
            { clipId: 'clip-1', trackId: 'track-2', startBeat: Number.NaN },
            { clipId: 'clip-1', trackId: 'track-2', startBeat: Number.POSITIVE_INFINITY },
            { clipId: 'clip-1', trackId: 'track-2', startBeat: '8' },
            { clipId: 'clip-1', trackId: 'track-2', startBeat: 8, extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'setDeviceParameter',
        validPayload: {
            deviceId: 'device-1',
            paramId: 'gain',
            value: 0.75,
            expectedTrackFrozen: false,
        },
        invalidPayloads: [
            { trackId: 'track-1', deviceId: 'device-1', paramId: 'gain' },
            { deviceId: 'device-1', paramId: 'gain' },
            { deviceId: '', paramId: 'gain', value: 0.75 },
            { deviceId: 'device-1', paramId: '', value: 0.75 },
            { deviceId: 'device-1', paramId: 1, value: 0.75 },
            { deviceId: 'device-1', paramId: 'gain', value: Number.NaN },
            { deviceId: 'device-1', paramId: 'gain', value: Number.POSITIVE_INFINITY },
            { deviceId: 'device-1', paramId: 'gain', value: 0.75, expectedTrackFrozen: 'false' },
            { deviceId: 'device-1', paramId: 'gain', value: 0.75, providerOwnedGuard: 0.5 },
        ],
    }),
    guardedPayloadCase({
        actionType: 'createVcaGroup',
        validPayload: { name: 'Drums', trackIds: ['track-1', 'track-2'] },
        invalidPayloads: [
            { name: '', trackIds: ['track-1'] },
            { name: 'Drums', trackIds: ['track-1', 'track-1'] },
            { name: 'Drums', trackIds: [''] },
            { name: 'Drums', trackIds: 'track-1' },
            { name: 'Drums', trackIds: [], extra: true },
            { name: 'Drums', trackIds: [], vcaGroupId: 'command-only-replay-id' },
        ],
    }),
    guardedPayloadCase({
        actionType: 'assignToVca',
        validPayload: { trackId: 'track-1', vcaGroupId: 'vca-1' },
        invalidPayloads: [
            { trackId: '', vcaGroupId: 'vca-1' },
            { trackId: 'track-1', vcaGroupId: '' },
            { trackId: 'track-1' },
            { trackId: 'track-1', vcaGroupId: 'vca-1', extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'removeFromVca',
        validPayload: { trackId: 'track-1' },
        invalidPayloads: [{ trackId: '' }, {}, { trackId: 'track-1', extra: true }],
    }),
    guardedPayloadCase({
        actionType: 'setVcaGain',
        validPayload: { vcaGroupId: 'vca-1', gain: 1.25 },
        invalidPayloads: [
            { vcaGroupId: '', gain: 1 },
            { vcaGroupId: 'vca-1', gain: -0.01 },
            // #2350 gap 2: the ceiling is `VCA_MAX_GAIN`, a named constant
            // distinct from `FADER_MAX_GAIN` (a VCA multiplier is pre-fold, not
            // a fader position) — asserted against the constant, not a bare
            // `2.01`, so this survives a future change to either headroom.
            { vcaGroupId: 'vca-1', gain: VCA_MAX_GAIN + 0.01 },
            { vcaGroupId: 'vca-1', gain: Number.NaN },
            { vcaGroupId: 'vca-1', gain: 1, extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'setLoopEnabled',
        validPayload: { enabled: true },
        invalidPayloads: [{}, { enabled: 'yes' }, { enabled: true, extra: true }],
    }),
    guardedPayloadCase({
        actionType: 'setPunchEnabled',
        validPayload: { enabled: true },
        invalidPayloads: [
            {},
            { enabled: 'yes' },
            { enabled: true, extra: true },
            { enabled: true, expectedEnabled: false },
        ],
    }),
    guardedPayloadCase({
        actionType: 'setPlayback',
        validPayload: { playing: true },
        invalidPayloads: [{}, { playing: 'yes' }, { playing: true, extra: true }],
    }),
    guardedPayloadCase({
        actionType: 'stopPlayback',
        validPayload: undefined,
        invalidPayloads: [{}, null, false, { reason: 'provider supplied data' }],
    }),
    guardedPayloadCase({
        actionType: 'seekPlayhead',
        validPayload: { beat: 8.5 },
        invalidPayloads: [
            {},
            { beat: -0.01 },
            { beat: '8' },
            { beat: Number.NaN },
            { beat: Number.POSITIVE_INFINITY },
            { beat: 8, extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'addMarker',
        validPayload: { beat: 16, name: 'Chorus' },
        invalidPayloads: [
            {},
            { beat: -0.01, name: 'Chorus' },
            { beat: Number.NaN, name: 'Chorus' },
            { beat: 16, name: '' },
            { beat: 16, name: '   ' },
            { beat: 16, name: '<Chorus>' },
            { beat: 16, name: 'x'.repeat(121) },
            { beat: 16, name: 'Chorus', markerId: 'provider-owned-id' },
            { beat: 16, name: 'Chorus', extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'removeMarker',
        validPayload: { markerId: 'marker-chorus' },
        invalidPayloads: [
            {},
            { markerId: '' },
            { markerId: '   ' },
            { markerId: 16 },
            { markerId: 'marker-chorus', extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'setMarkerColor',
        validPayload: { markerId: 'marker-chorus', color: 'oklch(0.40 0.08 70)' },
        invalidPayloads: [
            {},
            { markerId: '', color: 'oklch(0.40 0.08 70)' },
            { markerId: 'marker-chorus', color: '' },
            { markerId: 'marker-chorus', color: 70 },
            { markerId: 'marker-chorus', color: 'amber' },
            { markerId: 'marker-chorus', color: '#ff8800' },
            { markerId: 'marker-chorus', color: 'oklch(0.40 0.08)' },
            { markerId: 'marker-chorus', color: 'oklch(0.40 0.08 70)', extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'addSection',
        validPayload: { startBeat: 8, endBeat: 16, name: 'Verse' },
        invalidPayloads: [
            {},
            { startBeat: -1, endBeat: 16, name: 'Verse' },
            { startBeat: 16, endBeat: 8, name: 'Verse' },
            { startBeat: 8, endBeat: 8, name: 'Verse' },
            { startBeat: Number.NaN, endBeat: 16, name: 'Verse' },
            { startBeat: 8, endBeat: Number.POSITIVE_INFINITY, name: 'Verse' },
            { startBeat: 8, endBeat: 16, name: '' },
            { startBeat: 8, endBeat: 16, name: '<Verse>' },
            { startBeat: 8, endBeat: 16, name: 'Verse', sectionId: 'provider-id' },
            { startBeat: 8, endBeat: 16, name: 'Verse', color: '#fff' },
        ],
    }),
    guardedPayloadCase({
        actionType: 'removeSection',
        validPayload: { sectionId: 'section-verse' },
        invalidPayloads: [{}, { sectionId: '' }, { sectionId: 8 }, { sectionId: 'section-verse', extra: true }],
    }),
    guardedPayloadCase({
        actionType: 'renameSection',
        validPayload: { sectionId: 'section-verse', name: 'Pre-Chorus' },
        invalidPayloads: [
            {},
            { sectionId: '', name: 'Pre-Chorus' },
            { sectionId: 'section-verse', name: '' },
            { sectionId: 'section-verse', name: '<Pre-Chorus>' },
            { sectionId: 'section-verse', name: 'Pre-Chorus', extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'setLoopRegion',
        validPayload: { startBeat: 4, endBeat: 12 },
        invalidPayloads: [
            { startBeat: -0.01, endBeat: 12 },
            { startBeat: 4, endBeat: 4 },
            { startBeat: 12, endBeat: 4 },
            { startBeat: Number.NaN, endBeat: 12 },
            { startBeat: 4, endBeat: Number.POSITIVE_INFINITY },
            { startBeat: 4, endBeat: 12, extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'setMetronomeEnabled',
        validPayload: { enabled: false },
        invalidPayloads: [{}, { enabled: 1 }, { enabled: false, extra: true }],
    }),
    guardedPayloadCase({
        actionType: 'setMetronomeVolume',
        validPayload: { volume: 0.25 },
        invalidPayloads: [
            {},
            { volume: -0.01 },
            { volume: 1.01 },
            { volume: Number.NaN },
            { volume: Number.POSITIVE_INFINITY },
            { volume: 0.25, extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'addSidechainRoute',
        validPayload: { sourceTrackId: 'track-kick', targetTrackId: 'track-bass' },
        invalidPayloads: [
            { sourceTrackId: '', targetTrackId: 'track-bass' },
            { sourceTrackId: 'track-kick', targetTrackId: 'track-kick' },
            { sourceTrackId: 'track-kick', targetTrackId: 'track-bass', routeId: 'provider-owned' },
            { sourceTrackId: 'track-kick', targetTrackId: 'track-bass', targetParameterId: 'threshold' },
        ],
    }),
    guardedPayloadCase({
        actionType: 'removeSidechainRoute',
        validPayload: { sourceTrackId: 'track-kick', targetTrackId: 'track-bass' },
        invalidPayloads: [
            { routeId: 'route-kick-bass' },
            { sourceTrackId: 'track-kick', targetTrackId: '' },
            { sourceTrackId: 'track-kick', targetTrackId: 'track-kick' },
            { sourceTrackId: 'track-kick', targetTrackId: 'track-bass', gain: 1 },
        ],
    }),
    guardedPayloadCase({
        actionType: 'setAutomationMode',
        validPayload: { trackId: 'track-1', mode: 'touch' },
        invalidPayloads: [
            { trackId: '', mode: 'touch' },
            { trackId: 'track-1', mode: 'scribble' },
            { trackId: 'track-1', mode: 'touch', extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'scaleAutomation',
        validPayload: { laneId: 'lane-1', factor: 1.5 },
        invalidPayloads: [
            { laneId: '', factor: 1.5 },
            { laneId: 'lane-1', factor: 0 },
            { laneId: 'lane-1', factor: 17 },
            { laneId: 'lane-1', factor: Number.NaN },
            { laneId: 'lane-1', factor: 1.5, anchor: 0.5 },
        ],
    }),
    guardedPayloadCase({
        actionType: 'stretchAutomation',
        validPayload: { laneId: 'lane-1', factor: 2 },
        invalidPayloads: [
            { laneId: '', factor: 2 },
            { laneId: 'lane-1', factor: -1 },
            { laneId: 'lane-1', factor: Number.POSITIVE_INFINITY },
            { laneId: 'lane-1', factor: 2, anchorBeat: 4 },
        ],
    }),
    guardedPayloadCase({
        actionType: 'invertAutomation',
        validPayload: { laneId: 'lane-1' },
        invalidPayloads: [{ laneId: '' }, {}, { laneId: 'lane-1', extra: true }],
    }),
    guardedPayloadCase({
        actionType: 'reverseAutomation',
        validPayload: { laneId: 'lane-1' },
        invalidPayloads: [{ laneId: '' }, {}, { laneId: 'lane-1', extra: true }],
    }),
    guardedPayloadCase({
        actionType: 'thinAutomation',
        validPayload: { laneId: 'lane-1', tolerance: 0.01 },
        invalidPayloads: [
            { laneId: '' },
            { laneId: 'lane-1', tolerance: 0 },
            { laneId: 'lane-1', tolerance: Number.NaN },
            { laneId: 'lane-1', extra: true },
        ],
    }),
    guardedPayloadCase({
        actionType: 'quantizeAutomation',
        validPayload: { laneId: 'lane-1', gridSize: 0.25 },
        invalidPayloads: [
            { laneId: '', gridSize: 0.25 },
            { laneId: 'lane-1', gridSize: 0 },
            { laneId: 'lane-1', gridSize: 65 },
            { laneId: 'lane-1', gridSize: Number.NaN },
            { laneId: 'lane-1', gridSize: 0.25, extra: true },
        ],
    }),
] as const;

describe('validateActionPayload / PAYLOAD_VALIDATORS', () => {
    it('backs every executable app-action tool with a strict payload validator', () => {
        const uncheckedActionTypes = getExecutableAppActionToolSchemas()
            .map((schema) => schema.function.name)
            .filter((actionType) => PAYLOAD_VALIDATORS[actionType] === 'unchecked');

        expect(uncheckedActionTypes).toEqual([]);
    });

    describe('declared RuntimeAction payload contracts', () => {
        it.each(guardedPayloadContractCases)(
            'should accept valid $actionType payloads',
            ({ actionType, validPayload }) => {
                const guard = PAYLOAD_VALIDATORS[actionType];
                expect(guard).not.toBe('unchecked');
                if (guard === 'unchecked') {
                    return;
                }
                expect(guard(validPayload)).toBe(true);
            }
        );

        it.each(guardedPayloadContractCases)(
            'should reject malformed $actionType payloads',
            ({ actionType, invalidPayloads }) => {
                const guard = PAYLOAD_VALIDATORS[actionType];
                expect(guard).not.toBe('unchecked');
                if (guard === 'unchecked') {
                    return;
                }
                for (const invalidPayload of invalidPayloads) {
                    expect(guard(invalidPayload)).toBe(false);
                }
            }
        );
    });

    it.each([
        ['setTrackGain', { trackId: 'track-1', gain: 0 }],
        ['setTrackPan', { trackId: 'track-1', pan: 50 }],
        ['setTrackOutput', { trackId: 'track-1', outputId: 'master' }],
        ['setSend', { trackId: 'track-1', busId: 'bus-1', level: 0 }],
        ['addSend', { trackId: 'track-1', busId: 'bus-1', level: 1 }],
        ['removeSend', { trackId: 'track-1', busId: 'bus-1' }],
    ] as const)('accepts canonical %s payloads without optional freshness metadata', (actionType, payload) => {
        const guard = PAYLOAD_VALIDATORS[actionType];
        expect(guard).not.toBe('unchecked');
        if (guard === 'unchecked') {
            return;
        }

        expect(guard(payload)).toBe(true);
    });

    describe('gain ceiling reaches the fader headroom, not unity', () => {
        it.each([
            ['setTrackGain', { trackId: 'track-1', gain: 1.5 }],
            ['setMasterGain', { gain: 1.5 }],
        ] as const)('accepts %s at 1.5, above unity but under the fader ceiling', (actionType, payload) => {
            const guard = PAYLOAD_VALIDATORS[actionType];
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }

            expect(guard(payload)).toBe(true);
        });

        it.each([
            ['setTrackGain', { trackId: 'track-1', gain: FADER_MAX_GAIN + 0.01 }],
            ['setMasterGain', { gain: FADER_MAX_GAIN + 0.01 }],
        ] as const)('rejects %s past the fader ceiling', (actionType, payload) => {
            const guard = PAYLOAD_VALIDATORS[actionType];
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }

            expect(guard(payload)).toBe(false);
        });
    });

    it('accepts thinAutomation with its default tolerance omitted', () => {
        const guard = PAYLOAD_VALIDATORS.thinAutomation;
        expect(guard).not.toBe('unchecked');
        if (guard === 'unchecked') {
            return;
        }
        expect(guard({ laneId: 'lane-1' })).toBe(true);
    });

    it('accepts canonical peak normalization and an omitted RMS/LUFS target', () => {
        const guard = PAYLOAD_VALIDATORS.normalizeClip;
        expect(guard).not.toBe('unchecked');
        if (guard === 'unchecked') {
            return;
        }

        expect(guard({ clipId: 'clip-1' })).toBe(true);
        expect(guard({ clipId: 'clip-1', mode: 'rms' })).toBe(true);
        expect(guard({ clipId: 'clip-1', mode: 'lufs' })).toBe(true);
    });

    it('excludes internal MIDI routing metadata from the RuntimeAction type', () => {
        type ArmTrackPayload = Extract<RuntimeAction, { type: 'armTrack' }>['payload'];
        type ArmTrackHasMidiRoute = 'midiInputTrackId' extends keyof ArmTrackPayload ? true : false;
        type ArmTrackHasExpectedMidiRoute = 'expectedMidiInputTrackId' extends keyof ArmTrackPayload ? true : false;
        type ArmTrackHasMidiOwner = 'midiInputOwnerId' extends keyof ArmTrackPayload ? true : false;
        type ArmTrackHasExpectedMidiOwner = 'expectedMidiInputOwnerId' extends keyof ArmTrackPayload ? true : false;

        expectTypeOf<ArmTrackHasMidiRoute>().toEqualTypeOf<false>();
        expectTypeOf<ArmTrackHasExpectedMidiRoute>().toEqualTypeOf<false>();
        expectTypeOf<ArmTrackHasMidiOwner>().toEqualTypeOf<false>();
        expectTypeOf<ArmTrackHasExpectedMidiOwner>().toEqualTypeOf<false>();
    });

    it('excludes the command-owned bus identity from the RuntimeAction type', () => {
        type CreateBusPayload = Extract<RuntimeAction, { type: 'createBus' }>['payload'];
        type CreateBusHasIdentity = 'busId' extends keyof CreateBusPayload ? true : false;

        expectTypeOf<CreateBusHasIdentity>().toEqualTypeOf<false>();
    });

    describe('removeTrack', () => {
        it('should accept a payload with trackId string', () => {
            const guard = PAYLOAD_VALIDATORS.removeTrack;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }
            expect(guard({ trackId: 'track-1' })).toBe(true);
            expect(
                guard({
                    trackId: 'track-1',
                    expectedKind: 'audio',
                    expectedMuted: true,
                    expectedClipIds: [],
                    expectedAlternativeClipIds: ['clip-hidden'],
                    expectedVcaGroupId: null,
                    expectedVcaMembershipGroupIds: [],
                })
            ).toBe(true);
        });

        it('should reject invalid payloads', () => {
            const guard = PAYLOAD_VALIDATORS.removeTrack;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }
            expect(guard({})).toBe(false);
            expect(guard({ trackId: 1 })).toBe(false);
            expect(guard(null)).toBe(false);
            expect(guard({ trackId: '' })).toBe(false);
            expect(guard({ trackId: 'track-1', extra: true })).toBe(false);
            expect(guard({ trackId: 'track-1', expectedAlternativeClipIds: [1] })).toBe(false);
            expect(guard({ trackId: 'track-1', expectedVcaGroupId: '' })).toBe(false);
            expect(guard({ trackId: 'track-1', expectedVcaMembershipGroupIds: [1] })).toBe(false);
        });
    });

    describe('setTempo', () => {
        it('should accept bpm in 20–300', () => {
            const guard = PAYLOAD_VALIDATORS.setTempo;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }
            expect(guard({ bpm: 20 })).toBe(true);
            expect(guard({ bpm: 300 })).toBe(true);
            expect(guard({ bpm: 120 })).toBe(true);
        });

        it('should reject bpm outside range', () => {
            const guard = PAYLOAD_VALIDATORS.setTempo;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }
            expect(guard({ bpm: 19 })).toBe(false);
            expect(guard({ bpm: 301 })).toBe(false);
            expect(guard({ bpm: Number.NaN })).toBe(false);
        });

        it('should reject an AI-supplied tempoChangeId, which is internal undo routing', () => {
            const guard = PAYLOAD_VALIDATORS.setTempo;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }
            // Carrying an id lets a write name a tempo-map event directly. A model
            // must ask for a tempo at the playhead, not pick an event out of the map.
            expect(guard({ bpm: 120, tempoChangeId: 'tc-0' })).toBe(false);
        });
    });

    describe('addAutomationLane', () => {
        it('should accept the provider payload and reject replay-only lane identities', () => {
            const guard = PAYLOAD_VALIDATORS.addAutomationLane;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }

            const payload: Extract<RuntimeAction, { type: 'addAutomationLane' }>['payload'] = {
                trackId: 'track-1',
                parameterId: 'gain',
                parameterName: 'Gain',
            };
            expect(guard(payload)).toBe(true);
            expect(guard({ ...payload, laneId: 'auto-lane-1' })).toBe(false);
            expect(guard({ ...payload, laneId: '' })).toBe(false);
            expect(guard({ ...payload, laneId: 1 })).toBe(false);
            expect(guard({ ...payload, laneId: null })).toBe(false);
        });

        it('should require a string parameterName', () => {
            const guard = PAYLOAD_VALIDATORS.addAutomationLane;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }

            const payload = { trackId: 'track-1', parameterId: 'gain' };
            expect(guard(payload)).toBe(false);
            expect(guard({ ...payload, parameterName: 1 })).toBe(false);
            expect(guard({ ...payload, parameterName: null })).toBe(false);
        });

        it('should require exact non-empty provider fields', () => {
            const guard = PAYLOAD_VALIDATORS.addAutomationLane;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }

            const payload = { trackId: 'track-1', parameterId: 'gain', parameterName: 'Gain' };
            expect(guard({ ...payload, trackId: '' })).toBe(false);
            expect(guard({ ...payload, parameterId: '' })).toBe(false);
            expect(guard({ ...payload, parameterName: '' })).toBe(false);
            expect(guard({ ...payload, extra: true })).toBe(false);
        });

        it('should exclude the command-owned identity field and inverse action', () => {
            type AddAutomationLanePayload = Extract<RuntimeAction, { type: 'addAutomationLane' }>['payload'];
            type AddAutomationLaneHasLaneId = 'laneId' extends keyof AddAutomationLanePayload ? true : false;
            type RemoveAutomationLaneAction = Extract<RuntimeAction, { type: 'removeAutomationLane' }>;
            const inverse = [
                { type: 'removeAutomationLane', payload: { laneId: 'auto-lane-1' } },
            ] as unknown as RuntimeAction[];

            expect(validateActions(inverse)).toEqual([]);
            expectTypeOf<AddAutomationLaneHasLaneId>().toEqualTypeOf<false>();
            expectTypeOf<RemoveAutomationLaneAction>().toEqualTypeOf<never>();
        });
    });

    describe('addAutomationPoint', () => {
        it('should accept exact minimal and fully shaped point payloads', () => {
            const guard = PAYLOAD_VALIDATORS.addAutomationPoint;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }

            expect(guard({ laneId: 'lane-1', beat: 4, value: 0.5 })).toBe(true);
            expect(
                guard({
                    laneId: 'lane-1',
                    beat: 4,
                    value: 0.5,
                    curve: 'bezier',
                    tension: 0,
                    stairSteps: 4,
                    cp1: { x: 0.25, y: 0.5 },
                    cp2: { x: 0.75, y: 0.5 },
                })
            ).toBe(true);
        });

        it.each([
            ['empty lane id', { laneId: '', beat: 4, value: 0.5 }],
            ['negative beat', { laneId: 'lane-1', beat: -1, value: 0.5 }],
            ['unknown field', { laneId: 'lane-1', beat: 4, value: 0.5, extra: true }],
            ['internal point id', { laneId: 'lane-1', pointId: 'point-1', beat: 4, value: 0.5 }],
            ['unknown curve', { laneId: 'lane-1', beat: 4, value: 0.5, curve: 'arc' }],
            ['out-of-range tension', { laneId: 'lane-1', beat: 4, value: 0.5, tension: 2 }],
            ['fractional stair count', { laneId: 'lane-1', beat: 4, value: 0.5, stairSteps: 3.5 }],
            ['out-of-range control point', { laneId: 'lane-1', beat: 4, value: 0.5, cp1: { x: -1, y: 0.5 } }],
        ])('should reject %s', (_label, payload) => {
            const guard = PAYLOAD_VALIDATORS.addAutomationPoint;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }

            expect(guard(payload)).toBe(false);
        });
    });

    describe('removeAutomationPoint', () => {
        it('should validate the index-based command payload', () => {
            const guard = PAYLOAD_VALIDATORS.removeAutomationPoint;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }

            expect(guard({ laneId: 'lane-1', pointIndex: 0 })).toBe(true);
            expect(guard({ laneId: 'lane-1', pointIndex: -1 })).toBe(false);
            expect(guard({ laneId: 'lane-1', pointIndex: 0.5 })).toBe(false);
            expect(guard({ laneId: 'lane-1', beat: 4 })).toBe(false);
            expect(guard({ laneId: 'lane-1', pointIndex: 0, extra: true })).toBe(false);
            expect(guard({ laneId: 'lane-1', pointIndex: 0, pointId: 'point-1' })).toBe(false);
        });
    });

    describe('setAutomationLaneEnabled', () => {
        it('should require an exact lane id and enabled value', () => {
            const guard = Object.entries(PAYLOAD_VALIDATORS).find(
                ([actionType]) => actionType === 'setAutomationLaneEnabled'
            )?.[1];
            expect(guard).toBeTypeOf('function');
            if (typeof guard !== 'function') {
                return;
            }

            expect(guard({ laneId: 'lane-1', enabled: true })).toBe(true);
            expect(guard({ laneId: '', enabled: true })).toBe(false);
            expect(guard({ laneId: 'lane-1', enabled: 'yes' })).toBe(false);
            expect(guard({ laneId: 'lane-1', enabled: true, extra: true })).toBe(false);
        });
    });

    describe('setPunchIn', () => {
        it('should accept only an exact finite beat below the maximum', () => {
            const guard = PAYLOAD_VALIDATORS.setPunchIn;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }

            expect(guard({ beat: -0 })).toBe(true);
            expect(guard({ beat: 0.25 })).toBe(true);
            expect(guard({ beat: -4 })).toBe(false);
            expect(guard({ beat: Number.MAX_VALUE })).toBe(false);
        });

        it('should reject malformed payloads', () => {
            const guard = PAYLOAD_VALIDATORS.setPunchIn;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }

            for (const payload of [
                '4',
                undefined,
                null,
                {},
                { beat: '4' },
                { beat: null },
                { beat: Number.NaN },
                { beat: Number.POSITIVE_INFINITY },
                { beat: Number.NEGATIVE_INFINITY },
                { beat: 4, extra: true },
            ]) {
                expect(guard(payload)).toBe(false);
            }
        });
    });

    describe('setPunchOut', () => {
        it('should accept only an exact positive finite beat through the maximum', () => {
            const guard = PAYLOAD_VALIDATORS.setPunchOut;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }

            expect(guard({ beat: Number.MIN_VALUE })).toBe(true);
            expect(guard({ beat: 0.25 })).toBe(true);
            expect(guard({ beat: Number.MAX_VALUE })).toBe(true);
            expect(guard({ beat: 0 })).toBe(false);
            expect(guard({ beat: -4 })).toBe(false);
        });

        it('should reject malformed payloads', () => {
            const guard = PAYLOAD_VALIDATORS.setPunchOut;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }

            for (const payload of [
                '4',
                undefined,
                null,
                {},
                { beat: '4' },
                { beat: null },
                { beat: Number.NaN },
                { beat: Number.POSITIVE_INFINITY },
                { beat: Number.NEGATIVE_INFINITY },
                { beat: 4, extra: true },
            ]) {
                expect(guard(payload)).toBe(false);
            }
        });
    });

    it('should not expose the internal punch-region inverse to model payload validation', () => {
        expect(PAYLOAD_VALIDATORS).not.toHaveProperty('restorePunchRegion');
    });

    it('should not expose the internal clip loop-length inverse to model payload validation', () => {
        expect(PAYLOAD_VALIDATORS).not.toHaveProperty('restoreClipLoopLength');
    });

    it('should not expose the internal automation-lane inverse to model payload validation', () => {
        expect(PAYLOAD_VALIDATORS).not.toHaveProperty('removeAutomationLane');
    });

    describe('joinCollabSession', () => {
        it('should require inviteString and peerName strings (the fields the handler reads)', () => {
            const guard = PAYLOAD_VALIDATORS.joinCollabSession;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }
            // The RuntimeAction payload + fast path use { inviteString, peerName };
            // the handler reads inviteString. The old validator checked a
            // nonexistent `inviteCode` field, so every legitimate join was dropped.
            expect(guard({ inviteString: 'abc', peerName: 'Ada' })).toBe(true);
            expect(guard({ inviteString: 'abc' })).toBe(false);
            expect(guard({ inviteCode: 'abc' })).toBe(false);
            expect(guard({})).toBe(false);
        });
    });

    describe('quantizeNotes', () => {
        it('should require an exact clipId and finite gridSize greater than zero and at most 64', () => {
            const guard = PAYLOAD_VALIDATORS.quantizeNotes;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }

            expect(guard({ clipId: 'clip-1', gridSize: 0.25 })).toBe(true);
            expect(guard({ clipId: 'clip-1', gridSize: Number.MIN_VALUE })).toBe(true);
            expect(guard({ clipId: 'clip-1', grid: 0.25 })).toBe(false);
            expect(guard({ clipId: 'clip-1' })).toBe(false);
            expect(guard({ clipId: '', gridSize: 0.25 })).toBe(false);
            expect(guard({ clipId: 'clip-1', gridSize: 0 })).toBe(false);
            expect(guard({ clipId: 'clip-1', gridSize: 65 })).toBe(false);
            expect(guard({ clipId: 'clip-1', gridSize: Number.POSITIVE_INFINITY })).toBe(false);
            expect(guard({ clipId: 'clip-1', gridSize: 0.25, strength: 0.5 })).toBe(false);
        });
    });

    describe('transposeNotes', () => {
        it('should require an exact non-zero integer semitone delta from -127 through 127', () => {
            const guard = PAYLOAD_VALIDATORS.transposeNotes;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }

            expect(guard({ clipId: 'clip-1', semitones: -127 })).toBe(true);
            expect(guard({ clipId: 'clip-1', semitones: 127 })).toBe(true);
            expect(guard({ clipId: '', semitones: 7 })).toBe(false);
            expect(guard({ clipId: 'clip-1', semitones: 0 })).toBe(false);
            expect(guard({ clipId: 'clip-1', semitones: 1.5 })).toBe(false);
            expect(guard({ clipId: 'clip-1', semitones: 128 })).toBe(false);
            expect(guard({ clipId: 'clip-1', semitones: 7, notes: [] })).toBe(false);
        });
    });

    describe('whole-clip MIDI transforms', () => {
        it.each(['invertNotes', 'retrogradeNotes'] as const)('%s accepts only one non-empty clip ID', (actionType) => {
            const guard = PAYLOAD_VALIDATORS[actionType];
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }

            expect(guard({ clipId: 'clip-1' })).toBe(true);
            expect(guard({ clipId: '' })).toBe(false);
            expect(guard({})).toBe(false);
            expect(guard({ clipId: 'clip-1', extra: true })).toBe(false);
        });

        it('validates exact finite note-length quantization bounds', () => {
            const guard = PAYLOAD_VALIDATORS.quantizeNoteLengths;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }

            expect(guard({ clipId: 'clip-1', gridSize: 0.25 })).toBe(true);
            expect(guard({ clipId: 'clip-1', gridSize: 0.03125 })).toBe(true);
            expect(guard({ clipId: 'clip-1', gridSize: 64 })).toBe(true);
            expect(guard({ clipId: '', gridSize: 0.25 })).toBe(false);
            expect(guard({ clipId: 'clip-1', gridSize: 0 })).toBe(false);
            expect(guard({ clipId: 'clip-1', gridSize: 0.03124 })).toBe(false);
            expect(guard({ clipId: 'clip-1', gridSize: Number.MIN_VALUE })).toBe(false);
            expect(guard({ clipId: 'clip-1', gridSize: 65 })).toBe(false);
            expect(guard({ clipId: 'clip-1', gridSize: Number.NaN })).toBe(false);
            expect(guard({ clipId: 'clip-1', gridSize: Number.POSITIVE_INFINITY })).toBe(false);
            expect(guard({ clipId: 'clip-1', gridSize: 0.25, extra: true })).toBe(false);
        });

        it('validates exact non-identity velocity scale bounds', () => {
            const guard = PAYLOAD_VALIDATORS.scaleAllVelocities;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }

            expect(guard({ clipId: 'clip-1', factor: 0.5 })).toBe(true);
            expect(guard({ clipId: 'clip-1', factor: 16 })).toBe(true);
            expect(guard({ clipId: '', factor: 0.5 })).toBe(false);
            expect(guard({ clipId: 'clip-1', factor: 0 })).toBe(false);
            expect(guard({ clipId: 'clip-1', factor: 1 })).toBe(false);
            expect(guard({ clipId: 'clip-1', factor: 16.01 })).toBe(false);
            expect(guard({ clipId: 'clip-1', factor: Number.NaN })).toBe(false);
            expect(guard({ clipId: 'clip-1', factor: Number.POSITIVE_INFINITY })).toBe(false);
            expect(guard({ clipId: 'clip-1', factor: 0.5, extra: true })).toBe(false);
        });

        it('validates exact integer MIDI velocity bounds', () => {
            const guard = PAYLOAD_VALIDATORS.setAllVelocities;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }

            expect(guard({ clipId: 'clip-1', velocity: 1 })).toBe(true);
            expect(guard({ clipId: 'clip-1', velocity: 127 })).toBe(true);
            expect(guard({ clipId: '', velocity: 96 })).toBe(false);
            expect(guard({ clipId: 'clip-1', velocity: 0 })).toBe(false);
            expect(guard({ clipId: 'clip-1', velocity: 127.5 })).toBe(false);
            expect(guard({ clipId: 'clip-1', velocity: 128 })).toBe(false);
            expect(guard({ clipId: 'clip-1', velocity: Number.NaN })).toBe(false);
            expect(guard({ clipId: 'clip-1', velocity: 96, extra: true })).toBe(false);
        });
    });

    describe('addNotes', () => {
        it('should require clipId and a notes array with finite bounded note fields', () => {
            const guard = PAYLOAD_VALIDATORS.addNotes;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }

            expect(
                guard({
                    clipId: 'clip-1',
                    notes: [{ pitch: 60, startBeat: 0, duration: 1, velocity: 96 }],
                })
            ).toBe(true);
            expect(
                guard({
                    clipId: 'clip-1',
                    notes: [{ pitch: 0, startBeat: 0, duration: 0.01 }],
                })
            ).toBe(true);
            expect(
                guard({
                    clipId: 'clip-1',
                    notes: [{ pitch: 127, startBeat: 4, duration: 2, velocity: 127 }],
                })
            ).toBe(true);
        });

        it('should reject malformed addNotes payloads before they reach the MIDI handler', () => {
            const guard = PAYLOAD_VALIDATORS.addNotes;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }

            expect(guard({ clipId: 1, notes: [] })).toBe(false);
            expect(guard({ clipId: 'clip-1', notes: [] })).toBe(false);
            expect(guard({ clipId: 'clip-1', notes: 'bad' })).toBe(false);
            expect(guard({ clipId: 'clip-1', notes: [{ pitch: -1, startBeat: 0, duration: 1 }] })).toBe(false);
            expect(guard({ clipId: 'clip-1', notes: [{ pitch: 128, startBeat: 0, duration: 1 }] })).toBe(false);
            expect(guard({ clipId: 'clip-1', notes: [{ pitch: 60, startBeat: -0.01, duration: 1 }] })).toBe(false);
            expect(guard({ clipId: 'clip-1', notes: [{ pitch: 60, startBeat: 0, duration: 0 }] })).toBe(false);
            expect(guard({ clipId: 'clip-1', notes: [{ pitch: 60, startBeat: 0, duration: Number.NaN }] })).toBe(false);
            expect(guard({ clipId: '', notes: [] })).toBe(false);
            expect(guard({ clipId: 'clip-1', notes: [{ pitch: 60, startBeat: 0 }] })).toBe(false);
            expect(guard({ clipId: 'clip-1', notes: [{ pitch: 60, startBeat: 0, duration: 1, channel: 2 }] })).toBe(
                false
            );
            expect(
                guard({
                    clipId: 'clip-1',
                    notes: [{ id: 'command-owned', pitch: 60, startBeat: 0, duration: 1 }],
                })
            ).toBe(false);
            expect(
                guard({
                    clipId: 'clip-1',
                    notes: [{ pitch: 60, startBeat: 0, duration: 1 }],
                    replace: true,
                })
            ).toBe(false);
            expect(guard({ clipId: 'clip-1', notes: [{ pitch: 60, startBeat: 0, duration: 1, velocity: 0 }] })).toBe(
                false
            );
            expect(guard({ clipId: 'clip-1', notes: [{ pitch: 60, startBeat: 0, duration: 1, velocity: 128 }] })).toBe(
                false
            );
        });
    });

    describe('exportMidi', () => {
        it('should require clipId string', () => {
            const guard = PAYLOAD_VALIDATORS.exportMidi;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }
            // Payload type is { clipId: string }. The old validator only checked an
            // optional `trackIds` (a nonexistent field), so {} passed validation.
            expect(guard({ clipId: 'clip-1' })).toBe(true);
            expect(guard({})).toBe(false);
            expect(guard({ clipId: 1 })).toBe(false);
        });
    });

    describe('importAudioFile / importMidiFile', () => {
        it('should be unchecked (payload is undefined — file chosen via native picker)', () => {
            // Both action types are `payload?: undefined`. A guard demanding
            // isObj(param) && isString(param.path) rejected every legitimate
            // (undefined) payload, so the imports were always dropped.
            expect(PAYLOAD_VALIDATORS.importAudioFile).toBe('unchecked');
            expect(PAYLOAD_VALIDATORS.importMidiFile).toBe('unchecked');
        });
    });

    describe('addClip', () => {
        it('accepts only a finite positive blank-MIDI clip request', () => {
            const guard = PAYLOAD_VALIDATORS.addClip;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }
            expect(guard({ trackId: 't-1', startBeat: 0, endBeat: 4, name: 'Clip' })).toBe(true);
            expect(guard({ trackId: 't-1', startBeat: 0, endBeat: 4, name: 'Clip', type: 'midi' })).toBe(true);
            expect(guard({ id: 'command-owned', trackId: 't-1', startBeat: 0, endBeat: 4, name: 'Clip' })).toBe(false);
            expect(guard({ trackId: 't-1', startBeat: 0, endBeat: 4, name: 'Clip', muted: true })).toBe(false);
            expect(guard({ trackId: 't-1', startBeat: 0, endBeat: 4, name: 'Clip', type: 'audio' })).toBe(false);
            expect(
                guard({
                    trackId: 't-1',
                    startBeat: 0,
                    endBeat: 4,
                    name: 'Clip',
                    audioBufferId: 'provider-buffer',
                })
            ).toBe(false);
            expect(guard({ trackId: 't-1', startBeat: -1, endBeat: 4, name: 'Clip' })).toBe(false);
            expect(guard({ trackId: 't-1', startBeat: 4, endBeat: 4, name: 'Clip' })).toBe(false);
            expect(guard({ trackId: 't-1', startBeat: 5, endBeat: 4, name: 'Clip' })).toBe(false);
            expect(guard({ trackId: 't-1', startBeat: 0, endBeat: Number.POSITIVE_INFINITY, name: 'Clip' })).toBe(
                false
            );
            expect(guard({ trackId: 't-1', startBeat: 0, endBeat: 4, name: '  ' })).toBe(false);
            expect(guard({ trackId: 't-1', startBeat: 0, endBeat: 4, name: '<Framed>' })).toBe(false);
            expect(guard({ trackId: 't-1', startBeat: 0, endBeat: 4, name: 'Bad\u0000Name' })).toBe(false);
            // name is required by the payload type but was previously unchecked.
            expect(guard({ trackId: 't-1', startBeat: 0, endBeat: 4 })).toBe(false);
            expect(guard({ trackId: 't-1', startBeat: 0, endBeat: 4, name: 1 })).toBe(false);
        });
    });

    describe('payloadless prompt meta actions', () => {
        it.each(['openPreferencesDialog', 'undo', 'redo'] as const)(
            'should accept only undefined payload for %s',
            (actionType) => {
                const guard = PAYLOAD_VALIDATORS[actionType];
                expect(guard).not.toBe('unchecked');
                if (guard === 'unchecked') {
                    return;
                }

                expect(guard(undefined)).toBe(true);
                expect(guard({ arbitrary: true })).toBe(false);
                expect(guard(null)).toBe(false);
                expect(guard('')).toBe(false);
            }
        );
    });

    describe('unchecked sentinels', () => {
        it('should mark openMixer as unchecked', () => {
            expect(PAYLOAD_VALIDATORS.openMixer).toBe('unchecked');
        });

        it('should mark saveProject as unchecked', () => {
            expect(PAYLOAD_VALIDATORS.saveProject).toBe('unchecked');
        });
    });

    describe('addTrack', () => {
        it('should require name and kind strings', () => {
            const guard = PAYLOAD_VALIDATORS.addTrack;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }
            expect(guard({ name: 'A', kind: 'audio' })).toBe(true);
            expect(guard({ name: 'A' })).toBe(false);
            expect(guard({ kind: 'audio' })).toBe(false);
        });
    });
});
