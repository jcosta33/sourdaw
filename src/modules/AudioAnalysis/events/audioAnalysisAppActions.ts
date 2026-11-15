export type AudioAnalysisAppAction =
    | { type: 'analyzeMix'; payload?: undefined }
    | { type: 'autoFixMix'; payload?: undefined }
    | { type: 'audioToMidi'; payload: { clipId: string; trackId?: string; sensitivity?: number; mode?: string } }
    | { type: 'detectTempo'; payload: { clipId: string } }
    | { type: 'detectKey'; payload: { clipId: string } }
    | { type: 'compareToReference'; payload?: undefined };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        audioAnalysis: AudioAnalysisAppAction;
    }
}
