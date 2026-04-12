/** Payload for panel-toggle events that carry an optional device ID. */
export type ShowDevicePanelPayload = { deviceId: string | null };

/** Payload for the unified device-panel event (replaces per-device events). */
export type ShowDevicePanelGenericPayload = { deviceType: string; deviceId: string | null };

/** Payload for events that carry no data. */
export type VoidPayload = undefined;

/** Payload for the notification event. */
export type NotifyPayload = { message: string; level: 'info' | 'success' | 'warning' | 'error' };

/** Payload for the zoom-to-selection event. */
export type ZoomToSelectionPayload = { startBeat: number; endBeat: number };

/** Payload for toggle-voice-command event. */
export type ToggleVoiceCommandPayload = { active?: boolean };

/** Payload for MIDI import event. */
export type ImportMidiPayload = { file: File };

/** Payload for MIDI out event. */
export type MidiOutPayload = { type: string; channel: number; program: number };

/** Payload for MIDI note-on event from external controller. */
export type MidiNoteOnPayload = { midiNote: number; velocity: number };

/** Payload for MIDI note-off event from external controller. */
export type MidiNoteOffPayload = { midiNote: number };

/** Payload for MIDI pedal CC event. */
export type MidiPedalCcPayload = { cc: number; value: number | boolean };
