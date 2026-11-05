/** Payload for the unified device-panel event — one event for every panel open. */
export type ShowDevicePanelGenericPayload = { deviceType: string; deviceId: string | null };

// The dialog-service payload contracts (ui.notify / ui.confirm / ui.prompt) now
// live in #/utils/Notification/notificationEventBus alongside their producers,
// after DialogService left this module for src/infra (ADR 0011 W6.1). The
// WorkspaceEventBus map below still references them, so re-export here.
export type { NotifyPayload, ConfirmPayload, PromptPayload } from '#/utils/Notification/notificationEventBus';

/** Payload for the zoom-to-selection event. */
export type ZoomToSelectionPayload = { startBeat: number; endBeat: number };

/** Payload for MIDI import event. */
export type ImportMidiPayload = { file: File };
