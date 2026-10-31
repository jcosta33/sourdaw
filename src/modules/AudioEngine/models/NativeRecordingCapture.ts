/** Runtime-only root authority supplied by the document-owning caller; never a native DTO. */
export type NativeRecordingRootWitness = Readonly<{
    identity: string;
    isCurrent: () => boolean;
}>;

/** The issuing transport owns beat geometry; the engine owns its admission fence. */
export type NativeRecordingGeometry = Readonly<{
    secondsAtBeat: (beat: number) => number;
    beatAtSeconds: (seconds: number) => number;
    isLooping: boolean;
    loopStart: number;
    loopEnd: number;
}>;

export type NativeRecordingAdmission = Readonly<{
    owner?: NativeRecordingRootWitness;
    geometry: NativeRecordingGeometry | null;
    admittedBatch: number;
    serial: number;
    located: boolean;
    rootIdentity?: string;
}>;
