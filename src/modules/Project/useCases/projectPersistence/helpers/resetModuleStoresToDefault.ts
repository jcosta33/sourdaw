import { projectLifecycleRegistry } from '../projectLifecycleRegistry';

type ResetModuleStoresToDefaultInput = {
    createNewMidiProbabilitySeed?: boolean;
    resetGrooveTemplates?: boolean;
    resetMidiState?: boolean;
    resetYeastState?: boolean;
};

/**
 * Reset every module's project-scoped state for the incoming project, through
 * the participants the composition root registered, in their registered order.
 * A project load passes `false` for the state its own hydration replaces.
 */
export function resetModuleStoresToDefault({
    createNewMidiProbabilitySeed = false,
    resetGrooveTemplates = true,
    resetMidiState = true,
    resetYeastState = true,
}: ResetModuleStoresToDefaultInput = {}): void {
    const options = { createNewMidiProbabilitySeed, resetGrooveTemplates, resetMidiState, resetYeastState };
    for (const participant of projectLifecycleRegistry.read('resetModuleStoresToDefault')) {
        participant.resetForProject?.(options);
    }
}
