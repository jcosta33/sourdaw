import { getMidiInputTrack, setMidiInputTrack } from '#/modules/MIDI/useCases';

import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getTrackEligibility } from '../../stores/trackEligibility';

type ArmTrackOptions = {
    deferRuntimeEffect?: boolean;
    midiInputTrackId?: string | null;
};

type DeferredArmTrackRuntimeEffect = {
    afterCommit: () => void;
    afterAmbiguousCommit: () => void;
};

export function armTrack(trackId: string, armed: boolean): boolean;
export function armTrack(
    trackId: string,
    armed: boolean,
    options: { deferRuntimeEffect: true; midiInputTrackId?: string | null }
): DeferredArmTrackRuntimeEffect | null;
export function armTrack(
    trackId: string,
    armed: boolean,
    options: ArmTrackOptions = {}
): boolean | DeferredArmTrackRuntimeEffect | null {
    const track = getTrackById(trackId);
    if (!track || track.armed === armed) {
        return false;
    }
    if (armed && !getTrackEligibility(track.kind).acceptsArm) {
        return false;
    }

    const previousMidiInputTrackId = getMidiInputTrack();
    let desiredMidiInputTrackId = previousMidiInputTrackId;
    if (options.midiInputTrackId !== undefined) {
        desiredMidiInputTrackId = options.midiInputTrackId;
    } else if (armed && track.kind === 'midi') {
        desiredMidiInputTrackId = trackId;
    } else if (!armed && previousMidiInputTrackId === trackId) {
        desiredMidiInputTrackId = null;
    }

    updateTrack(trackId, (candidate) => ({ ...candidate, armed }));

    function applyMidiInputTrack(nextTrackId: string | null): void {
        if (getMidiInputTrack() !== nextTrackId) {
            setMidiInputTrack(nextTrackId);
        }
    }

    let runtimeEffectFinalized = false;
    function finalizeRuntimeEffect(): void {
        if (runtimeEffectFinalized) {
            return;
        }
        applyMidiInputTrack(desiredMidiInputTrackId);
        runtimeEffectFinalized = true;
    }

    function reconcileRuntimeEffect(): void {
        const committedTrack = getTrackById(trackId);
        if (committedTrack?.armed === armed) {
            applyMidiInputTrack(desiredMidiInputTrackId);
            return;
        }
        applyMidiInputTrack(previousMidiInputTrackId);
    }

    if (options.deferRuntimeEffect) {
        return {
            afterCommit: finalizeRuntimeEffect,
            afterAmbiguousCommit: reconcileRuntimeEffect,
        };
    }

    finalizeRuntimeEffect();
    return true;
}
