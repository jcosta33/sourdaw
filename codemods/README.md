# Codemods

This directory contains historical `jscodeshift` codemods from reviewed
migration work. They are retained as references, not as normal agent-run write
tools.

Agents must not run these transforms unless a human explicitly assigns that
codemod execution as the task. Human maintainers who choose to reuse one should
start with a dry run, inspect the full diff, and run the repository verification
commands afterward.

## Setup

These codemods are not bundled with the application. The directory has its own `tsconfig.json` so you get full TypeScript support for writing codemods using the `@types/jscodeshift` dev dependency.

## Usage

There is intentionally no root package script for these codemods. For a
human-approved migration, call `jscodeshift` directly and begin with a dry run:

```bash
npx jscodeshift -t codemods/example.ts src/ -d -p --extensions=ts,tsx
```

### Options

- `-d` or `--dry`: Dry run (don't write files).
- `-p` or `--print`: Print output to stdout.
- `--extensions=ts,tsx`: Specify extensions to run on (jscodeshift assumes `.js` by default unless specified or inferred).

If the dry-run diff has been reviewed and the migration is explicitly approved,
remove `-d -p` for the write pass and then run the relevant verification
commands.

```bash
npx jscodeshift -t codemods/example.ts src/ --extensions=ts,tsx
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
