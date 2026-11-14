export type InstalledPackage = { root: string; name: string; version: string };
export type InstalledEdge = { parent: string; parentVersion: string; child: string; version: string };
export function physicalChild(parent: string, name: string): string | undefined;
export function installedGraph(repository: string): {
    packages: InstalledPackage[];
    edges: InstalledEdge[];
    packageRoot(name: string, version?: string): string;
};
