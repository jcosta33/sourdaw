import { createChannel, tauriInvoke, type TauriChannel } from '#/utils/tauriBridge';

export type ProviderGatewayDependencies = {
    createChannel: <Payload>() => Promise<TauriChannel<Payload>>;
    invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
};

export const productionProviderGatewayDependencies: ProviderGatewayDependencies = {
    createChannel,
    invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
        return tauriInvoke(command, args);
    },
};
