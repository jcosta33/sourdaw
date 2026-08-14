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

let provider: CommandProjectDivergenceProvider | null = null;

export const commandProjectDivergencePort = {
    classify(input: Parameters<CommandProjectDivergenceProvider>[0]): CommandProjectDivergence | null {
        return provider?.(input) ?? null;
    },
    isConfigured(): boolean {
        return provider !== null;
    },
    setProvider(nextProvider: CommandProjectDivergenceProvider | null): void {
        provider = nextProvider;
    },
};
