import { type AutomationRecordingDependencies, dependencies } from './recordingDependencies';

export function getAutomationRecordingDependencies(): AutomationRecordingDependencies {
    if (!dependencies) {
        throw new Error('Automation recording dependencies not initialized');
    }
    return dependencies;
}
