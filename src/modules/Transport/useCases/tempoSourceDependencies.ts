import { type TempoAudioSourceTransition } from '#/utils/handlerContract';

export type PreparedTempoAudioSources = {
    transition: TempoAudioSourceTransition;
    matches: () => boolean;
    apply: () => boolean;
};

type PrepareAudioSourcesForTempoChange = (input: {
    nextTempoAtBeat: (beat: number) => number;
    replay?: TempoAudioSourceTransition;
}) => PreparedTempoAudioSources | null;

type TempoSourceDependencies = {
    prepare: PrepareAudioSourcesForTempoChange;
    isTransition: (value: unknown) => value is TempoAudioSourceTransition;
};

let dependencies: TempoSourceDependencies | null = null;

export const tempoSourceDependencies = {
    set(input: TempoSourceDependencies | null): void {
        dependencies = input;
    },
    prepare(input: Parameters<PrepareAudioSourcesForTempoChange>[0]): PreparedTempoAudioSources | null {
        return dependencies?.prepare(input) ?? null;
    },
    available(): boolean {
        return dependencies !== null;
    },
    isTransition(value: unknown): value is TempoAudioSourceTransition {
        return dependencies?.isTransition(value) ?? false;
    },
};
