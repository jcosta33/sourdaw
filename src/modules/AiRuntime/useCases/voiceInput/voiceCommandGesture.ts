const admittedGestures = new WeakSet<object>();
const issuedEvents = new WeakSet<Event>();

const isCurrentVoiceControlEvent = (event: unknown): event is MouseEvent => {
    if (!(event instanceof MouseEvent) || !event.isTrusted || issuedEvents.has(event)) {
        return false;
    }
    const target = event.target;
    return target instanceof Element && target.closest('[data-voice-command-control="true"]') !== null;
};

/**
 * Issues and consumes browser-owned trusted-event tokens. The registry's
 * module-private WeakSet makes tokens unforgeable and one-use.
 */
export const voiceCommandGesture = {
    issue(event: unknown): object | null {
        if (!isCurrentVoiceControlEvent(event)) {
            return null;
        }
        issuedEvents.add(event);
        const token = Object.freeze({});
        admittedGestures.add(token);
        return token;
    },

    consume(input: unknown): boolean {
        if (typeof input !== 'object' || input === null || !admittedGestures.has(input)) {
            return false;
        }
        admittedGestures.delete(input);
        return true;
    },
};
