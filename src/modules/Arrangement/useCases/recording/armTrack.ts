import { getMidiInputTrack, setMidiInputTrack } from '#/modules/MIDI/useCases';

import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getTrackEligibility } from '../../stores/trackEligibility';

type ArmTrackOptions = {
    deferRuntimeEffect?: boolean;
    midiInputTrackId?: string | null;
    expectedMidiInputTrackId?: string | null;
};

type DeferredArmTrackRuntimeEffect = {
    afterCommit: () => void;
    afterAmbiguousCommit: () => void;
};

type DeferredArmTrackOptions = ArmTrackOptions & { deferRuntimeEffect: true };

export function armTrack(trackId: string, armed: boolean): boolean;
export function armTrack(
    trackId: string,
    armed: boolean,
    options: DeferredArmTrackOptions
): DeferredArmTrackRuntimeEffect | null;
export function armTrack(
    trackId: string,
    armed: boolean,
    options: ArmTrackOptions = {}
): boolean | DeferredArmTrackRuntimeEffect | null {
    const track = getTrackById(trackId);
    if (!track) {
        return false;
    }

    const previousMidiInputTrackId = getMidiInputTrack();
    const runtimeRouteExpectation =
        options.expectedMidiInputTrackId === undefined ? previousMidiInputTrackId : options.expectedMidiInputTrackId;
    const expectedRouteMatches = previousMidiInputTrackId === runtimeRouteExpectation;
    let desiredMidiInputTrackId = previousMidiInputTrackId;
    if (expectedRouteMatches) {
        if (options.midiInputTrackId !== undefined) {
            desiredMidiInputTrackId = options.midiInputTrackId;
        } else if (armed && track.kind === 'midi') {
            desiredMidiInputTrackId = trackId;
        } else if (!armed && previousMidiInputTrackId === trackId) {
            desiredMidiInputTrackId = null;
        }
    }

    const projectStateChanged = track.armed !== armed;
    const runtimeStateChanged = desiredMidiInputTrackId !== previousMidiInputTrackId;
    if (!projectStateChanged && !runtimeStateChanged) {
        return false;
    }
    if (armed && !getTrackEligibility(track.kind).acceptsArm) {
        return false;
    }
    if (projectStateChanged) {
        updateTrack(trackId, (candidate) => ({ ...candidate, armed }));
    }

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
        if (expectedRouteMatches && getMidiInputTrack() === runtimeRouteExpectation) {
            applyMidiInputTrack(desiredMidiInputTrackId);
        }
        runtimeEffectFinalized = true;
    }

    function reconcileRuntimeEffect(): void {
        const committedTrack = getTrackById(trackId);
        if (committedTrack?.armed !== armed) {
            return;
        }
        if (!expectedRouteMatches || getMidiInputTrack() !== runtimeRouteExpectation) {
            return;
        }
        applyMidiInputTrack(desiredMidiInputTrackId);
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
