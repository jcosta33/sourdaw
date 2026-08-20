import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { createTrack } from '../../../models/Track';
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
}));

vi.mock('../../../useCases/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('../../../useCases/rippleDelete/undoRippleDelete', () => ({
    undoRippleDelete: mocks.undoRippleDelete,
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    restoreMidiClipData: mocks.restoreMidiClipData,
}));

function createRestoreClipAction(overrides: Partial<RestoreClipAction['payload']> = {}): RestoreClipAction {
    return {
        type: 'restoreClip',
        payload: {
            clipId: 'c1',
            trackId: 't1',
            clipSnapshot: { id: 'c1', trackId: 't1', startBeat: 0, endBeat: 1 },
            ripplePlan: null,
            midiNotesSnapshot: null,
            midiCcSnapshot: null,
            midiPitchBendSnapshot: null,
            ...overrides,
        },
    };
}

function createMidiSnapshots({ notes, controlChanges, pitchBends }: SnapshotPresence): MidiSnapshotInput {
    return {
        midiNotesSnapshot: notes ? [{ id: 'note-1' }] : null,
        midiCcSnapshot: controlChanges ? [{ id: 'cc-1' }] : null,
        midiPitchBendSnapshot: pitchBends ? [{ id: 'pitch-1' }] : null,
    };
}

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
    });
    expect(mocks.updateTrack).not.toHaveBeenCalled();

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
                                  removedClips: [{ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 1 }],
                                  shiftedClips: [
                                      { clipId: 'c2', origStartBeat: 1, origEndBeat: 2, automationDelta: -1 },
                                  ],
                                  clipSatellites: [],
                                  clipAutomationLanes: [],
                              }
                            : null,
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

    it('provides a description', () => {
        const desc = handleRestoreClip.describe(createRestoreClipAction());
        expect(desc.label).toBe('Restore clip');
    });

    it('is not undoable', () => {
        expect(handleRestoreClip.undoable).toBe(false);
    });
});
