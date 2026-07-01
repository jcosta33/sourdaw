import { createHmrPersistentState } from '#/utils/HMR/createHmrPersistentState';

type InputMonitoringSession = {
    monitorStream: MediaStream | null;
    monitorSource: MediaStreamAudioSourceNode | null;
};

export const inputMonitoringSession = createHmrPersistentState<InputMonitoringSession>(
    'audioEngine.inputMonitoring',
    () => ({
        monitorStream: null,
        monitorSource: null,
    })
);
