import { runCollector } from './lib/runCollector.mjs';

function parseArguments(argumentsList) {
  let mode = 'scheduled-sync';
  let configPath;
  for (const argument of argumentsList) {
    if (argument.startsWith('--mode=')) {
      mode = argument.slice('--mode='.length);
    } else if (argument.startsWith('--config=')) {
      configPath = argument.slice('--config='.length);
    } else if (!argument.startsWith('--') && !configPath) {
      configPath = argument;
    }
  }
  return { mode, configPath };
}

try {
  await runCollector(parseArguments(process.argv.slice(2)));
} catch {
  process.exitCode = 1;
}
