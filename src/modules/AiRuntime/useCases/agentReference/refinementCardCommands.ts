import { type ProjectContext } from '../../models/ProjectContext';
import { type ProposalGroundingBasis, type ProposalGroundingCommand } from '../../models/ProposalGroundingBasis';

/** One pending command of the card a refinement refines, by its index, and every object id it denotes. */
export type CommandView = { index: number; command: ProposalGroundingCommand; denotes: ReadonlySet<string> };

function findOwnerTrackId(context: ProjectContext, objectId: string): string | null {
    const owner = context.tracks.find(
        (track) =>
            track.devices.some((device) => device.id === objectId) || track.clips.some((clip) => clip.id === objectId)
    );
    return owner?.id ?? null;
}

/** Every object id a pending command acts on, its device parameter, and the track that owns it. */
function getCommandDenotation(command: ProposalGroundingCommand, context: ProjectContext): Set<string> {
    const ids = new Set<string>();
    const deviceId = command.targets.find((target) => target.argument === 'deviceId')?.id;
    for (const target of command.targets) {
        if (target.argument === 'paramId' && deviceId !== undefined) {
            ids.add(`${deviceId}:${target.id}`);
            continue;
        }
        ids.add(target.id);
        const owner = findOwnerTrackId(context, target.id);
        if (owner !== null) {
            ids.add(owner);
        }
    }
    return ids;
}

function intersects(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
    for (const id of left) {
        if (right.has(id)) {
            return true;
        }
    }
    return false;
}

function nameObject(context: ProjectContext, id: string): string {
    return (
        context.tracks.find((track) => track.id === id)?.name ??
        context.vcaGroups?.find((group) => group.id === id)?.name ??
        id
    );
}

function viewCommands(basis: ProposalGroundingBasis, context: ProjectContext): CommandView[] {
    return basis.commands.map((command, index) => ({
        index,
        command,
        denotes: getCommandDenotation(command, context),
    }));
}

/** How the refinement reader views the pending commands of the card it refines, and names their objects. */
export const refinementCardCommands = {
    view: viewCommands,
    intersects,
    name: nameObject,
} as const;
