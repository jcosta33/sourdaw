const admittedGestures = new WeakSet<object>();

/**
 * Issues and consumes browser-owned trusted-event tokens. The registry's
 * module-private WeakSet makes tokens unforgeable and one-use.
 */
export const voiceCommandGesture = {
    issue(event: Event): object | null {
        if (!event.isTrusted) {
            return null;
        }
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
