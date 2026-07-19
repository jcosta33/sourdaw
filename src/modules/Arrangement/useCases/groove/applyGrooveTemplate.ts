import { projectCommittedGroove } from '#/modules/MIDI/useCases';

/**
 * Apply a groove template to the project or a specific clip (H4).
 * This logic computes the timing offset for a given beat based on the active groove.
 */
export function getGrooveOffsetAtBeat(beat: number): number {
    const event = { id: 'project-groove-probe', startBeat: beat, velocity: 64 };
    const [projected = event] = projectCommittedGroove({
        events: [event],
        consumerType: 'sequencer',
        consumerId: 'project',
    });
    return projected.startBeat - beat;
}
