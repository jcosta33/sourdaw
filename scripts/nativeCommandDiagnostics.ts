import { captureProcessGroupSnapshot, type ProcessGroupSnapshot } from './processSnapshot.ts';

export type OwnershipDiagnostic = {
    operation: 'inspect' | 'terminate';
    signal: NodeJS.Signals | 0;
    code?: string;
    errno?: number;
};
export type ProcessDiagnostic = {
    groupId?: number;
    timeline: Array<{ event: string; elapsedMs: number; diagnostic?: OwnershipDiagnostic }>;
    omittedEvents: number;
    firstUncertainty?: { diagnostic: OwnershipDiagnostic; elapsedMs: number; snapshot: ProcessGroupSnapshot };
    finalUncertainty?: { elapsedMs: number; snapshot: ProcessGroupSnapshot };
};
export function createNativeCommandDiagnostics(
    pid: number | undefined,
    options: { now?: () => number; snapshot?: (pid: number) => ProcessGroupSnapshot }
) {
    const clock = options.now ?? (() => performance.now());
    let lastTime = 0;
    const readClock = () => {
        try {
            const value = clock();
            if (Number.isFinite(value)) {
                lastTime = Math.max(lastTime, value);
            }
        } catch {
            // Diagnostics must not affect ownership decisions.
        }
        return lastTime;
    };
    const started = readClock();
    const elapsed = () => Math.round(readClock() - started);
    const processDiagnostic: ProcessDiagnostic = { groupId: pid, timeline: [], omittedEvents: 0 };
    const snapshot = (): ProcessGroupSnapshot => {
        try {
            if (pid === undefined) {
                return { status: 'unavailable' };
            }
            return (options.snapshot ?? captureProcessGroupSnapshot)(pid);
        } catch {
            return { status: 'unavailable' };
        }
    };
    const observe = (event: string, diagnostic?: OwnershipDiagnostic) => {
        try {
            const entry: ProcessDiagnostic['timeline'][number] = { event, elapsedMs: elapsed() };
            if (diagnostic !== undefined) {
                entry.diagnostic = diagnostic;
            }
            if (processDiagnostic.timeline.length >= 64) {
                processDiagnostic.timeline.splice(32, 1);
                processDiagnostic.omittedEvents += 1;
            }
            processDiagnostic.timeline.push(entry);
            if (diagnostic !== undefined && processDiagnostic.firstUncertainty === undefined) {
                const state = snapshot();
                processDiagnostic.firstUncertainty = { diagnostic, elapsedMs: elapsed(), snapshot: state };
            }
        } catch {
            // Diagnostics must not affect ownership decisions.
        }
    };
    const finalUncertainty = () => {
        const state = snapshot();
        processDiagnostic.finalUncertainty = { elapsedMs: elapsed(), snapshot: state };
    };
    return { processDiagnostic, observe, finalUncertainty };
}
