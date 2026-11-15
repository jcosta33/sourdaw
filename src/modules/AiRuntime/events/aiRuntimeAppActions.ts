export type AiRuntimeAppAction =
    | {
          type: 'autoOrganizeProject';
          payload: {
              tracks: Array<{
                  trackId: string;
                  newName?: string;
                  color?: string;
                  folderName?: string;
              }>;
          };
      }
    | { type: 'getMentorTips'; payload?: undefined };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        aiRuntime: AiRuntimeAppAction;
    }
}
