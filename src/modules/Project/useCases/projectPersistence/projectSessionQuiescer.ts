import { resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { beginProjectSessionPluginRetirement } from '#/modules/PluginHost/useCases';
import { repairRuntimeGraphFromProject, stopPlayback } from '#/modules/Transport/useCases';

import { projectLoadFailureStore } from '../../stores/projectLoadFailureStore';
import { projectStore } from '../../stores/projectStore';

type QuiesceRequest = {
    readonly requestId: number;
    readonly promise: Promise<boolean>;
};

let inFlight: QuiesceRequest | undefined;
let quiescedRequestId: number | undefined;
let cancellationRequestId: number | undefined;
let recovery: Promise<boolean> | undefined;
let recoveryFailed = false;
let pluginRetirement: Awaited<ReturnType<typeof beginProjectSessionPluginRetirement>> | undefined;

const repair = async (): Promise<boolean> => {
    pluginRetirement?.reopen();
    pluginRetirement = undefined;
    try {
        await repairRuntimeGraphFromProject();
    } catch {
        recoveryFailed = true;
        // Repair itself could not establish a fresh runtime boundary. Hold the
        // PluginHost admission fence closed until reload replaces this session.
        pluginRetirement = await beginProjectSessionPluginRetirement();
        const projectName = projectStore.value?.name ?? 'this project';
        projectLoadFailureStore.set({
            projectName,
            message: 'Sourdaw could not safely restore the project runtime. Reload the project before continuing.',
        });
    }
    return false;
};

const finish = (requestId: number): void => {
    if (inFlight?.requestId === requestId) {
        inFlight = undefined;
    }
    cancellationRequestId = undefined;
};

const retire = async (requestId: number, beginDestructiveTeardown: () => Promise<boolean>): Promise<boolean> => {
    try {
        await stopPlayback();
    } catch {
        finish(requestId);
        return false;
    }
    let committed: boolean;
    try {
        committed = await beginDestructiveTeardown();
    } catch {
        finish(requestId);
        return false;
    }
    if (!committed) {
        finish(requestId);
        return false;
    }
    try {
        if (cancellationRequestId === requestId) {
            return await repair();
        }
        pluginRetirement = await beginProjectSessionPluginRetirement();
        resetAudioGraph();
        await pluginRetirement.retire();
        if (cancellationRequestId === requestId) {
            return await repair();
        }
        quiescedRequestId = requestId;
        return true;
    } catch {
        return repair();
    } finally {
        finish(requestId);
    }
};

/** Renderer-owned session retirement with correlated cancellation and recovery. */
export const projectSessionQuiescer = {
    request: (requestId: number, beginDestructiveTeardown: () => Promise<boolean>): Promise<boolean> => {
        if (quiescedRequestId === requestId) {
            return Promise.resolve(true);
        }
        if (recoveryFailed || inFlight !== undefined || recovery !== undefined || quiescedRequestId !== undefined) {
            return Promise.resolve(false);
        }
        const promise = retire(requestId, beginDestructiveTeardown);
        inFlight = { requestId, promise };
        return promise;
    },
    releaseAfterWindowDestroy: (): void => {
        if (recoveryFailed) {
            return;
        }
        pluginRetirement?.reopen();
        pluginRetirement = undefined;
    },
    cancel: async (requestId: number): Promise<boolean> => {
        if (inFlight?.requestId === requestId) {
            cancellationRequestId = requestId;
            return inFlight.promise.then(() => false);
        }
        if (quiescedRequestId !== requestId || recovery !== undefined) {
            return false;
        }
        quiescedRequestId = undefined;
        recovery = repair();
        try {
            return await recovery;
        } finally {
            recovery = undefined;
        }
    },
};
