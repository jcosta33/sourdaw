import { disarmRetrospectiveCapture } from '#/modules/AudioEngine/useCases';

/**
 * The main process and its native engine outlive a desktop renderer: a window
 * reopened from the Dock, crash recovery and a reload all start a new renderer
 * against the same engine. An arm the previous renderer left recorded would be
 * re-applied by this renderer's first graph batch while punch starts off here,
 * so a new renderer clears it before it can issue an arm of its own.
 */
export function clearInheritedRetrospectiveCaptureArm(): void {
    disarmRetrospectiveCapture();
}
