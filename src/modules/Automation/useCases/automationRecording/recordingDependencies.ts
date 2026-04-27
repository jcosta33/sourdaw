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

let dependencies: AutomationRecordingDependencies | null = null;

export function setAutomationRecordingDependencies(deps: AutomationRecordingDependencies): void {
    dependencies = deps;
}

export function getAutomationRecordingDependencies(): AutomationRecordingDependencies {
    if (!dependencies) {
        throw new Error('Automation recording dependencies not initialized');
    }
    return dependencies;
}
