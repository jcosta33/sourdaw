import { inject } from '#/infra/di/inject';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import {
    addDevice,
    bypassDevice,
    getTrackStoreState,
    removeDevice,
    setDeviceParameter,
    setSend,
    removeSend,
} from '#/modules/Arrangement';
import {
    getLatencyReport,
    setMpeEnabled,
    updateDeviceParam,
} from '#/modules/AudioEngine';
import { type ActionHandler, type AppAction } from '#/modules/Command';
import {
    addSidechainRoute,
    removeSidechainRoute as removeSidechainRouteUseCase,
    getSidechainRoutesForTrack,
} from '#/modules/Routing';

type ExtractAction<A extends AppAction, T extends string> = A extends { type: T } ? A : never;
type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

export const executeAddDevice = inject({ addDevice })(
    ({ addDevice }) =>
        function executeAddDevice(a: ExtractAction<AppAction, 'addDevice'>): void {
            addDevice(a.payload.trackId, a.payload.deviceType);
        }
);

export const executeBypassDevice = inject({ bypassDevice })(
    ({ bypassDevice }) =>
        function executeBypassDevice(a: ExtractAction<AppAction, 'bypassDevice'>): void {
            bypassDevice(a.payload.deviceId, a.payload.bypassed);
        }
);

export const executeRemoveDevice = inject({ removeDevice })(
    ({ removeDevice }) =>
        function executeRemoveDevice(a: ExtractAction<AppAction, 'removeDevice'>): void {
            removeDevice(a.payload.deviceId);
        }
);

export const executeSetDeviceParameter = inject({ setDeviceParameter, getTrackStoreState, updateDeviceParam })(
    ({ setDeviceParameter, getTrackStoreState, updateDeviceParam }) =>
        function executeSetDeviceParameter(a: ExtractAction<AppAction, 'setDeviceParameter'>): void {
            setDeviceParameter(a.payload.deviceId, a.payload.paramId, a.payload.value);
            const ownerTrackId =
                getTrackStoreState()?.tracks.find((t) => t.devices.some((d) => d.id === a.payload.deviceId))?.id ?? '';
            updateDeviceParam(ownerTrackId, a.payload.deviceId, a.payload.paramId, a.payload.value);
        }
);

export const executeSetSend = inject({ setSend })(
    ({ setSend }) =>
        function executeSetSend(a: ExtractAction<AppAction, 'setSend'>): void {
            setSend(a.payload.trackId, a.payload.busId, a.payload.level);
        }
);

export const executeAddSend = inject({ setSend })(
    ({ setSend }) =>
        function executeAddSend(a: ExtractAction<AppAction, 'addSend'>): void {
            setSend(a.payload.trackId, a.payload.busId, a.payload.level);
        }
);

export const executeRemoveSend = inject({ removeSend })(
    ({ removeSend }) =>
        function executeRemoveSend(a: ExtractAction<AppAction, 'removeSend'>): void {
            removeSend(a.payload.trackId, a.payload.busId);
        }
);

export const executeEnableMpe = inject({ setMpeEnabled })(
    ({ setMpeEnabled }) =>
        function executeEnableMpe(): void {
            setMpeEnabled(true);
        }
);

export const executeDisableMpe = inject({ setMpeEnabled })(
    ({ setMpeEnabled }) =>
        function executeDisableMpe(): void {
            setMpeEnabled(false);
        }
);

export const executeGetLatencyReport = inject({ getLatencyReport, notifyUser })(
    ({ getLatencyReport, notifyUser }) =>
        function executeGetLatencyReport(): void {
            const report = getLatencyReport();
            const maxMs = report.maxLatencyMs.toFixed(1);
            const baseMs = report.contextBaseLatencyMs.toFixed(1);
            const trackLines = report.tracks
                .filter((t) => t.deviceLatencyMs > 0)
                .map((t) => `${t.trackId}: ${t.totalLatencyMs.toFixed(1)}ms`)
                .join(', ');
            const detail = trackLines
                ? `Max: ${maxMs}ms, Base: ${baseMs}ms — ${trackLines}`
                : `Max: ${maxMs}ms, Base: ${baseMs}ms — no device latency`;
            notifyUser(`Latency Report: ${detail}`);
        }
);

export const executeAddSidechainRoute = inject({ getTrackStoreState, addSidechainRoute })(
    ({ getTrackStoreState, addSidechainRoute }) =>
        function executeAddSidechainRoute(a: ExtractAction<AppAction, 'addSidechainRoute'>): void {
            const targetTrack = getTrackStoreState()?.tracks.find((t) => t.id === a.payload.targetTrackId);
            const scDevice = targetTrack?.devices.find((d) => d.type.toLowerCase().includes('sidechain'));
            if (scDevice) {
                addSidechainRoute(a.payload.sourceTrackId, a.payload.targetTrackId, scDevice.id);
            }
        }
);

export const executeRemoveSidechainRoute = inject({ getSidechainRoutesForTrack, removeSidechainRouteUseCase })(
    ({ getSidechainRoutesForTrack, removeSidechainRouteUseCase }) =>
        function executeRemoveSidechainRoute(a: ExtractAction<AppAction, 'removeSidechainRoute'>): void {
            const routes = getSidechainRoutesForTrack(a.payload.targetTrackId);
            const route = routes.find((r) => r.sourceTrackId === a.payload.sourceTrackId);
            if (route) {
                removeSidechainRouteUseCase(route.id);
            }
        }
);

export const deviceHandlers = {
    addDevice: {
        execute: executeAddDevice,
        describe: (a) => ({ label: `Add ${a.payload.deviceType}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'addDevice'>>,

    bypassDevice: {
        execute: executeBypassDevice,
        describe: (a) => ({ label: a.payload.bypassed ? 'Bypass device' : 'Enable device' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'bypassDevice'>>,

    removeDevice: {
        execute: executeRemoveDevice,
        describe: () => ({ label: 'Remove device' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'removeDevice'>>,

    setDeviceParameter: {
        execute: executeSetDeviceParameter,
        describe: (a) => ({ label: `Set ${a.payload.paramId}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setDeviceParameter'>>,

    setSend: {
        execute: executeSetSend,
        describe: () => ({ label: 'Set send level' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setSend'>>,

    addSend: {
        execute: executeAddSend,
        describe: () => ({ label: 'Add send' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'addSend'>>,

    removeSend: {
        execute: executeRemoveSend,
        describe: () => ({ label: 'Remove send' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'removeSend'>>,

    enableMpe: {
        execute: executeEnableMpe,
        describe: () => ({ label: 'Enable MPE' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'enableMpe'>>,

    disableMpe: {
        execute: executeDisableMpe,
        describe: () => ({ label: 'Disable MPE' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'disableMpe'>>,

    getLatencyReport: {
        execute: executeGetLatencyReport,
        describe: () => ({ label: 'Get latency report' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'getLatencyReport'>>,

    addSidechainRoute: {
        execute: executeAddSidechainRoute,
        describe: () => ({ label: 'Add sidechain route' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'addSidechainRoute'>>,

    removeSidechainRoute: {
        execute: executeRemoveSidechainRoute,
        describe: () => ({ label: 'Remove sidechain route' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'removeSidechainRoute'>>,
};
