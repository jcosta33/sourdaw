# Codemods

This directory contains `jscodeshift` codemods for automating codebase transformations.

## Setup

These codemods are not bundled with the application. The directory has its own `tsconfig.json` so you get full TypeScript support for writing codemods using the `@types/jscodeshift` dev dependency.

## Usage

You can run codemods using `jscodeshift` via `pnpm` or `npx`.

```bash
# Run a specific codemod against the src directory
pnpm jscodeshift -t codemods/example.ts src/
```

### Options

- `-d` or `--dry`: Dry run (don't write files).
- `-p` or `--print`: Print output to stdout.
- `--extensions=ts,tsx`: Specify extensions to run on (jscodeshift assumes `.js` by default unless specified or inferred).

Example dry-run to see what would change:

```bash
pnpm jscodeshift -t codemods/example.ts src/ -d -p --extensions=ts,tsx
```

## Writing Codemods

Each codemod should `export default` a transform function:

```typescript
import { FileInfo, API, Options } from 'jscodeshift';

export default function transform(fileInfo: FileInfo, api: API, options: Options) {
    // your transformation logic
}

// Optionally specify the parser so jscodeshift knows how to parse the files it runs against
export const parser = 'tsx';
```
