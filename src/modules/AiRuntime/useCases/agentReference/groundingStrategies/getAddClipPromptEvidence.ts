import { type ActionPromptScope } from './promptScope';

export type AddClipPromptEvidence = {
    endBeat: number;
    name: string;
    startBeat: number;
    targetText: string;
};

const addClipRangePattern =
    /\bfrom\s+beat\s+([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s+to\s+beat\s+([+-]?(?:\d+(?:\.\d+)?|\.\d+))(?![\p{L}\p{N}_.%])/giu;

/** Returns the requested clip name, or null when the request text cannot carry one. */
function resolveAddClipName(nameText: string): string | null {
    const quotedName = /^(?:"([^"]+)"|'([^']+)'|“([^”]+)”|‘([^’]+)’)$/u.exec(nameText);
    const quoted = quotedName?.[1] ?? quotedName?.[2] ?? quotedName?.[3] ?? quotedName?.[4] ?? null;
    if (quoted !== null) {
        return quoted;
    }
    if (/\b(?:on|to|into|from)\b/iu.test(nameText) || /["'“”‘’]/u.test(nameText)) {
        return null;
    }
    return nameText;
}

export function getAddClipPromptEvidence(actionScope: ActionPromptScope): AddClipPromptEvidence | null {
    const keywords = [...actionScope.masked.matchAll(/\b(?:named|called)\b/giu)];
    if (keywords.length !== 1) {
        return null;
    }
    const keyword = keywords[0]!;
    const ranges = [...actionScope.masked.matchAll(addClipRangePattern)];
    if (ranges.length !== 1 || [...actionScope.masked.matchAll(/\bbeat\b/giu)].length !== 2) {
        return null;
    }
    const range = ranges[0]!;
    const rangeIndex = range.index;
    const rawStartBeat = range[1]!;
    const rawEndBeat = range[2]!;
    const suffix = actionScope.text.slice(rangeIndex + range[0].length);
    if (!/^[\s,.;!?]*$/u.test(suffix)) {
        return null;
    }
    const beforeRange = actionScope.text.slice(keyword.index + keyword[0].length, rangeIndex);
    const maskedBeforeRange = actionScope.masked.slice(keyword.index + keyword[0].length, rangeIndex);
    const connectors = [...maskedBeforeRange.matchAll(/\b(?:on|to|into)\b/giu)];
    const connector = connectors.at(-1);
    if (!connector) {
        return null;
    }
    const nameText = beforeRange.slice(0, connector.index).trim();
    const targetText = beforeRange.slice(connector.index + connector[0].length).trim();
    if (!nameText || !targetText) {
        return null;
    }
    const name = resolveAddClipName(nameText);
    if (name === null) {
        return null;
    }
    const startBeat = Number(rawStartBeat);
    const endBeat = Number(rawEndBeat);
    if (!Number.isFinite(startBeat) || !Number.isFinite(endBeat)) {
        return null;
    }
    return { endBeat, name: name.trim(), startBeat, targetText };
}
