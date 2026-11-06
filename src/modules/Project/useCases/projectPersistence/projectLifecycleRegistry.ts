import { type HydratableProjectData } from './helpers/isHydratableProjectData';

/**
 * What a project reset asks of its participants. Each participant reads only
 * the options it owns.
 */
type ProjectResetOptions = {
    createNewMidiProbabilitySeed: boolean;
    resetGrooveTemplates: boolean;
    resetMidiState: boolean;
    resetYeastState: boolean;
};

/**
 * One owner's part in the project lifecycle. A module that takes part at more
 * than one point of a phase registers one participant per point, told apart by
 * `part`, because the registered order is the order every phase runs in.
 */
type ProjectLifecycleParticipant = {
    module: string;
    part?: string;
    resetForProject?: (options: ProjectResetOptions) => void;
    hydrateFromProjectData?: (data: HydratableProjectData) => void;
};

let registeredParticipants: readonly ProjectLifecycleParticipant[] | null = null;

function participantName({ module, part }: ProjectLifecycleParticipant): string {
    return part === undefined ? module : `${module} (${part})`;
}

function assertDistinctParticipants(participants: readonly ProjectLifecycleParticipant[]): void {
    const seen = new Set<string>();
    for (const participant of participants) {
        const name = participantName(participant);
        if (seen.has(name)) {
            throw new Error(`projectLifecycleRegistry.configure: participant '${name}' is registered twice`);
        }
        seen.add(name);
    }
}

function findFirstChangedParticipant(
    current: readonly ProjectLifecycleParticipant[],
    next: readonly ProjectLifecycleParticipant[]
): string | null {
    const length = Math.max(current.length, next.length);
    for (let index = 0; index < length; index += 1) {
        if (current[index] !== next[index]) {
            const changed = next[index] ?? current[index];
            return changed === undefined ? null : participantName(changed);
        }
    }
    return null;
}

/**
 * The ordered participants of a project reset and hydrate. Project cannot import
 * the modules whose stores a project switch resets — most of them sit in a tier
 * Project may not depend on, and some import Project themselves — so the
 * composition root (`#/app/registerProjectLifecycle`) configures the list once
 * at boot, before anything can reset or load a project; the list order is the
 * order both phases run in.
 */
export const projectLifecycleRegistry = {
    /**
     * Registering the identical list again is a no-op, so a caller that cannot
     * know whether registration already ran may repeat it. Any other change
     * refuses: a participant listed twice, or a list that differs from the
     * registered one.
     */
    configure(participants: readonly ProjectLifecycleParticipant[]): void {
        assertDistinctParticipants(participants);
        if (registeredParticipants === null) {
            registeredParticipants = [...participants];
            return;
        }
        const changedParticipant = findFirstChangedParticipant(registeredParticipants, participants);
        if (changedParticipant !== null) {
            throw new Error(
                `projectLifecycleRegistry.configure: participant '${changedParticipant}' differs from the registered list`
            );
        }
    },
    /**
     * The registered participants, in lifecycle order. Reading before
     * registration throws rather than answering an empty list: an empty registry
     * would silently leave the outgoing project's state in every module.
     */
    read(caller: string): readonly ProjectLifecycleParticipant[] {
        if (registeredParticipants === null) {
            throw new Error(
                `${caller}: project lifecycle participants are not registered; call registerProjectLifecycle() from #/app/registerProjectLifecycle (bootstrap does this)`
            );
        }
        return registeredParticipants;
    },
};
