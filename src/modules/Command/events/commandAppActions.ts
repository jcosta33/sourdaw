export type CommandAppAction =
    | { type: 'startMacroRecording'; payload?: undefined }
    | { type: 'stopMacroRecording'; payload: { name: string } }
    | { type: 'playMacro'; payload: { macroId: string } }
    | { type: 'deleteMacro'; payload: { macroId: string } }
    | { type: 'renameMacro'; payload: { macroId: string; name: string } }
    | { type: 'undo'; payload?: undefined }
    | { type: 'redo'; payload?: undefined }
    | { type: 'toggleUndoTree'; payload?: undefined }
    | { type: 'labelUndoBranch'; payload: { nodeId: string; label: string } };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        command: CommandAppAction;
    }
}
