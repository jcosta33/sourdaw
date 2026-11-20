export const FERMENTER_OBSERVATIONS = [
    'project-ready',
    'dialog-open-and-focused',
    'transport-play-stop',
    'dialog-closed-and-opener-focused',
    'app-quit',
] as const;

export type FermenterObservation = (typeof FERMENTER_OBSERVATIONS)[number];
export type FermenterDrive = (binary: string, report: (observation: FermenterObservation) => void) => Promise<void>;

type DriveFailure =
    | 'launch-unavailable'
    | 'workspace-not-ready'
    | 'dialog-open-failed'
    | 'transport-failed'
    | 'dialog-close-failed'
    | 'quit-failed';

export class FermenterDriveError extends Error {
    readonly code: DriveFailure;

    constructor(code: DriveFailure) {
        super(code);
        this.code = code;
    }
}
