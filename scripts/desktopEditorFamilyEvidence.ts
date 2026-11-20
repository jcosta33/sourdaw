const DEVICE_ROUTES = [
    ['Fermenter', 'instrument', 'Fermenter', 'Show patch A'],
    ['Toaster', 'instrument', 'Toaster', 'Toaster view'],
    ['Levain', 'instrument', 'Levain', 'Search Levain instruments'],
    ['Crumbs', 'instrument', 'Sampler', 'Ready'],
    ['Grand Boule', 'instrument', 'Grand Boule', 'Grand Boule controls'],
    ['Dutch Oven', 'audio-effect', 'Dutch Oven', 'Decay'],
    ['Gluten', 'audio-effect', 'Gluten', 'Search Gluten presets'],
    ['Bacteria', 'audio-effect', 'Bacteria', 'Search Bacteria presets'],
    ['Grinder', 'audio-effect', 'Grinder', 'Search Grinder presets'],
    ['Proof', 'audio-effect', 'Proof', 'Mastering desk'],
    ['Scoring', 'audio-effect', 'Scoring', 'Concert A reference'],
    ['Yeast', 'midi-effect', 'Yeast', 'Rack frame'],
    ['Crust', 'audio-effect', 'Crust', 'True peak'],
] as const;

type DeviceRoute = (typeof DEVICE_ROUTES)[number];
type DevicePhase = 'not-attempted' | 'card' | 'instance' | 'dialog' | 'editor' | 'closed' | 'focus-returned';
type DeviceFailure =
    | 'browser-route-unavailable'
    | 'card-unavailable'
    | 'card-disabled'
    | 'open-action-failed'
    | 'instance-missing-or-ambiguous'
    | 'dialog-missing-or-incorrect'
    | 'editor-control-missing-or-incorrect'
    | 'sampler-engine-unavailable'
    | 'close-action-failed'
    | 'opener-focus-not-restored';

export type DeviceObservation = {
    device: DeviceRoute[0];
    navigation: DeviceRoute[1];
    dialog: DeviceRoute[2];
    editorControl: DeviceRoute[3];
    instanceId: string | null;
    phase: DevicePhase;
    failure: DeviceFailure | null;
};

type LifecycleObservation = {
    firstInstanceId: string;
    secondInstanceId: string | null;
    selectionClosed: boolean;
    originalReopened: boolean;
    phase: 'original-open' | 'replacement-open' | 'selection-changed' | 'original-reopened' | 'closed';
};

export type FamilyObservations = {
    devices: DeviceObservation[];
    lifecycle: LifecycleObservation | null;
    appQuit: boolean;
};

export type EditorFamilyDrive = (binary: string, observations: FamilyObservations) => Promise<void>;

export function freshFamilyObservations(): FamilyObservations {
    return {
        devices: DEVICE_ROUTES.map(([device, navigation, dialog, editorControl]) => ({
            device,
            navigation,
            dialog,
            editorControl,
            instanceId: null,
            phase: 'not-attempted',
            failure: null,
        })),
        lifecycle: null,
        appQuit: false,
    };
}

export function familyFailure(
    observations: FamilyObservations
): 'device-observations-incomplete' | 'lifecycle-observation-incomplete' | 'quit-failed' | null {
    const complete =
        observations.devices.length === DEVICE_ROUTES.length &&
        DEVICE_ROUTES.every(([device], index) => {
            const row = observations.devices[index];
            return (
                row?.device === device &&
                row.instanceId !== null &&
                row.phase === 'focus-returned' &&
                row.failure === null
            );
        });
    if (!complete) {
        return 'device-observations-incomplete';
    }
    const { lifecycle } = observations;
    const proof = observations.devices.find(({ device }) => device === 'Proof');
    if (
        lifecycle === null ||
        lifecycle.firstInstanceId !== proof?.instanceId ||
        lifecycle.secondInstanceId === null ||
        lifecycle.firstInstanceId === lifecycle.secondInstanceId ||
        !lifecycle.selectionClosed ||
        !lifecycle.originalReopened ||
        lifecycle.phase !== 'closed'
    ) {
        return 'lifecycle-observation-incomplete';
    }
    return observations.appQuit ? null : 'quit-failed';
}
