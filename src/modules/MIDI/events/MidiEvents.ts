/** Payload for MIDI out event. */
export type MidiOutPayload = { type: string; channel: number; program: number };

/** Payload for MIDI note-on event from external controller. */
export type MidiNoteOnPayload = { deviceId?: string; midiNote: number; velocity: number };

/**
 * Payload for MIDI note-off event from external controller.
 *
 * `releaseVelocity` is the normalized (0..1) release/note-off velocity carried
 * by the MIDI Note Off message (`data[2]` of the raw status bytes). It is
 * optional because not every controller sends it and not every emitter has it;
 * subscribers that drive an instrument release (e.g. `engine.noteOff`) read it
 * when present so the release dynamic is not dropped at the event boundary.
 */
export type MidiNoteOffPayload = { deviceId?: string; midiNote: number; releaseVelocity?: number };

/** Payload for MIDI pedal CC event. */
export type MidiPedalCcPayload = { deviceId?: string; cc: number; value: number | boolean };
