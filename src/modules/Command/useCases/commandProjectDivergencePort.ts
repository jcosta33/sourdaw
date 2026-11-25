type CommandProjectDivergence = {
    kind:
        | 'none'
        | 'non-overlapping'
        | 'compatible-same-object'
        | 'ambiguous-same-object'
        | 'deleted-target'
        | 'invariant-breaking';
    mayReapply: boolean;
    repairCandidates: readonly (
        | {
              kind: 'replan-without-deleted-target' | 'review-ambiguous-target' | 'repair-project-invariants';
              targetIds: readonly string[];
          }
        | {
              conflictIds: readonly string[];
              kind: 'choose-automerge-conflict-value';
              path: readonly (number | string)[];
              targetIds: readonly string[];
          }
    )[];
    targetIds: readonly string[];
};

type CommandProjectDivergenceProvider = (input: {
    baseRevision: string;
    commandsCompatible: boolean;
    targetIds: readonly string[];
}) => CommandProjectDivergence;

let registeredProvider: CommandProjectDivergenceProvider | null = null;

/**
 * Command may not import the module that inspects the project document, so
 * the composition root (`#/app/bootstrap`) fills this once at boot.
 */
export const commandProjectDivergencePort = {
    /**
     * Reading before registration throws rather than answering `null`: an
     * unclassified divergence would be read as "could not be classified" and
     * hide the wiring fault behind a conflict.
     */
    classify(input: Parameters<CommandProjectDivergenceProvider>[0]): CommandProjectDivergence {
        if (registeredProvider === null) {
            throw new Error(
                'commandProjectDivergencePort.classify: the divergence classifier is not registered; call commandProjectDivergencePort.setProvider() from #/app/bootstrap'
            );
        }
        return registeredProvider(input);
    },
    setProvider(nextProvider: CommandProjectDivergenceProvider): void {
        registeredProvider = nextProvider;
    },
};
