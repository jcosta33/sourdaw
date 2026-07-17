// PunchRecording/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { commitPunchRegion } from './punchRecording/commitPunchRegion';
export { definePunchRegion } from './punchRecording/definePunchRegion';
export { discardCapture } from './punchRecording/discardCapture';
export { setPostRoll } from './punchRecording/setPostRoll';
export { setPreRoll } from './punchRecording/setPreRoll';
export { startBackgroundCapture } from './punchRecording/startBackgroundCapture';
export { stopBackgroundCapture } from './punchRecording/stopBackgroundCapture';
export { togglePunchRecording } from './punchRecording/togglePunchRecording';
export { updateCapturePosition } from './punchRecording/updateCapturePosition';

export { getPunchRecordingHandlers } from './getPunchRecordingHandlers';
