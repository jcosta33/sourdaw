import { getAddClipPromptEvidence } from './getAddClipPromptEvidence';
import { type ActionPromptScope } from './promptScope';

export function getTargetPromptScope(
    actionScope: ActionPromptScope,
    promptRole?: 'source' | 'destination' | 'container' | 'members'
): string {
    if (!promptRole) {
        return actionScope.text;
    }
    if (promptRole === 'members') {
        const memberConnector = /\bfor\b/iu.exec(actionScope.masked);
        if (!memberConnector) {
            return '';
        }
        const memberStart = memberConnector.index + memberConnector[0].length;
        const nameConnector = /\b(?:named|called)\b/iu.exec(actionScope.masked.slice(memberStart));
        const memberEnd = nameConnector ? memberStart + nameConnector.index : actionScope.text.length;
        const memberScope = actionScope.text.slice(memberStart, memberEnd).trim();
        if (
            /\b(?:not|except|excluding|without|but|then|mute|solo|remove|delete|rename|route|send|set|assign|unassign|create|add)\b/iu.test(
                memberScope
            )
        ) {
            return '';
        }
        return memberScope;
    }
    if (promptRole === 'container') {
        return getAddClipPromptEvidence(actionScope)?.targetText ?? '';
    }
    const separator = /\b(?:to|into|through)\b/iu.exec(actionScope.masked);
    if (!separator) {
        return '';
    }
    if (promptRole === 'source') {
        return actionScope.text.slice(0, separator.index).trim();
    }
    return `to ${actionScope.text.slice(separator.index + separator[0].length).trim()}`;
}
