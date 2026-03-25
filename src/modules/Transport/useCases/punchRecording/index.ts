// Types
export type {
    PunchRegion,
    BackgroundCapture,
    PunchRecordingState,
} from '#/modules/Transport/stores/punchRecordingStore';
export { punchRecordingStore } from '#/modules/Transport/stores/punchRecordingStore';

// Background capture control
export { togglePunchRecording } from './togglePunchRecording';
export { startBackgroundCapture } from './startBackgroundCapture';
export { updateCapturePosition } from './updateCapturePosition';
export { stopBackgroundCapture } from './stopBackgroundCapture';

// Punch regions
export { definePunchRegion } from './definePunchRegion';
export { commitPunchRegion } from './commitPunchRegion';
export { discardCapture } from './discardCapture';

// Settings
export { setPreRoll } from './setPreRoll';
export { setPostRoll } from './setPostRoll';
