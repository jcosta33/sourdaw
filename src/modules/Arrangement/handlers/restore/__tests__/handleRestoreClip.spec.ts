import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type MidiStoreState } from '#/modules/MIDI/stores';
import { type AppAction } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { createTrack } from '../../../models/Track';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { type undoRippleDelete } from '../../../useCases/rippleDelete/undoRippleDelete';
import { type updateTrack } from '../../../useCases/updateTrack';
import { handleRestoreClip } from '../handleRestoreClip';

type RestoreClipAction = Extract<AppAction, { type: 'restoreClip' }>;
type RestoreClipPayload = RestoreClipAction['payload'];

type RestoreMidiClipDataInput = {
    clipId: RestoreClipPayload['clipId'];
    notesSnapshot: RestoreClipPayload['midiNotesSnapshot'];
    controlChangeSnapshot: RestoreClipPayload['midiCcSnapshot'];
    pitchBendSnapshot: RestoreClipPayload['midiPitchBendSnapshot'];
};

type MidiSnapshotInput = Pick<RestoreClipPayload, 'midiNotesSnapshot' | 'midiCcSnapshot' | 'midiPitchBendSnapshot'>;

type SnapshotPresence = {
    label: string;
    notes: boolean;
    controlChanges: boolean;
    pitchBends: boolean;
};

const SNAPSHOT_PRESENCE_COMBINATIONS = [
    { label: 'all-null', notes: false, controlChanges: false, pitchBends: false },
    { label: 'notes-only', notes: true, controlChanges: false, pitchBends: false },
    { label: 'control-changes-only', notes: false, controlChanges: true, pitchBends: false },
    { label: 'pitch-bends-only', notes: false, controlChanges: false, pitchBends: true },
    { label: 'notes-and-control-changes', notes: true, controlChanges: true, pitchBends: false },
    { label: 'notes-and-pitch-bends', notes: true, controlChanges: false, pitchBends: true },
    { label: 'control-changes-and-pitch-bends', notes: false, controlChanges: true, pitchBends: true },
    { label: 'all-supplied', notes: true, controlChanges: true, pitchBends: true },
] satisfies readonly SnapshotPresence[];

const mocks = vi.hoisted(() => ({
    updateTrack: vi.fn<typeof updateTrack>(),
    undoRippleDelete: vi.fn<typeof undoRippleDelete>(),
    restoreMidiClipData: vi.fn<(input: RestoreMidiClipDataInput) => void>(),
    restoreTakesForClip: vi.fn(),
}));

vi.mock('../../../useCases/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('../../../useCases/rippleDelete/undoRippleDelete', () => ({
    undoRippleDelete: mocks.undoRippleDelete,
}));

vi.mock('../../../useCases/comping/restoreTakesForClip', () => ({
    restoreTakesForClip: mocks.restoreTakesForClip,
}));

vi.mock('#/modules/MIDI/useCases', async () => {
    const actual = await vi.importActual<typeof import('#/modules/MIDI/useCases')>('#/modules/MIDI/useCases');
    return {
        decodeMidiClipDataSnapshots: actual.decodeMidiClipDataSnapshots,
        getMidiStoreState: () => null,
        restoreMidiClipData: mocks.restoreMidiClipData,
    };
});

function createRestoreClipAction(overrides: Partial<RestoreClipAction['payload']> = {}): RestoreClipAction {
    return {
        type: 'restoreClip',
        payload: {
            clipId: 'c1',
            trackId: 't1',
            clipSnapshot: ClipDummy.create({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 1 }),
            ripplePlan: null,
            midiNotesSnapshot: null,
            midiCcSnapshot: null,
            midiPitchBendSnapshot: null,
            retiredTakeLanes: [],
            ...overrides,
        },
    };
}

function createMidiSnapshots({ notes, controlChanges, pitchBends }: SnapshotPresence): MidiSnapshotInput {
    const notesSnapshot: MidiStoreState['notesByClipId'][string] = [
        { id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 90 },
    ];
    const controlChangesSnapshot: MidiStoreState['ccByClipId'][string] = [
        { id: 'cc-1', controller: 1, value: 64, beat: 0.5, channel: 1 },
    ];
    const pitchBendsSnapshot: MidiStoreState['pitchBendByClipId'][string] = [
        { id: 'pitch-1', value: 256, beat: 0.75, channel: 1 },
    ];

    return {
        midiNotesSnapshot: notes ? notesSnapshot : null,
        midiCcSnapshot: controlChanges ? controlChangesSnapshot : null,
        midiPitchBendSnapshot: pitchBends ? pitchBendsSnapshot : null,
    };
}

/**
 * A real capture, not an absent one: `expect(...).toHaveBeenCalledWith` ignores
 * undefined-valued keys, so a fixture whose capture is `undefined` cannot tell a
 * forwarded capture from a dropped one.
 */
const RETIRED_TAKE_LANES: NonNullable<RestoreClipPayload['retiredTakeLanes']> = [
    {
        laneIndex: 0,
        lane: {
            id: 'lane-1',
            trackId: 't1',
            takes: [{ id: 'take-1', clipId: 'c1', name: 'Take 1', startBeat: 0, endBeat: 4, selected: false }],
            activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: 'take-1' }],
        },
        retiredTakeIds: ['take-1'],
    },
];

function expectRippleRestore(action: RestoreClipAction): number {
    const ripplePlan = action.payload.ripplePlan;
    if (!ripplePlan) {
        throw new Error('Expected ripple plan');
    }

    expect(mocks.undoRippleDelete).toHaveBeenCalledTimes(1);
    expect(mocks.undoRippleDelete).toHaveBeenCalledWith({
        trackId: action.payload.trackId,
        removedClips: ripplePlan.removedClips,
        shiftedClips: ripplePlan.shiftedClips,
        clipSatellites: ripplePlan.clipSatellites,
        clipAutomationLanes: ripplePlan.clipAutomationLanes,
        retiredTakeLanes: action.payload.retiredTakeLanes,
    });
    expect(mocks.updateTrack).not.toHaveBeenCalled();
    expect(mocks.restoreTakesForClip).not.toHaveBeenCalled();

    const rippleOrder = mocks.undoRippleDelete.mock.invocationCallOrder[0];
    if (rippleOrder === undefined) {
        throw new Error('Expected ripple restore call');
    }

    return rippleOrder;
}

function expectTrackRestore(action: RestoreClipAction): number {
    expect(mocks.updateTrack).toHaveBeenCalledTimes(1);
    expect(mocks.undoRippleDelete).not.toHaveBeenCalled();

    const trackCall = mocks.updateTrack.mock.calls[0];
    if (!trackCall) {
        throw new Error('Expected track restore call');
    }

    const [trackId, updater] = trackCall;
    expect(trackId).toBe(action.payload.trackId);

    const updatedTrack = updater(createTrack({ id: 't1', name: 'Track 1', kind: 'midi' }));
    expect(updatedTrack.clips).toEqual([action.payload.clipSnapshot]);

    const trackOrder = mocks.updateTrack.mock.invocationCallOrder[0];
    if (trackOrder === undefined) {
        throw new Error('Expected track restore call order');
    }

    return trackOrder;
}

function expectMidiRestoreFromAction(action: RestoreClipAction): number {
    expect(mocks.restoreMidiClipData).toHaveBeenCalledTimes(1);

    const restoreInput = mocks.restoreMidiClipData.mock.calls[0]?.[0];
    if (!restoreInput) {
        throw new Error('Expected MIDI restore input');
    }

    expect(restoreInput.clipId).toBe(action.payload.clipId);
    expect(restoreInput.notesSnapshot).toBe(action.payload.midiNotesSnapshot);
    expect(restoreInput.controlChangeSnapshot).toBe(action.payload.midiCcSnapshot);
    expect(restoreInput.pitchBendSnapshot).toBe(action.payload.midiPitchBendSnapshot);

    const ownerOrder = mocks.restoreMidiClipData.mock.invocationCallOrder[0];
    if (ownerOrder === undefined) {
        throw new Error('Expected MIDI restore owner call');
    }

    return ownerOrder;
}

describe('handleRestoreClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        takeLaneStore.set({ lanes: [] });
        trackStore.set({
            tracks: [
                {
                    ...createTrack({ id: 't1', name: 'Track 1', kind: 'midi' }),
                    clips: [ClipDummy.create({ id: 'c2', trackId: 't1', startBeat: 0, endBeat: 1 })],
                },
            ],
            selectedTrackId: 't1',
        });
    });

    describe.each(['ripple', 'track'] as const)('%s restore path', (path) => {
        it.each(SNAPSHOT_PRESENCE_COMBINATIONS)(
            'forwards the $label MIDI snapshot combination to its owner after arrangement restore',
            (snapshotPresence) => {
                const snapshots = createMidiSnapshots(snapshotPresence);
                const action = createRestoreClipAction({
                    ripplePlan:
                        path === 'ripple'
                            ? {
                                  removedClips: [createRestoreClipAction().payload.clipSnapshot],
                                  shiftedClips: [
                                      { clipId: 'c2', origStartBeat: 1, origEndBeat: 2, automationDelta: -1 },
                                  ],
                                  clipSatellites: [],
                                  clipAutomationLanes: [],
                              }
                            : null,
                    retiredTakeLanes: RETIRED_TAKE_LANES,
                    ...snapshots,
                });

                void handleRestoreClip.execute(action);

                const arrangementRestoreOrder =
                    path === 'ripple' ? expectRippleRestore(action) : expectTrackRestore(action);
                const ownerRestoreOrder = expectMidiRestoreFromAction(action);

                expect(arrangementRestoreOrder).toBeLessThan(ownerRestoreOrder);
            }
        );
    });

    it('restores the retired take lanes on the non-ripple track path', () => {
        const action = createRestoreClipAction({ retiredTakeLanes: RETIRED_TAKE_LANES });

        void handleRestoreClip.execute(action);

        expect(mocks.updateTrack).toHaveBeenCalledTimes(1);
        expect(mocks.undoRippleDelete).not.toHaveBeenCalled();
        expect(mocks.restoreTakesForClip).toHaveBeenCalledTimes(1);
        expect(mocks.restoreTakesForClip).toHaveBeenCalledWith(RETIRED_TAKE_LANES);
    });

    it('restores an empty take-lane set on the track path when the removal retired none', () => {
        const action = createRestoreClipAction();

        void handleRestoreClip.execute(action);

        expect(mocks.restoreTakesForClip).toHaveBeenCalledTimes(1);
        expect(mocks.restoreTakesForClip).toHaveBeenCalledWith([]);
    });

    describe.each(['ripple', 'track'] as const)('%s restore MIDI admission', (path) => {
        it.each(['midiNotesSnapshot', 'midiCcSnapshot', 'midiPitchBendSnapshot'] as const)(
            'refuses malformed or missing %s before any owner writes',
            (field) => {
                for (const malformed of [[{ id: 'incomplete-row' }], undefined]) {
                    const action = createRestoreClipAction({
                        ripplePlan:
                            path === 'ripple'
                                ? {
                                      removedClips: [createRestoreClipAction().payload.clipSnapshot],
                                      shiftedClips: [],
                                      clipSatellites: [],
                                      clipAutomationLanes: [],
                                  }
                                : null,
                    });
                    if (malformed === undefined) {
                        Reflect.deleteProperty(action.payload, field);
                    } else {
                        action.payload[field] = malformed;
                    }
                    expect(handleRestoreClip.validateSessionActionArguments?.(action.payload)).toBe(false);
                    expect(handleRestoreClip.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(false);
                    expect(handleRestoreClip.execute(action)).toEqual({ status: 'conflict' });
                    expect(mocks.updateTrack).not.toHaveBeenCalled();
                    expect(mocks.undoRippleDelete).not.toHaveBeenCalled();
                    expect(mocks.restoreTakesForClip).not.toHaveBeenCalled();
                    expect(mocks.restoreMidiClipData).not.toHaveBeenCalled();
                }
            }
        );

        it('preserves present empty MIDI arrays separately from null captures', () => {
            const action = createRestoreClipAction({
                ripplePlan:
                    path === 'ripple'
                        ? {
                              removedClips: [createRestoreClipAction().payload.clipSnapshot],
                              shiftedClips: [],
                              clipSatellites: [],
                              clipAutomationLanes: [],
                          }
                        : null,
                midiNotesSnapshot: [],
                midiCcSnapshot: [],
                midiPitchBendSnapshot: [],
            });
            expect(handleRestoreClip.validateSessionActionArguments?.(action.payload)).toBe(true);
            expect(handleRestoreClip.execute(action)).toEqual({ status: 'written' });
            expectMidiRestoreFromAction(action);
        });
    });

    it('provides a description', () => {
        const desc = handleRestoreClip.describe(createRestoreClipAction());
        expect(desc.label).toBe('Restore clip');
    });

    it.each([false, true])('refuses a captured lane id owned by another track before writes, ripple=%s', (ripple) => {
        takeLaneStore.set({ lanes: [{ id: 'lane-1', trackId: 'other-track', takes: [], activeCompRegions: [] }] });
        const action = createRestoreClipAction({
            retiredTakeLanes: RETIRED_TAKE_LANES,
            ripplePlan: ripple
                ? {
                      removedClips: [createRestoreClipAction().payload.clipSnapshot],
                      shiftedClips: [],
                      clipSatellites: [],
                      clipAutomationLanes: [],
                  }
                : null,
        });
        expect(handleRestoreClip.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(false);
        expect(handleRestoreClip.execute(action)).toEqual({ status: 'conflict' });
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.undoRippleDelete).not.toHaveBeenCalled();
        expect(mocks.restoreTakesForClip).not.toHaveBeenCalled();
        expect(mocks.restoreMidiClipData).not.toHaveBeenCalled();
    });

    it('is not undoable', () => {
        expect(handleRestoreClip.undoable).toBe(false);
    });

    it.each(['moved', 'missing', 'foreign-track'] as const)(
        'refuses a %s shifted clip in preflight and single execution before writes',
        (change) => {
            const action = createRestoreClipAction({
                ripplePlan: {
                    removedClips: [createRestoreClipAction().payload.clipSnapshot],
                    shiftedClips: [
                        {
                            clipId: 'c2',
                            origStartBeat: 1,
                            origEndBeat: 2,
                            automationDelta: -1,
                            expectedAutomationLanes: [],
                        },
                    ],
                    clipSatellites: [],
                    clipAutomationLanes: [],
                },
            });
            const clip = ClipDummy.create({
                id: 'c2',
                trackId: change === 'foreign-track' ? 'other-track' : 't1',
                startBeat: change === 'moved' ? 0.25 : 0,
                endBeat: change === 'moved' ? 1.25 : 1,
            });
            trackStore.set({
                tracks: [
                    {
                        ...createTrack({ id: 't1', kind: 'midi', name: 'Track 1' }),
                        clips: change === 'missing' || change === 'foreign-track' ? [] : [clip],
                    },
                    {
                        ...createTrack({ id: 'other-track', kind: 'midi', name: 'Other Track' }),
                        clips: change === 'foreign-track' ? [clip] : [],
                    },
                ],
                selectedTrackId: 't1',
            });
            expect(handleRestoreClip.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(false);
            expect(handleRestoreClip.execute(action)).toEqual({ status: 'conflict' });
            expect(mocks.updateTrack).not.toHaveBeenCalled();
            expect(mocks.undoRippleDelete).not.toHaveBeenCalled();
            expect(mocks.restoreTakesForClip).not.toHaveBeenCalled();
            expect(mocks.restoreMidiClipData).not.toHaveBeenCalled();
        }
    );
});
