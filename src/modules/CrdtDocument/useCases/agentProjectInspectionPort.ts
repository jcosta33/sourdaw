type AgentProjectInspectionInput = {
    projectDocument: Readonly<Record<string, unknown>>;
    targetIds: readonly string[];
};

type AgentProjectInspection = {
    audioGraphValid: boolean;
    projectInvariantsValid: boolean;
    targetFingerprints: Readonly<Record<string, string>>;
};

type AgentProjectInspectionProvider = (input: AgentProjectInspectionInput) => AgentProjectInspection;

let provider: AgentProjectInspectionProvider | null = null;

export const agentProjectInspectionPort = {
    inspect(input: AgentProjectInspectionInput): AgentProjectInspection | null {
        return provider?.(input) ?? null;
    },
    isConfigured(): boolean {
        return provider !== null;
    },
    setProvider(nextProvider: AgentProjectInspectionProvider | null): void {
        provider = nextProvider;
    },
};
