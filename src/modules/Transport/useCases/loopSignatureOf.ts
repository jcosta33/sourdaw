type LoopState = {
    isLooping: boolean;
    loopStart: number;
    loopEnd: number;
};

export function loopSignatureOf(state: LoopState): string {
    return `${state.isLooping ? 1 : 0}:${state.loopStart}:${state.loopEnd}`;
}
