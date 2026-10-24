import {
    type ProposalGroundingBasis,
    type ProposalGroundingCall,
    type ProposalGroundingCommand,
    type ProposalGroundingSource,
} from '../../models/ProposalGroundingBasis';
import { unionProtectedObjects } from '../../transformers/unionProtectedObjects';

import { proposalCommandShape } from './proposalCommandShape';

type ProtectedObject = ProposalGroundingBasis['protectedUnchanged'][number];
type ProtectedControl = NonNullable<ProposalGroundingBasis['protectedControls']>[number];

/** Unions positive controls per track while retaining every independent whole-object restriction. */
function unionProtectedControls(...groups: ReadonlyArray<readonly ProtectedControl[]>): ProtectedControl[] {
    const byTrack = new Map<string, Set<string>>();
    const complements: ProtectedControl[] = [];
    for (const { trackId, operations, exceptOperations } of groups.flat()) {
        if (exceptOperations !== undefined) {
            // Independent restrictions remain independent: joining their exceptions would widen permission.
            complements.push({ trackId, operations: [...operations], exceptOperations: [...exceptOperations] });
            continue;
        }
        const known = byTrack.get(trackId);
        if (known === undefined) {
            byTrack.set(trackId, new Set(operations));
        } else {
            for (const operation of operations) {
                known.add(operation);
            }
        }
    }
    return [
        ...Array.from(byTrack, ([trackId, operations]) => ({ trackId, operations: [...operations] })),
        ...complements,
    ];
}

type GroundedCall = { name: string; arguments: Readonly<Record<string, unknown>> };

function toGroundingCall(call: GroundedCall): ProposalGroundingCall {
    return { name: call.name, arguments: structuredClone(call.arguments) };
}

function toGroundingCommand(call: ProposalGroundingCall, source: number, sourceCallIndex: number) {
    return {
        type: call.name,
        payload: structuredClone(call.arguments),
        targets: proposalCommandShape.targets(call.name, call.arguments),
        source,
        sourceCallIndex,
        value: proposalCommandShape.value(call.name, call.arguments),
    } satisfies ProposalGroundingCommand;
}

/** The basis an ordinary card carries when the request that made it is the first of its chain. */
function createProposalGroundingBasis(input: {
    prompt: string;
    calls: readonly GroundedCall[];
    protectedUnchanged: readonly ProtectedObject[];
    protectedControls: readonly ProtectedControl[];
}): ProposalGroundingBasis {
    const calls = input.calls.map(toGroundingCall);
    return {
        rootText: input.prompt,
        sources: [{ text: input.prompt, calls }],
        commands: calls.map((call, index) => toGroundingCommand(call, 0, index)),
        protectedUnchanged: unionProtectedObjects(input.protectedUnchanged),
        protectedControls: unionProtectedControls(input.protectedControls),
    };
}

/**
 * The basis a refined card carries. An inherited command keeps the source that grounded its target,
 * with the value the refinement bound; a new command is grounded in the refinement text, which joins
 * the sources. Sources no command reads any more are dropped, except the root, which the chain keeps
 * so a later refinement still reads the request that opened it.
 */
function extendProposalGroundingBasis(input: {
    previous: ProposalGroundingBasis;
    prompt: string;
    calls: readonly GroundedCall[];
    /** For each call, the previous basis command it inherits, or `null` when the refinement text grounded it. */
    inheritedCommandIndexes: ReadonlyArray<number | null>;
    protectedUnchanged: readonly ProtectedObject[];
    protectedControls: readonly ProtectedControl[];
}): ProposalGroundingBasis {
    const calls = input.calls.map(toGroundingCall);
    const newCalls = calls.filter((_call, index) => input.inheritedCommandIndexes[index] === null);
    const refinementSource = input.previous.sources.length;
    const sources: ProposalGroundingSource[] = [...input.previous.sources];
    if (newCalls.length > 0) {
        sources.push({ text: input.prompt, calls: newCalls });
    }
    let newCallIndex = 0;
    const commands = calls.map((call, index) => {
        const inherited = input.inheritedCommandIndexes[index];
        const previousCommand =
            inherited === null || inherited === undefined ? undefined : input.previous.commands[inherited];
        if (previousCommand === undefined) {
            const command = toGroundingCommand(call, refinementSource, newCallIndex);
            newCallIndex += 1;
            return command;
        }
        return toGroundingCommand(call, previousCommand.source, previousCommand.sourceCallIndex);
    });
    const readSources = new Set([0, ...commands.map((command) => command.source)]);
    const keptSources = sources.flatMap((source, index) => (readSources.has(index) ? [{ source, index }] : []));
    const sourceIndexes = new Map(keptSources.map((kept, position) => [kept.index, position]));
    const extended: ProposalGroundingBasis = {
        rootText: input.previous.rootText,
        sources: keptSources.map((kept) => kept.source),
        commands: commands.map((command) => ({ ...command, source: sourceIndexes.get(command.source) ?? 0 })),
        protectedUnchanged: unionProtectedObjects(input.previous.protectedUnchanged, input.protectedUnchanged),
    };
    // A basis that predates the record keeps reading its sources against the live project.
    if (input.previous.protectedControls !== undefined) {
        extended.protectedControls = unionProtectedControls(input.previous.protectedControls, input.protectedControls);
    }
    return extended;
}

/** How an ordinary card records what it was grounded in, and how a refinement of it extends that record. */
export const proposalGroundingBasis = {
    create: createProposalGroundingBasis,
    extend: extendProposalGroundingBasis,
} as const;
