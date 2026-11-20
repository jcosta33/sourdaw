/** What a slot whose plugin stopped responding tells the user. */
export function pluginUnresponsiveMessage(pluginId: string): string {
    return `${pluginId} stopped responding and no longer processes audio.`;
}
