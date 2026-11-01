import { digest } from '#/utils/canonicalDigest';
import { type AppAction } from '#/utils/handlerContract';

import { type MetricNativeLiteralUse, type WorkflowNativeLiteralUse } from '../../models/MetricGoalAdmission';
import { getExactAgentActionHash } from '../getExactAgentActionHash';
import { type MetricRequestAuthority } from '../metricGoalContractTypes';
import { readRequestMetricNumbers } from '../readRequestMetricNumbers';

/** Join an actual workflow field to one written candidate after final identity materialization. */
export function freezeWorkflowNativeLiteralUses(input: {
    uses: readonly WorkflowNativeLiteralUse[] | undefined;
    actions: readonly AppAction[];
    authority: MetricRequestAuthority | undefined;
    request: string;
}): MetricNativeLiteralUse[] {
    const authority = input.authority;
    if (
        authority === undefined ||
        authority.kind !== 'literal' ||
        authority.origin !== 'configured-joint-intake' ||
        authority.callId === null ||
        authority.turn === null ||
        authority.requestDigest !== digest(input.request.trim())
    ) {
        return [];
    }
    const numbers = readRequestMetricNumbers(input.request);
    return (input.uses ?? []).flatMap((use) => {
        const matches = numbers.filter((candidate) => candidate.unit === use.unit && candidate.value === use.value);
        const action = input.actions[use.actionIndex];
        const owner = input.actions[use.ownerActionIndex];
        const device = input.actions[use.deviceActionIndex];
        if (
            matches.length !== 1 ||
            action?.type !== 'setDeviceParameter' ||
            owner?.type !== 'createBus' ||
            device?.type !== 'addDevice'
        ) {
            return [];
        }
        const candidate = matches[0]!;
        if (
            action.payload.deviceId !== use.deviceId ||
            action.payload.expectedTrackId !== use.ownerId ||
            action.payload.expectedDeviceType !== use.deviceType ||
            action.payload.paramId !== use.paramId ||
            action.payload.value !== use.value ||
            action.payload.valueUnit !== use.unit ||
            owner.payload.busId !== use.ownerId ||
            device.payload.deviceId !== use.deviceId ||
            device.payload.trackId !== use.ownerId ||
            device.payload.deviceType !== use.deviceType
        ) {
            return [];
        }
        return [
            {
                ...use,
                authorityId: authority.authorityId,
                requestDigest: authority.requestDigest,
                candidateId: candidate.candidateId,
                token: candidate.token,
                start: candidate.start,
                actionHash: getExactAgentActionHash({ operation: action.type, arguments: action.payload }),
                ownerActionHash: getExactAgentActionHash({ operation: owner.type, arguments: owner.payload }),
                deviceActionHash: getExactAgentActionHash({ operation: device.type, arguments: device.payload }),
                binding: null,
            },
        ];
    });
}
