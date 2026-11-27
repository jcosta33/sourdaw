import { type RuntimeGrinderPresetInput } from '../../models/RuntimeGrinderPreset';
import { audioEngine } from '../../repositories/createWebAudioEngine';
import { sendNativeGrinderNeuralPatch } from '../livePlayback/sendNativeGrinderNeuralPatch';

import { nativeBuiltinWriteTarget } from './nativeBuiltinWriteTarget';

type GrinderPresetPlaybackInput = Readonly<{
    trackId: string;
    deviceId: string;
    web: RuntimeGrinderPresetInput;
    native: Readonly<{
        values: Readonly<Record<string, number>>;
        modelJson: string | null;
        resetParameterIds: readonly string[];
    }>;
}>;

export async function applyRuntimeGrinderPreset({
    trackId,
    deviceId,
    web,
    native,
}: GrinderPresetPlaybackInput): Promise<void> {
    const browser = audioEngine.applyGrinderPreset(trackId, deviceId, web);
    const carried = nativeBuiltinWriteTarget(trackId, deviceId);
    if (carried) {
        await Promise.all([browser, sendNativeGrinderNeuralPatch({ kind: 'write', trackId, deviceId, ...native })]);
        return;
    }
    await browser;
}
