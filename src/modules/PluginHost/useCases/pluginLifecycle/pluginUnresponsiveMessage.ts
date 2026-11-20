/** What a slot whose plugin stopped responding tells the user. */
export function pluginUnresponsiveMessage(pluginId: string): string {
    return `${pluginId} stopped responding; it is silent until it answers again or is reloaded.`;
}
