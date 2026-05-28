import { type ExecFileOptions, execFile } from "node:child_process";
import { promisify } from "node:util";

// oxlint-disable-next-line typescript/strict-void-return -- Why: promisify() overload resolution picks void-returning signature incorrectly
const execFileAsync = promisify(execFile);

/** execFile with stdin input support (typed correctly) */
function execFileWithInput(
  cmd: string,
  args: string[],
  opts: ExecFileOptions & { input: string },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, opts, (error, stdout, stderr) => {
      if (error) {
        const e = error as Error & { stderr?: string };
        e.stderr = typeof stderr === "string" ? stderr : "";
        reject(e);
        return;
      }
      resolve(typeof stdout === "string" ? stdout : stdout.toString());
    });
    if (!child.stdin) {
      reject(new Error("execFileWithInput: child process has no stdin"));
      return;
    }
    child.stdin.end(opts.input);
  });
}
const TIMEOUT_MS = 30_000;

interface GraphQLError {
  message: string;
  [key: string]: unknown;
}

class GraphQLResponseError extends Error {
  errors: GraphQLError[];
  constructor(message: string, errors: GraphQLError[]) {
    super(message);
    this.errors = errors;
  }
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

/**
 * Execute a GraphQL query via `gh api graphql --input -`.
 */
export async function graphql<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const body = JSON.stringify({ query, variables });
  let result: string;
  try {
    result = await execFileWithInput("gh", ["api", "graphql", "--input", "-"], {
      input: body,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err: unknown) {
    const e = err as { stderr?: Buffer | string; message?: string };
    const stderr = e.stderr === undefined ? "" : String(e.stderr).trim();
    const detail = stderr === "" ? (e.message ?? "unknown error") : stderr;
    throw new Error(`gh graphql failed: ${detail}`);
  }

  let parsed: GraphQLResponse<T>;
  try {
    parsed = JSON.parse(result) as GraphQLResponse<T>;
  } catch {
    throw new Error(`gh graphql returned non-JSON: ${result.slice(0, 200)}`);
  }
  if (parsed.errors && parsed.errors.length > 0) {
    const msg = parsed.errors.map((e) => e.message).join("; ");
    throw new GraphQLResponseError(`GraphQL error: ${msg}`, parsed.errors);
  }
  if (parsed.data === undefined || parsed.data === null) {
    throw new Error("GraphQL response contained no data");
  }
  return parsed.data;
}

export interface PrInfo {
  owner: string;
  name: string;
  prNodeId: string;
  headOid: string;
  state: string;
}

interface RepoViewResponse {
  owner: { login: string };
  name: string;
}

interface PrQueryResponse {
  repository: {
    pullRequest: {
      id: string;
      state: string;
      headRefOid: string;
    } | null;
  };
}

/**
 * Get repo owner, name, and PR details.
 */
export async function getPrInfo(prNumber: number, { cwd }: { cwd?: string } = {}): Promise<PrInfo> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("gh", ["repo", "view", "--json", "owner,name"], {
      encoding: "utf8",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cwd,
    }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to query repository info via \`gh\`. Ensure \`gh auth login\` is complete.\n${message}`,
    );
  }
  let repo: RepoViewResponse;
  try {
    repo = JSON.parse(stdout) as RepoViewResponse;
  } catch {
    throw new Error(
      `Failed to parse \`gh repo view\` output as JSON. Got:\n${stdout.slice(0, 200)}`,
    );
  }

  const data = await graphql<PrQueryResponse>(
    `
      query ($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) {
            id
            state
            headRefOid
          }
        }
      }
    `,
    { owner: repo.owner.login, name: repo.name, number: prNumber },
  );

  const pr = data.repository.pullRequest;
  if (!pr) {
    throw new Error(`PR #${prNumber} not found in ${repo.owner.login}/${repo.name}`);
  }
  return {
    owner: repo.owner.login,
    name: repo.name,
    prNodeId: pr.id,
    headOid: pr.headRefOid,
    state: pr.state,
  };
}
