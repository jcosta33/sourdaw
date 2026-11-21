/**
 * Cross-module reads that automation recording needs to compensate for
 * hardware/round-trip latency when timestamping recorded values. Registered
 * once at app init (`src/app/bootstrap.ts`) with real implementations.
 * Pulling these out of `recordAutomationValue.ts` into a DI seam breaks the
 * `Automation/useCases → AudioEngine/useCases → ... → Automation/useCases`
 * static cycle.
 */
export type AutomationRecordingDependencies = {
    getAudioContext: () => AudioContext;
    getCompensationDelay: (trackId: string) => number;
};

let registeredDependencies: AutomationRecordingDependencies | null = null;

/** Stores the implementation; a later fill replaces an earlier one. */
export function setAutomationRecordingDependencies(deps: AutomationRecordingDependencies): void {
    registeredDependencies = deps;
}

/**
 * The registered readers. Reading before registration throws rather than
 * stamping recorded points without latency compensation.
 */
export const automationRecordingDependenciesPort = {
    read(): AutomationRecordingDependencies {
        if (registeredDependencies === null) {
            throw new Error(
                'automationRecordingDependenciesPort.read: automation recording dependencies are not registered; call setAutomationRecordingDependencies() from #/app/bootstrap (bootstrap does this)'
            );
        }
        return registeredDependencies;
    },
};
