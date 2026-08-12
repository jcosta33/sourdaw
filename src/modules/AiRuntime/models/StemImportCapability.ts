import { type AppAction, type StemImportRole } from '#/utils/handlerContract';

export type StemImportProviderCall = {
    name: string;
    arguments: Record<string, unknown>;
};

export type StemImportCapability = {
    schemaVersion: 1;
    baseRevision: string;
    actionType: 'importStemSet';
    selectionId: string;
    projectTempo: number;
    stems: Array<{
        stemId: string;
        sourceName: string;
        durationSeconds: number;
        detectedTempo: number;
    }>;
    allowedRoles: StemImportRole[];
    constraints: {
        requireCompleteSelection: true;
        preserveExistingProject: true;
        requireFreshConfirmation: true;
        providerCannotAssignProjectIds: true;
    };
};

export type StemImportPromptScope = {
    capability: StemImportCapability;
    actionSeed: Extract<AppAction, { type: 'importStemSet' }>['payload'];
};
