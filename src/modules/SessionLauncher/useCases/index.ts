// SessionLauncher/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

// ── Session Launch (bare UI slot map, unwired to playback) ──────────────────────

export { launchSessionScene } from './sessionLaunch/launchSessionScene';
export { stopAllSessionSlots } from './sessionLaunch/stopAllSessionSlots';
export { toggleSessionSlot } from './sessionLaunch/toggleSessionSlot';

// ── Loop Station (live-looper state machine) ────────────────────────────────────

export { toggleRecord } from './loopStation/toggleRecord';
export { triggerPad } from './loopStation/triggerPad';
export { triggerScene } from './loopStation/triggerScene';
export { triggerSlot } from './loopStation/triggerSlot';
export { stopAllSlots } from './loopStation/stopAllSlots';

// ── Handlers ────────────────────────────────────────────────────────────────────

export { getSessionLauncherHandlers } from './getSessionLauncherHandlers';
