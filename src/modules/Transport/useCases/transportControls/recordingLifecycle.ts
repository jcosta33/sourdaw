type RecordingLifecycle = {
    readonly countInTimerId: ReturnType<typeof setTimeout> | null;
    beginPendingRecordingStart: () => number;
    cancelPendingRecordingStart: () => void;
    completePendingRecordingStart: (token: number) => boolean;
    hasPendingRecordingStart: () => boolean;
    ownsPendingRecordingStart: (token: number) => boolean;
    setCountInTimerId: (id: ReturnType<typeof setTimeout> | null) => void;
};

let countInTimerId: ReturnType<typeof setTimeout> | null = null;
let nextRecordingStartToken = 0;
let pendingRecordingStartToken: number | null = null;

export const recordingLifecycle: RecordingLifecycle = {
    get countInTimerId() {
        return countInTimerId;
    },
    beginPendingRecordingStart: () => {
        const token = ++nextRecordingStartToken;
        pendingRecordingStartToken = token;
        return token;
    },
    cancelPendingRecordingStart: () => {
        pendingRecordingStartToken = null;
    },
    completePendingRecordingStart: (token) => {
        if (pendingRecordingStartToken !== token) {
            return false;
        }
        pendingRecordingStartToken = null;
        return true;
    },
    hasPendingRecordingStart: () => pendingRecordingStartToken !== null || countInTimerId !== null,
    ownsPendingRecordingStart: (token) => pendingRecordingStartToken === token,
    setCountInTimerId: (id) => {
        countInTimerId = id;
    },
};
