import { createChannel, desktopInvoke, type DesktopChannel } from '#/utils/desktopBridge';

export type ProviderGatewayDependencies = {
    createChannel: <Payload>() => Promise<DesktopChannel<Payload>>;
    invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
};

export const productionProviderGatewayDependencies: ProviderGatewayDependencies = {
    createChannel,
    invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
        return desktopInvoke(command, args);
    },
};
