/**
 * Single source of truth for hosted Anthropic model IDs: the fallback used when
 * a configured session carries no model, and the options the Preferences picker
 * offers, are both derived from this catalog so they cannot drift apart.
 */

export type HostedAnthropicModelOption = {
    value: string;
    label: string;
};

export const DEFAULT_HOSTED_ANTHROPIC_MODEL = 'claude-sonnet-5';

export const HOSTED_ANTHROPIC_MODELS: readonly HostedAnthropicModelOption[] = [
    { value: DEFAULT_HOSTED_ANTHROPIC_MODEL, label: 'Claude Sonnet 5 — Recommended' },
    { value: 'claude-fable-5', label: 'Claude Fable 5 — Highest quality' },
    { value: 'claude-opus-5', label: 'Claude Opus 5 — Agentic and enterprise' },
    { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — Faster, lower cost' },
];
