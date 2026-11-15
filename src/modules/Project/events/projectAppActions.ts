export type ProjectAppAction =
    | { type: 'createProjectFromTemplate'; payload: { templateId: string } }
    | {
          type: 'setProductionBrief';
          payload: {
              expectedRevision: number;
              brief: unknown;
          };
      }
    | {
          /**
           * User-initiated repair of a repair-required project (issue #3573):
           * closes the document's unresolved conflicts by keeping the value each
           * already resolved to and re-projects every slot. The one action type
           * the repair-required admission gate admits while it holds; a
           * user route only, deliberately absent from the agent surface.
           */
          type: 'repairProjectData';
          payload?: undefined;
      };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        project: ProjectAppAction;
    }
}
