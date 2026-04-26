import { FileInfo, API, Options } from 'jscodeshift';

export default function transform(fileInfo: FileInfo, api: API, options: Options) {
    const j = api.jscodeshift;
    const root = j(fileInfo.source);

    // Example: Find all identifiers named 'foo' and rename them to 'bar'
    let hasModifications = false;

    root.find(j.Identifier, { name: 'foo' }).forEach((path) => {
        path.node.name = 'bar';
        hasModifications = true;
    });

    return hasModifications ? root.toSource() : null;
}

export const parser = 'tsx';
