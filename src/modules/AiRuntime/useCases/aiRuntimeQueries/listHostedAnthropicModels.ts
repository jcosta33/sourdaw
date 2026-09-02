import { HOSTED_ANTHROPIC_MODELS, type HostedAnthropicModelOption } from '../../models/HostedAnthropicModels';

export function listHostedAnthropicModels(): HostedAnthropicModelOption[] {
    return HOSTED_ANTHROPIC_MODELS.map((model) => ({ ...model }));
}
