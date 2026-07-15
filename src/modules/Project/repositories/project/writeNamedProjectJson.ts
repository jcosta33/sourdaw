import { writeNamedProjectJsonByKey } from './writeNamedProjectJsonByKey';

export function writeNamedProjectJson(name: string, json: string): void {
    writeNamedProjectJsonByKey(`sourdaw:project:${name}`, json);
}
