type StemResult = Record<string, AudioBuffer>;

export async function separateStems(_audioData: ArrayBuffer, _stems: string[] = ['all']): Promise<StemResult> {
    throw new Error('Stem separation is unavailable until a compatible model is admitted.');
}
