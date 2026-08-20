/**
 * How the native export gets its automation writes (#2225), part one: the
 * recording parameter.
 *
 * The lane laws — link resolution, the decibel fader law, the VCA fold, the
 * send clamp, clip windows, tempo projection, latency compensation — live in
 * `scheduleTrackAutomation`, and the Web Audio path receives them as
 * `setValueAtTime`/`linearRampToValueAtTime` calls on real `AudioParam`s. A
 * second compiler for the native path would be a copy of those laws that
 * agrees today and drifts tomorrow. So the native path runs the *same*
 * scheduler against this recorder, then converts what was recorded through
 * `convertRecordedAutomationEvents`.
 */

export type RecordedAutomationEvent = Readonly<{
    kind: 'set' | 'linear';
    value: number;
    timeSeconds: number;
}>;

export type AutomationRecorder = Readonly<{
    /** Hand this to `scheduleTrackAutomation` in a node position. */
    param: AudioParam;
    /** What the scheduler wrote, in call order. */
    events: readonly RecordedAutomationEvent[];
}>;

/**
 * An `AudioParam` that records the two calls the offline automation compiler
 * emits. Every other member throws by name: the compiler never produces them,
 * so a call reaching one means the compiler changed shape and the conversion
 * must be revisited — silence there would drop automation from the export.
 */
export function createAutomationRecorder(): AutomationRecorder {
    const events: RecordedAutomationEvent[] = [];
    const refuse = (method: string): never => {
        throw new Error(`native automation recorder: the offline compiler never emits ${method}`);
    };
    const param: AudioParam = {
        automationRate: 'a-rate',
        defaultValue: 0,
        maxValue: Number.POSITIVE_INFINITY,
        minValue: Number.NEGATIVE_INFINITY,
        value: 0,
        setValueAtTime(value: number, startTime: number): AudioParam {
            events.push({ kind: 'set', value, timeSeconds: startTime });
            return param;
        },
        linearRampToValueAtTime(value: number, endTime: number): AudioParam {
            events.push({ kind: 'linear', value, timeSeconds: endTime });
            return param;
        },
        cancelAndHoldAtTime: () => refuse('cancelAndHoldAtTime'),
        cancelScheduledValues: () => refuse('cancelScheduledValues'),
        exponentialRampToValueAtTime: () => refuse('exponentialRampToValueAtTime'),
        setTargetAtTime: () => refuse('setTargetAtTime'),
        setValueCurveAtTime: () => refuse('setValueCurveAtTime'),
    };
    return { param, events };
}
