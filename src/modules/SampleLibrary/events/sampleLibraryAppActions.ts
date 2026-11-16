export type SampleLibraryAppAction = { type: 'searchSamples'; payload: { query: string } };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        sampleLibrary: SampleLibraryAppAction;
    }
}
