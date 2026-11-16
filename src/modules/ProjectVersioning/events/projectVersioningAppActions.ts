export type ProjectVersioningAppAction =
    | { type: 'createProjectVersion'; payload: { label: string; description?: string } }
    | { type: 'restoreProjectVersion'; payload: { versionId: string } }
    | { type: 'createVersionBranch'; payload: { name: string } };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        projectVersioning: ProjectVersioningAppAction;
    }
}
