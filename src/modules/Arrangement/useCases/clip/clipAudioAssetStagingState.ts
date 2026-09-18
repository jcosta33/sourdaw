export type ClipAudioAssetStaging = { hash: string; leaseId: string };

export type ClipAudioAssetStager = (buffer: AudioBuffer, name: string) => Promise<ClipAudioAssetStaging | null>;

/**
 * The registered stager, held between the registration use case and the read
 * use case so each file exports exactly one function. `current` is null until
 * the composition root registers an implementation; see
 * `setClipAudioAssetStager` and `src/app/bootstrap.ts`.
 */
export const clipAudioAssetStagerRef: { current: ClipAudioAssetStager | null } = { current: null };
