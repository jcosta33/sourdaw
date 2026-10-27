import { type AudioPreviewIntent } from '../../models/AudioPreviewIntent';

/**
 * Main-thread intent ownership only. A current intent may prepare audio; starting it also requires
 * the listening gate's readiness and another currentness check after every asynchronous boundary.
 */
export function createAudioPreviewIntents() {
    const ordinary = new Set<AbortController>();
    let exclusive: AbortController | null = null;
    let disposed = false;

    function intent(controller: AbortController): AudioPreviewIntent {
        return {
            signal: controller.signal,
            isCurrent: () => !controller.signal.aborted,
            release: () => {
                ordinary.delete(controller);
                if (exclusive === controller) {
                    exclusive = null;
                }
                controller.abort('released');
            },
        };
    }

    function beginOrdinary(): AudioPreviewIntent {
        const controller = new AbortController();
        if (disposed) {
            controller.abort('disposed');
            return intent(controller);
        }
        const previous = exclusive;
        exclusive = null;
        ordinary.add(controller);
        // Publish the new intent before callbacks: a reentrant gesture is newer and may preempt it.
        previous?.abort('preempted');
        return intent(controller);
    }

    function beginExclusive(): AudioPreviewIntent {
        const controller = new AbortController();
        if (disposed) {
            controller.abort('disposed');
            return intent(controller);
        }
        const previous = exclusive;
        const previousOrdinary = [...ordinary];
        ordinary.clear();
        exclusive = controller;
        previous?.abort('preempted');
        for (const pending of previousOrdinary) {
            pending.abort('preempted');
        }
        return intent(controller);
    }

    function dispose(): void {
        if (disposed) {
            return;
        }
        // Teardown callbacks cannot register work against the outgoing engine lifetime.
        disposed = true;
        const previous = exclusive;
        const previousOrdinary = [...ordinary];
        exclusive = null;
        ordinary.clear();
        previous?.abort('disposed');
        for (const pending of previousOrdinary) {
            pending.abort('disposed');
        }
    }

    return { beginOrdinary, beginExclusive, dispose };
}
