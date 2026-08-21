/** Payload for panel-toggle events that carry an optional device ID. */
export type ShowDevicePanelPayload = { deviceId: string | null };

/** Payload for the unified device-panel event (replaces per-device events). */
export type ShowDevicePanelGenericPayload = { deviceType: string; deviceId: string | null };

/** Payload for events that carry no data. */
export type VoidPayload = undefined;

// The dialog-service payload contracts (ui.notify / ui.confirm / ui.prompt) now
// live in #/utils/Notification/notificationEventBus alongside their producers,
// after DialogService left this module for src/infra (ADR 0011 W6.1). The
// WorkspaceEventBus map below still references them, so re-export here.
export type { NotifyPayload, ConfirmPayload, PromptPayload } from '#/utils/Notification/notificationEventBus';

/** Payload for the zoom-to-selection event. */
export type ZoomToSelectionPayload = { startBeat: number; endBeat: number };

/** A one-use, AiRuntime-issued admission token for a voice-command start. */
export type ToggleVoiceCommandPayload = { gesture?: unknown };

/** Payload for MIDI import event. */
export type ImportMidiPayload = { file: File };

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
