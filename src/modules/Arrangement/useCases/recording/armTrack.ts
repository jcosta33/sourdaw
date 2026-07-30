import {
    getMidiInputTrack,
    getMidiInputTrackOwnerId,
    getMidiInputTrackRevision,
    setMidiInputTrack,
} from '#/modules/MIDI/useCases';

import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getTrackEligibility } from '../../stores/trackEligibility';

type ArmTrackOptions = {
    deferRuntimeEffect?: boolean;
    midiInputTrackId?: string | null;
    expectedMidiInputTrackId?: string | null;
    midiInputOwnerId?: string | null;
    expectedMidiInputOwnerId?: string | null;
};

type DeferredArmTrackRuntimeEffect = {
    afterCommit: () => void;
    afterAmbiguousCommit: () => void;
};

type DeferredArmTrackOptions = ArmTrackOptions & { deferRuntimeEffect: true };

let lastArmTrackMidiInputRevision: number | null = null;

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
    const previousMidiInputOwnerId = getMidiInputTrackOwnerId();
    const previousMidiInputTrackRevision = getMidiInputTrackRevision();
    const hasExplicitRouteExpectation =
        options.expectedMidiInputTrackId !== undefined || options.expectedMidiInputOwnerId !== undefined;
    const runtimeRouteExpectation =
        options.expectedMidiInputTrackId === undefined ? previousMidiInputTrackId : options.expectedMidiInputTrackId;
    const runtimeOwnerExpectation =
        options.expectedMidiInputOwnerId === undefined ? previousMidiInputOwnerId : options.expectedMidiInputOwnerId;
    const expectedRouteMatches =
        previousMidiInputTrackId === runtimeRouteExpectation && previousMidiInputOwnerId === runtimeOwnerExpectation;
    const actionOwnerId = options.midiInputOwnerId === undefined ? null : options.midiInputOwnerId;
    let desiredMidiInputTrackId = previousMidiInputTrackId;
    let desiredMidiInputOwnerId = previousMidiInputOwnerId;
    if (expectedRouteMatches) {
        if (options.midiInputTrackId !== undefined) {
            desiredMidiInputTrackId = options.midiInputTrackId;
            desiredMidiInputOwnerId = actionOwnerId;
        } else if (armed && track.kind === 'midi') {
            desiredMidiInputTrackId = trackId;
            desiredMidiInputOwnerId = actionOwnerId;
        } else if (!armed && previousMidiInputTrackId === trackId) {
            desiredMidiInputTrackId = null;
            desiredMidiInputOwnerId = actionOwnerId;
        }
    }

    const projectStateChanged = track.armed !== armed;
    const runtimeStateChanged =
        desiredMidiInputTrackId !== previousMidiInputTrackId || desiredMidiInputOwnerId !== previousMidiInputOwnerId;
    if (!projectStateChanged && !runtimeStateChanged) {
        return false;
    }
    if (armed && !getTrackEligibility(track.kind).acceptsArm) {
        return false;
    }
    if (projectStateChanged) {
        updateTrack(trackId, (candidate) => ({ ...candidate, armed }));
    }

    function applyMidiInputTrack(nextTrackId: string | null, nextOwnerId: string | null): void {
        if (getMidiInputTrack() === nextTrackId && getMidiInputTrackOwnerId() === nextOwnerId) {
            return;
        }
        setMidiInputTrack(nextTrackId, nextOwnerId);
        lastArmTrackMidiInputRevision = getMidiInputTrackRevision();
    }

    function ownsRuntimeRoute(): boolean {
        const currentMidiInputTrackId = getMidiInputTrack();
        const currentMidiInputOwnerId = getMidiInputTrackOwnerId();
        const currentMidiInputTrackRevision = getMidiInputTrackRevision();
        const stillOwnsOriginalRoute =
            expectedRouteMatches &&
            currentMidiInputTrackId === runtimeRouteExpectation &&
            currentMidiInputOwnerId === runtimeOwnerExpectation &&
            currentMidiInputTrackRevision === previousMidiInputTrackRevision;
        if (stillOwnsOriginalRoute) {
            return true;
        }
        if (hasExplicitRouteExpectation || lastArmTrackMidiInputRevision === null) {
            return false;
        }
        return (
            currentMidiInputOwnerId !== null &&
            currentMidiInputTrackRevision === lastArmTrackMidiInputRevision &&
            currentMidiInputTrackRevision > previousMidiInputTrackRevision
        );
    }

    let runtimeEffectFinalized = false;
    function finalizeRuntimeEffect(): void {
        if (runtimeEffectFinalized) {
            return;
        }
        if (ownsRuntimeRoute()) {
            applyMidiInputTrack(desiredMidiInputTrackId, desiredMidiInputOwnerId);
        }
        runtimeEffectFinalized = true;
    }

    function reconcileRuntimeEffect(): void {
        const committedTrack = getTrackById(trackId);
        if (committedTrack?.armed !== armed) {
            return;
        }
        if (!ownsRuntimeRoute()) {
            return;
        }
        applyMidiInputTrack(desiredMidiInputTrackId, desiredMidiInputOwnerId);
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
