import { type CommandContext } from './CommandContext';

/**
 * Pure command-palette search and discovery helpers. No state or I/O: the view
 * supplies the session's recent ids and owns the resulting ephemeral UI state.
 */

type SearchableCommandEntry = {
    id: string;
    label: string;
    description: string;
    category: string;
    getInapplicabilityReason?: (context?: CommandContext) => string | null;
};

export type CommandDiscoveryGroup<Entry> = {
    id: string;
    label: string;
    entries: Entry[];
};

/** Subsequence fuzzy match: every char of `query` appears in `text` in order. */
export function fuzzyMatch(query: string, text: string): boolean {
    const query1 = query.toLowerCase();
    const time = text.toLowerCase();
    let qi = 0;
    for (let ti = 0; ti < time.length && qi < query1.length; ti++) {
        if (time[ti] === query1[qi]) {
            qi++;
        }
    }
    return qi === query1.length;
}

function matchRank(query: string, command: SearchableCommandEntry): number | null {
    const label = command.label.toLowerCase();
    const description = command.description.toLowerCase();
    const category = command.category.toLowerCase();

    if (label === query) {
        return 0;
    }
    if (label.startsWith(query)) {
        return 1;
    }
    if (label.includes(query)) {
        return 2;
    }
    if (description.includes(query)) {
        return 3;
    }
    if (category.includes(query)) {
        return 4;
    }
    if (fuzzyMatch(query, label)) {
        return 5;
    }
    if (fuzzyMatch(query, description)) {
        return 6;
    }
    if (fuzzyMatch(query, category)) {
        return 7;
    }
    return null;
}

/** Filter and rank the catalog while retaining registry order within one rank. */
export function searchCommands<Entry extends SearchableCommandEntry>(registry: Entry[], query: string): Entry[] {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
        return registry;
    }

    const ranked = registry.flatMap((command, index) => {
        const rank = matchRank(normalizedQuery, command);
        return rank === null ? [] : [{ command, index, rank }];
    });
    ranked.sort((left, right) => left.rank - right.rank || left.index - right.index);
    return ranked.map((candidate) => candidate.command);
}

/** A broken context gate fails closed instead of dispatching an unknown action. */
export function getCommandInapplicabilityReason(
    command: SearchableCommandEntry,
    context?: CommandContext
): string | null {
    if (!command.getInapplicabilityReason) {
        return null;
    }
    try {
        const reason = command.getInapplicabilityReason(context);
        if (reason === null) {
            return null;
        }
        return typeof reason === 'string' && reason.trim()
            ? reason
            : 'This command is unavailable in the current context.';
    } catch {
        return 'This command is unavailable in the current context.';
    }
}

/** Keep only the five most recent distinct executions for this palette session. */
export function updateRecentCommandIds(recentIds: readonly string[], executedId: string): string[] {
    return [executedId, ...recentIds.filter((id) => id !== executedId)].slice(0, 5);
}

/**
 * Empty-query discovery is deliberately small. Applicable commands lead, one
 * per category, while recents retain their own group and execution order.
 */
export function discoverCommands<Entry extends SearchableCommandEntry>(
    registry: Entry[],
    recentIds: readonly string[],
    context?: CommandContext
): CommandDiscoveryGroup<Entry>[] {
    const byId = new Map(registry.map((command) => [command.id, command]));
    const recents = recentIds.map((id) => byId.get(id)).filter((command): command is Entry => command !== undefined);
    const recentIdSet = new Set(recents.map((command) => command.id));
    const candidates = registry.filter((command) => !recentIdSet.has(command.id));
    const orderedCandidates = [
        ...candidates.filter((command) => getCommandInapplicabilityReason(command, context) === null),
        ...candidates.filter((command) => getCommandInapplicabilityReason(command, context) !== null),
    ];

    const suggestions: Entry[] = [];
    const suggestedCategories = new Set<string>();
    for (const command of orderedCandidates) {
        if (suggestedCategories.has(command.category)) {
            continue;
        }
        suggestions.push(command);
        suggestedCategories.add(command.category);
        if (suggestions.length === 8) {
            break;
        }
    }

    const groups: CommandDiscoveryGroup<Entry>[] = [];
    if (recents.length > 0) {
        groups.push({ id: 'recent', label: 'Recent', entries: recents });
    }
    for (const command of suggestions) {
        const existing = groups.find((group) => group.id === `category-${command.category}`);
        if (existing) {
            existing.entries.push(command);
        } else {
            groups.push({ id: `category-${command.category}`, label: command.category, entries: [command] });
        }
    }
    return groups;
}
