import { type DeviceController } from '../models/AudioEngineState';
import { type DeviceParameterWriteReceipt, type EngineDeviceCollaborators } from '../models/EngineDeviceCollaborators';
import { type RuntimeGrinderPresetInput } from '../models/RuntimeGrinderPreset';

export type PendingParameterWrite =
    | Readonly<{
          kind: 'immediate';
          name: string;
          value: number;
          receipt: DeviceParameterWriteReceipt;
      }>
    | Readonly<{ kind: 'scheduled'; name: string; value: number; sampleFrame: number }>
    | Readonly<{ kind: 'grinder-patch'; patch: Record<string, unknown> }>
    | Readonly<{
          kind: 'grinder-preset';
          input: RuntimeGrinderPresetInput;
          receipts: readonly DeviceParameterWriteReceipt[];
          resolve: () => void;
          reject: (error: Error) => void;
      }>;

export function discardPendingParameterWrites(writes: PendingParameterWrite[]): void {
    for (const pending of writes) {
        if (pending.kind === 'grinder-preset') {
            pending.reject(new Error('Grinder was replaced before its preset could be applied'));
        }
    }
    writes.length = 0;
}

export function replayPendingParameterWrite(
    controller: DeviceController | undefined,
    pending: PendingParameterWrite,
    applyPreset: (input: RuntimeGrinderPresetInput, receipts: readonly DeviceParameterWriteReceipt[]) => Promise<void>
): void {
    switch (pending.kind) {
        case 'grinder-preset':
            void applyPreset(pending.input, pending.receipts).then(pending.resolve, pending.reject);
            return;
        case 'grinder-patch':
            controller?.setPatch?.(pending.patch);
            return;
        case 'scheduled':
            controller?.setParam(pending.name, pending.value, pending.sampleFrame);
            return;
        case 'immediate':
            if (controller) {
                const complete = pending.receipt.begin();
                controller.setParam(pending.name, pending.value);
                complete();
            }
            return;
    }
}

export function captureGrinderPresetReceipts(
    collaborators: EngineDeviceCollaborators,
    trackId: string,
    deviceId: string,
    input: RuntimeGrinderPresetInput
): DeviceParameterWriteReceipt[] {
    return input.parameters.map(({ parameterId }) => {
        const receipt = collaborators.captureParameterWriteReceipt(trackId, deviceId, parameterId);
        receipt.pending();
        return receipt;
    });
}
