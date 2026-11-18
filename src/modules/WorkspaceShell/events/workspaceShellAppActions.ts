export type WorkspaceShellAppAction =
    | { type: 'setWorkspaceMode'; payload: { mode: 'arrange' | 'clip' } }
    | { type: 'openPreferencesDialog'; payload?: undefined }
    | { type: 'openMixer'; payload?: undefined }
    | { type: 'closeMixer'; payload?: undefined }
    | { type: 'toggleSidebar'; payload?: undefined }
    | { type: 'toggleInspector'; payload?: undefined }
    | { type: 'toggleChatPanel'; payload?: undefined }
    | { type: 'setEditingTool'; payload: { tool: string } }
    | {
          type: 'setMarqueeSelection';
          payload: { selection: { startBeat: number; endBeat: number; trackIds: string[] } | null };
      }
    | { type: 'importMidiFile'; payload?: undefined }
    | { type: 'setSnapValue'; payload: { value: number } }
    | { type: 'zoomToFit'; payload?: undefined }
    | { type: 'zoomToSelection'; payload?: undefined }
    | { type: 'exportProject'; payload?: undefined }
    | {
          type: 'saveProject';
          payload?: Record<string, never> | { intent: 'prepareSnapshot'; expectedOutgoingProjectIdentity?: string };
      }
    | { type: 'newProject'; payload?: undefined }
    | { type: 'importAudioFile'; payload?: undefined }
    | { type: 'toggleScratchPad'; payload?: undefined }
    | {
          type: 'captureScratchPad';
          /** The ids the captured pad sections take, in pad order; absent means mint them all. */
          payload?: { sectionIds?: readonly string[] };
      };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        workspaceShell: WorkspaceShellAppAction;
    }
}
