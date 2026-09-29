/**
 * CLI parsing + interactive prompts (Node built-ins only: readline/promises).
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export function parseArgs(argv) {
  const opts = {
    projectName: null,
    scope: null,
    destination: null,
    yes: false,
    skipInstall: false,
    noGit: false,
    allowExisting: false,
    dryRun: false,
    skipValidation: false,
    skipBuild: false,
    verbose: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project-name' && argv[i + 1]) opts.projectName = argv[++i];
    else if (a.startsWith('--project-name=')) opts.projectName = a.slice('--project-name='.length);
    else if (a === '--scope' && argv[i + 1]) opts.scope = argv[++i];
    else if (a.startsWith('--scope=')) opts.scope = a.slice('--scope='.length);
    else if (a === '--destination' && argv[i + 1]) opts.destination = argv[++i];
    else if (a.startsWith('--destination=')) opts.destination = a.slice('--destination='.length);
    else if (a === '--yes' || a === '-y') opts.yes = true;
    else if (a === '--skip-install') opts.skipInstall = true;
    else if (a === '--no-git') opts.noGit = true;
    else if (a === '--allow-existing') opts.allowExisting = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--skip-validation') opts.skipValidation = true;
    else if (a === '--skip-build') opts.skipBuild = true;
    else if (a === '--verbose') opts.verbose = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (!a.startsWith('--')) positional.push(a);
    else throw new Error(`Unknown flag: ${a}`);
  }
  // `pnpm scaffold my-app` — first positional is a destination or name hint.
  // If --project-name is absent and one positional exists, treat it as the
  // project name (destination defaults to ../<name>).
  if (!opts.projectName && positional.length === 1 && !opts.destination) {
    opts.projectName = positional[0];
  } else if (positional.length === 1 && opts.projectName && !opts.destination) {
    opts.destination = positional[0];
  } else if (positional.length > 0 && !opts.projectName && !opts.destination) {
    opts.projectName = positional[0];
  } else if (positional.length > 1) {
    throw new Error(`Too many positional arguments: ${positional.join(' ')}`);
  }
  return opts;
}

export function helpText() {
  return `Usage: pnpm scaffold [--project-name <name>] [options]

Options:
  --project-name <name>   Project name, e.g. "My Awesome App" or my-awesome-app
  --scope <scope>         Package scope (@my-company or my-company). Default: @<normalized-name>
  --destination <path>    Output directory. Default: ../<normalized-name>
  --yes, -y               Non-interactive; accept derived defaults
  --skip-install          Transform + write files, skip pnpm install
  --no-git                Skip fresh git init
  --allow-existing        Allow writing into an existing (must be empty or explicit) dir
  --dry-run               Show plan only; change nothing
  --skip-validation       Skip post-generation validation pipeline
  --skip-build            Skip the full build step during validation
  --verbose               Verbose logging
  -h, --help              Show this help

Examples:
  pnpm scaffold
  pnpm scaffold --project-name my-app --yes
  pnpm scaffold --project-name "My Awesome App" --yes
  pnpm scaffold --project-name my-app --scope @my-company --yes
  pnpm scaffold --project-name my-app --skip-install --no-git
  pnpm scaffold --project-name my-app --dry-run
`;
}

export async function promptMissing(opts) {
  const rl = readline.createInterface({ input, output });
  try {
    if (!opts.projectName) {
      const answer = (await rl.question('Project name (e.g. My Awesome App): ')).trim();
      if (answer) opts.projectName = answer;
    }
    if (!opts.scope) {
      const answer = (await rl.question('Package scope (ENTER for default @<normalized-name>): ')).trim();
      if (answer) opts.scope = answer;
    }
    if (!opts.destination) {
      const answer = (await rl.question('Destination (ENTER for ../<normalized-name>): ')).trim();
      if (answer) opts.destination = answer;
    }
    if (!opts.yes) {
      const install = (await rl.question('Install dependencies? [Y/n]: ')).trim().toLowerCase();
      if (install === 'n' || install === 'no') opts.skipInstall = true;
      const git = (await rl.question('Initialize fresh Git repo? [Y/n]: ')).trim().toLowerCase();
      if (git === 'n' || git === 'no') opts.noGit = true;
    }
  } finally {
    rl.close();
  }
  return opts;
}

export async function confirmPlan(plan) {
  const rl = readline.createInterface({ input, output });
  try {
    console.log(plan);
    const answer = (await rl.question('Proceed? [y/N]: ')).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}
