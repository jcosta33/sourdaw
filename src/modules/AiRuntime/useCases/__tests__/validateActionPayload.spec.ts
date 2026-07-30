import { describe, expect, expectTypeOf, it } from 'vitest';

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
        actionType: 'splitClip',
        validPayload: { clipId: 'clip-1', beat: 4 },
        invalidPayloads: [
            { clipId: 'clip-1', splitBeat: 4 },
            { clipId: 'clip-1' },
            { clipId: 1, beat: 4 },
            { clipId: 'clip-1', beat: Number.NaN },
        ],
    }),
    guardedPayloadCase({
        actionType: 'moveClip',
        validPayload: { clipId: 'clip-1', trackId: 'track-2', startBeat: 8 },
        invalidPayloads: [
            { clipId: 'clip-1', newTrackId: 'track-2', newStartBeat: 8 },
            { clipId: 'clip-1', trackId: 'track-2' },
            { clipId: 'clip-1', trackId: 2, startBeat: 8 },
            { clipId: 'clip-1', trackId: 'track-2', startBeat: Number.POSITIVE_INFINITY },
        ],
    }),
    guardedPayloadCase({
        actionType: 'setDeviceParameter',
        validPayload: { deviceId: 'device-1', paramId: 'gain', value: 0.75 },
        invalidPayloads: [
            { trackId: 'track-1', deviceId: 'device-1', paramId: 'gain' },
            { deviceId: 'device-1', paramId: 'gain' },
            { deviceId: 'device-1', paramId: 1, value: 0.75 },
            { deviceId: 'device-1', paramId: 'gain', value: Number.NaN },
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
            { vcaGroupId: 'vca-1', gain: 2.01 },
            { vcaGroupId: 'vca-1', gain: Number.NaN },
            { vcaGroupId: 'vca-1', gain: 1, extra: true },
        ],
    }),
] as const;

describe('validateActionPayload / PAYLOAD_VALIDATORS', () => {
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

    describe('removeTrack', () => {
        it('should accept a payload with trackId string', () => {
            const guard = PAYLOAD_VALIDATORS.removeTrack;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }
            expect(guard({ trackId: 'track-1' })).toBe(true);
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

    describe.each(['setPunchIn', 'setPunchOut'] as const)('%s', (actionType) => {
        it('should accept an exact payload with any finite numeric beat', () => {
            const guard = PAYLOAD_VALIDATORS[actionType];
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }

            expect(guard({ beat: -4 })).toBe(true);
            expect(guard({ beat: -0 })).toBe(true);
            expect(guard({ beat: 0.25 })).toBe(true);
            expect(guard({ beat: Number.MAX_VALUE })).toBe(true);
        });

        it.each([
            ['string payload', '4'],
            ['missing payload', undefined],
            ['null payload', null],
            ['missing beat', {}],
            ['string beat', { beat: '4' }],
            ['null beat', { beat: null }],
            ['NaN beat', { beat: Number.NaN }],
            ['positive infinity beat', { beat: Number.POSITIVE_INFINITY }],
            ['negative infinity beat', { beat: Number.NEGATIVE_INFINITY }],
            ['extra property', { beat: 4, extra: true }],
        ] as const)('should reject %s', (_label, payload) => {
            const guard = PAYLOAD_VALIDATORS[actionType];
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }

            expect(guard(payload)).toBe(false);
        });
    });

    it('should not expose the internal punch-region inverse to model payload validation', () => {
        expect(PAYLOAD_VALIDATORS).not.toHaveProperty('restorePunchRegion');
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
        it('should require clipId string and gridSize number (the payload field, not `grid`)', () => {
            const guard = PAYLOAD_VALIDATORS.quantizeNotes;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }
            // Payload type + fast path emit { clipId, gridSize }; the old validator
            // checked `param.grid`, so every legitimate call was dropped.
            expect(guard({ clipId: 'clip-1', gridSize: 0.25 })).toBe(true);
            expect(guard({ clipId: 'clip-1', grid: 0.25 })).toBe(false);
            expect(guard({ clipId: 'clip-1' })).toBe(false);
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
            expect(guard({ clipId: 'clip-1', notes: 'bad' })).toBe(false);
            expect(guard({ clipId: 'clip-1', notes: [{ pitch: -1, startBeat: 0, duration: 1 }] })).toBe(false);
            expect(guard({ clipId: 'clip-1', notes: [{ pitch: 128, startBeat: 0, duration: 1 }] })).toBe(false);
            expect(guard({ clipId: 'clip-1', notes: [{ pitch: 60, startBeat: -0.01, duration: 1 }] })).toBe(false);
            expect(guard({ clipId: 'clip-1', notes: [{ pitch: 60, startBeat: 0, duration: 0 }] })).toBe(false);
            expect(guard({ clipId: 'clip-1', notes: [{ pitch: 60, startBeat: 0, duration: Number.NaN }] })).toBe(false);
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
        it('should require trackId, startBeat, endBeat, and name', () => {
            const guard = PAYLOAD_VALIDATORS.addClip;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }
            expect(guard({ trackId: 't-1', startBeat: 0, endBeat: 4, name: 'Clip' })).toBe(true);
            // name is required by the payload type but was previously unchecked.
            expect(guard({ trackId: 't-1', startBeat: 0, endBeat: 4 })).toBe(false);
            expect(guard({ trackId: 't-1', startBeat: 0, endBeat: 4, name: 1 })).toBe(false);
        });
    });

    describe('restoreDsoSnapshot', () => {
        it('should accept present bytes and absent membership entries', () => {
            const guard = PAYLOAD_VALIDATORS.restoreDsoSnapshot;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }
            const bundle = new Map([
                ['root', { state: 'present' as const, bytes: new Uint8Array([1, 2, 3]) }],
                ['removed', { state: 'absent' as const }],
            ]);
            expect(guard({ bundle })).toBe(true);
            expect(guard({ bundle: new Map() })).toBe(true);
        });

        it('should reject a non-Map bundle or a Map with the wrong entry shapes', () => {
            const guard = PAYLOAD_VALIDATORS.restoreDsoSnapshot;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }
            // A hallucinated JSON payload deserializes to a plain object, not a Map.
            expect(guard({ bundle: { root: [1, 2, 3] } })).toBe(false);
            expect(guard({})).toBe(false);
            expect(guard({ bundle: new Map([['root', [1, 2, 3]]]) })).toBe(false);
            expect(guard({ bundle: new Map([['root', { state: 'present', bytes: [1, 2, 3] }]]) })).toBe(false);
            expect(guard({ bundle: new Map([['root', { state: 'unknown' }]]) })).toBe(false);
            expect(guard({ bundle: new Map([['root', { state: 'absent', bytes: new Uint8Array() }]]) })).toBe(false);
            expect(guard({ bundle: new Map([[1, { state: 'absent' }]]) })).toBe(false);
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
