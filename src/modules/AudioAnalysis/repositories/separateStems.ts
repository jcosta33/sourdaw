type StemResult = Record<string, AudioBuffer>;

export function separateStems(_audioData: ArrayBuffer, _stems: string[] = ['all']): Promise<StemResult> {
    return Promise.reject(new Error('Stem separation is unavailable until a compatible model is admitted.'));
}
