/**
 * Public surface of the E2E direct-project-setup module. Declared separately
 * from the runtime entry so test helpers and Node-side build tooling can type
 * the loaded module without pulling in the app module graph.
 */
export type DirectProjectSetupModule = {
    newProject: () => Promise<boolean>;
};

export type ProjectInspectionValue =
    null | undefined | boolean | number | string | ProjectInspectionValue[] | { [key: string]: ProjectInspectionValue };

export type ProjectInspectionRecord = { [key: string]: ProjectInspectionValue };

/** Data-only snapshots retain every field; unsupported callback history fails capture. */
export type ProjectInspectionModule = {
    inspectProject: () => {
        project: ProjectInspectionRecord | null;
        revision: string;
        history: {
            past: ProjectInspectionRecord[];
            future: ProjectInspectionRecord[];
            undoTree: ProjectInspectionValue;
        };
    };
};
