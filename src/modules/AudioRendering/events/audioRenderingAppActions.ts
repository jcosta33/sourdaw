export type RenderProjectSectionJobSnapshot = {
    jobId: string;
    sectionId: string;
    sectionName: string;
    startBeat: number;
    endBeat: number;
    sampleRate: number;
    tailSeconds: number;
};

export type AudioRenderingAppAction =
    | {
          type: 'renderProjectSections';
          payload: {
              sectionIds: string[];
              jobs?: RenderProjectSectionJobSnapshot[];
          };
      }
    | {
          /** Internal guarded inverse for `renderProjectSections`. */
          type: 'removeRenderedProjectSections';
          payload: {
              sectionIds: string[];
              jobs: RenderProjectSectionJobSnapshot[];
          };
      };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        audioRendering: AudioRenderingAppAction;
    }
}
