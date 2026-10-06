import { projectClipControllerEvents } from '#/modules/MIDI/useCases';
import { CC_SUSTAIN_PEDAL, isPianoPedalMoveEngaged, resolvePianoPedalMove } from '#/utils/pianoPedalController';

import { noteStoredControllerMove } from '../../services/storedControllerEngagement';

type ClipControllerProjection = Parameters<typeof projectClipControllerEvents>[0];

/** The two instruments that honour stored controllers (local shape: cross-module model isolation). */
type StoredControllerNode = {
    grandBouleControls?: {
        setSustain: (position: number, sampleFrame?: number) => void;
        setSostenuto: (engaged: boolean, sampleFrame?: number) => void;
        setUnaCorda: (engaged: boolean, sampleFrame?: number) => void;
    };
    levainControls?: {
        handleCc: (cc: number, value: number, sampleFrame?: number) => void;
    };
};

type ScheduleStoredControllersInput = {
    trackId: string;
    device: { id: string; type: string };
    node: StoredControllerNode;
    controlChanges: ClipControllerProjection['controlChanges'];
    clip: ClipControllerProjection['clip'];
    /** The scheduler window `[fromBeat, toBeat)` this call owns. */
    fromBeat: number;
    toBeat: number;
    /** The sample frame a note at this beat is posted at. */
    sampleFrameAtBeat: (beat: number) => number;
    isCurrent: () => boolean;
};

/**
 * Post the stored controller moves a clip owns in one scheduler window to the
 * instrument that honours them, each at its own sample frame.
 *
 * Grand Boule takes CC64 as a sustain position and CC66 / CC67 as latches; Levain
 * takes the raw controller byte. Every other instrument ignores stored
 * controllers. The caller posts these before the clip's notes so a note struck on
 * the same frame sounds under the move it was recorded with.
 *
 * Each pedal a move leaves engaged is recorded, so a stop or a locate can release
 * it; a Levain controller other than the sustain pedal is not a held pedal and is
 * left where the lane put it.
 */
export function scheduleStoredControllers({
    trackId,
    device,
    node,
    controlChanges,
    clip,
    fromBeat,
    toBeat,
    sampleFrameAtBeat,
    isCurrent,
}: ScheduleStoredControllersInput): void {
    const moves = projectClipControllerEvents({ controlChanges, clip, fromBeat, toBeat });
    for (const move of moves) {
        if (!isCurrent()) {
            return;
        }
        const sampleFrame = sampleFrameAtBeat(move.beat);
        const grandBoule = device.type === 'grand-boule' ? node.grandBouleControls : undefined;
        if (grandBoule) {
            const pedal = resolvePianoPedalMove(move.controller, move.value);
            if (pedal === null) {
                continue;
            }
            if (pedal.pedal === 'sustain') {
                grandBoule.setSustain(pedal.position, sampleFrame);
            } else if (pedal.pedal === 'sostenuto') {
                grandBoule.setSostenuto(pedal.engaged, sampleFrame);
            } else {
                grandBoule.setUnaCorda(pedal.engaged, sampleFrame);
            }
            noteStoredControllerMove({
                trackId,
                deviceId: device.id,
                deviceType: device.type,
                controller: move.controller,
                engaged: isPianoPedalMoveEngaged(pedal),
            });
            continue;
        }
        const levain = device.type === 'levain' ? node.levainControls : undefined;
        if (levain) {
            levain.handleCc(move.controller, move.value, sampleFrame);
            if (move.controller === CC_SUSTAIN_PEDAL) {
                noteStoredControllerMove({
                    trackId,
                    deviceId: device.id,
                    deviceType: device.type,
                    controller: move.controller,
                    engaged: move.value > 0,
                });
            }
        }
    }
}
