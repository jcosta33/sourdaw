import type { midiMessageHandlerDependencies } from './midiMessageHandlerDependencies';

export type MidiLearnSnapshot = ReturnType<(typeof midiMessageHandlerDependencies)['getMidiLearnState']>;

/** Whether the next controller message is taken by MIDI learn as the control's mapping instead of acting. */
export function isCapturedByMidiLearn(learnState: MidiLearnSnapshot): boolean {
    return learnState?.isLearning === true && Boolean(learnState.learningTarget);
}
