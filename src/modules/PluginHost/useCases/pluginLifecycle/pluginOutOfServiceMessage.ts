/** What a slot whose plugin the host took out of service tells the user. */
export function pluginOutOfServiceMessage(pluginId: string, reason: string): string {
    return `${pluginId} is out of service: ${reason}.`;
}
