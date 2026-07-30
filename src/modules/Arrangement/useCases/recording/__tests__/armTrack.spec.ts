import { describe, it, expect, vi, beforeEach } from 'vitest';

import { armTrack } from '../armTrack';

const mocks = vi.hoisted(() => ({
    updateTrack: vi.fn(),
    getTrackById: vi.fn(),
    setMidiInputTrack: vi.fn(),
    getMidiInputTrack: vi.fn<() => string | null>(),
}));

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('../../../repositories/track/getTrackById', () => ({
    getTrackById: mocks.getTrackById,
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    setMidiInputTrack: mocks.setMidiInputTrack,
    getMidiInputTrack: mocks.getMidiInputTrack,
}));

describe('armTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getMidiInputTrack.mockReturnValue(null);
    });

    it('returns no write for a missing track', () => {
        mocks.getTrackById.mockReturnValue(undefined);

        const didWrite = armTrack('missing', true);

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.setMidiInputTrack).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('returns no write when the requested armed state already matches project truth', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', kind: 'audio', armed: true });

        const didWrite = armTrack('t1', true);

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.setMidiInputTrack).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('arms a track and sets it as MIDI input in engine if MIDI track', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', kind: 'midi', armed: false });

        const didWrite = armTrack('t1', true);

        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        expect(mocks.setMidiInputTrack).toHaveBeenCalledWith('t1');
        expect(didWrite).toBe(true);
    });

    it('arms a track but does not set MIDI input if not MIDI', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', kind: 'audio', armed: false });

        armTrack('t1', true);

        expect(mocks.updateTrack).toHaveBeenCalled();
        expect(mocks.setMidiInputTrack).not.toHaveBeenCalled();
    });

    it('rejects arming a dormant VCA without a project or MIDI-routing write', () => {
        mocks.getTrackById.mockReturnValue({ id: 'vca-1', kind: 'vca', armed: false });

        const didWrite = armTrack('vca-1', true);

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.setMidiInputTrack).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('permits dormant VCA disarm cleanup and conditionally clears its stale MIDI routing', () => {
        mocks.getTrackById.mockReturnValue({ id: 'vca-1', kind: 'vca', armed: true });
        mocks.getMidiInputTrack.mockReturnValue('vca-1');

        const didWrite = armTrack('vca-1', false);

        expect(mocks.updateTrack).toHaveBeenCalledWith('vca-1', expect.any(Function));
        expect(mocks.setMidiInputTrack).toHaveBeenCalledWith(null);
        expect(didWrite).toBe(true);
    });

    it('disarms a track without touching MIDI input pointed elsewhere', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', kind: 'audio', armed: true });
        armTrack('t1', false);
        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        expect(mocks.setMidiInputTrack).not.toHaveBeenCalled();
    });

    it('clears MIDI input routing on disarm when it points at the track', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', kind: 'audio', armed: true });
        mocks.getMidiInputTrack.mockReturnValue('t1');

        armTrack('t1', false);

        expect(mocks.setMidiInputTrack).toHaveBeenCalledWith(null);
    });

    it('leaves MIDI input routing alone on disarm when it points at another track', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', kind: 'audio', armed: true });
        mocks.getMidiInputTrack.mockReturnValue('t2');

        armTrack('t1', false);

        expect(mocks.setMidiInputTrack).not.toHaveBeenCalled();
    });

    it('defers MIDI input routing until the project transaction commits', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', kind: 'midi', armed: false });
        mocks.getMidiInputTrack.mockReturnValue('t0');

        const runtimeEffect = armTrack('t1', true, { deferRuntimeEffect: true });

        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        expect(mocks.setMidiInputTrack).not.toHaveBeenCalled();
        expect(runtimeEffect).not.toBeNull();
        if (!runtimeEffect) {
            return;
        }

        runtimeEffect.afterCommit();

        expect(mocks.setMidiInputTrack).toHaveBeenCalledWith('t1');
    });

    it('restores the exact captured MIDI input route after a committed inverse', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', kind: 'midi', armed: true });
        mocks.getMidiInputTrack.mockReturnValue('t1');

        const runtimeEffect = armTrack('t1', false, {
            deferRuntimeEffect: true,
            midiInputTrackId: 't0',
        });

        expect(mocks.setMidiInputTrack).not.toHaveBeenCalled();
        expect(runtimeEffect).not.toBeNull();
        if (!runtimeEffect) {
            return;
        }

        runtimeEffect.afterCommit();

        expect(mocks.setMidiInputTrack).toHaveBeenCalledWith('t0');
    });

    it('reconciles MIDI routing to the requested state after an ambiguous committed transaction', () => {
        mocks.getTrackById
            .mockReturnValueOnce({ id: 't1', kind: 'midi', armed: false })
            .mockReturnValueOnce({ id: 't1', kind: 'midi', armed: true });
        mocks.getMidiInputTrack.mockReturnValue('t0');

        const runtimeEffect = armTrack('t1', true, { deferRuntimeEffect: true });
        expect(runtimeEffect).not.toBeNull();
        if (!runtimeEffect) {
            return;
        }

        runtimeEffect.afterAmbiguousCommit();

        expect(mocks.setMidiInputTrack).toHaveBeenCalledWith('t1');
    });

    it('restores prior MIDI routing after an ambiguous rolled-back transaction', () => {
        mocks.getTrackById
            .mockReturnValueOnce({ id: 't1', kind: 'midi', armed: false })
            .mockReturnValueOnce({ id: 't1', kind: 'midi', armed: false });
        let routing: string | null = 't0';
        mocks.getMidiInputTrack.mockImplementation(() => routing);
        mocks.setMidiInputTrack.mockImplementation((next: string | null) => {
            routing = next;
        });

        const runtimeEffect = armTrack('t1', true, { deferRuntimeEffect: true });
        expect(runtimeEffect).not.toBeNull();
        if (!runtimeEffect) {
            return;
        }
        routing = 't1';

        runtimeEffect.afterAmbiguousCommit();

        expect(routing).toBe('t0');
    });

    it('restores routing across an arm -> disarm -> re-arm (redo) sequence', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', kind: 'midi', armed: false });
        let routing: string | null = null;
        mocks.setMidiInputTrack.mockImplementation((next: string | null) => {
            routing = next;
        });
        mocks.getMidiInputTrack.mockImplementation(() => routing);

        armTrack('t1', true);
        expect(routing).toBe('t1');
        mocks.getTrackById.mockReturnValue({ id: 't1', kind: 'midi', armed: true });

        // Undo of the arm disarms and must clear the routing it created.
        armTrack('t1', false);
        expect(routing).toBeNull();
        mocks.getTrackById.mockReturnValue({ id: 't1', kind: 'midi', armed: false });

        // Redo of the arm re-routes input to the re-armed track.
        armTrack('t1', true);
        expect(routing).toBe('t1');
    });
});
