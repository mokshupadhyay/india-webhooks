import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tsc = require.resolve('typescript/bin/tsc');

const run = (...args) =>
  execFileSync(process.execPath, [tsc, '-p', 'tsconfig.build.json', ...args], {
    stdio: 'inherit',
  });

// Each output folder declares its own module format, so Node and bundlers
// read lib/module as ES modules and lib/commonjs as CommonJS regardless of
// the root package.json.
const markFormat = (dir, type) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/package.json`, `${JSON.stringify({ type }, null, 2)}\n`);
};

rmSync('lib', { recursive: true, force: true });

// ES2017 output keeps optional chaining and nullish coalescing out of the
// shipped JavaScript, so older bundlers and runtimes can parse it.
run('--module', 'commonjs', '--outDir', 'lib/commonjs');
markFormat('lib/commonjs', 'commonjs');

run('--module', 'esnext', '--outDir', 'lib/module');
markFormat('lib/module', 'module');

// Declarations are emitted twice so the `import` and `require` conditions
// each get types in the matching module format.
for (const [format, type] of [
  ['commonjs', 'commonjs'],
  ['module', 'module'],
]) {
  run(
    '--declaration',
    '--emitDeclarationOnly',
    '--sourceMap',
    'false',
    '--outDir',
    `lib/typescript/${format}`,
  );
  markFormat(`lib/typescript/${format}`, type);
}
