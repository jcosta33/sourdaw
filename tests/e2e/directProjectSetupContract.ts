/**
 * Public surface of the E2E direct-project-setup module. Declared separately
 * from the runtime entry so test helpers and Node-side build tooling can type
 * the loaded module without pulling in the app module graph.
 */
export type DirectProjectSetupModule = {
    newProject: () => Promise<boolean>;
};
