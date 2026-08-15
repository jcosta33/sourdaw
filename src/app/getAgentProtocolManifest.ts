import { getAiRuntimeProtocolContracts } from '#/modules/AiRuntime/useCases';
import { getDeviceManifestProtocolContract } from '#/modules/Arrangement/useCases';
import { getCommandProtocolContracts } from '#/modules/Command/useCases';
import { getMidiTransformProtocolContract } from '#/modules/MIDI/useCases';
import { getProjectProtocolContracts } from '#/modules/Project/useCases';

type AgentProtocolContract = {
    id: string;
    owner: string;
    schemaVersion: number;
    capabilities: readonly string[];
    operations: ReadonlyArray<{
        name: string;
        version: string;
        availability: string;
    }>;
    availability: string;
    compatibility: {
        mode: 'migrate' | 'read-only-preserve' | 'reject-unsupported' | 'discard-retired';
        behavior: string;
        canonicalProjectRequiresCommandReplay: false;
    };
};

export function getAgentProtocolManifest(): readonly AgentProtocolContract[] {
    const command = getCommandProtocolContracts();
    const project = getProjectProtocolContracts();
    const aiRuntime = getAiRuntimeProtocolContracts();

    return [
        command.command,
        project.query,
        command.receipt,
        aiRuntime.providerProtocol,
        getDeviceManifestProtocolContract(),
        project.productionBrief,
        getMidiTransformProtocolContract(),
        aiRuntime.externalAdapter,
    ];
}
