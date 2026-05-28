import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 30_000;

/**
 * Execute a GraphQL query via `gh api graphql --input -`.
 *
 * @param {string} query - GraphQL query/mutation string
 * @param {object} variables - Variables object
 * @returns {Promise<object>} The `data` field from the GraphQL response
 * @throws {Error} On non-zero exit, non-JSON response, or GraphQL errors
 */
export async function graphql(query, variables = {}) {
  const body = JSON.stringify({ query, variables });
  let result;
  try {
    const { stdout } = await execFileAsync("gh", ["api", "graphql", "--input", "-"], {
      input: body,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    result = stdout;
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().trim() : "";
    throw new Error(`gh graphql failed: ${stderr || err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(result);
  } catch {
    throw new Error(`gh graphql returned non-JSON: ${result.slice(0, 200)}`);
  }
  if (parsed.errors && parsed.errors.length > 0) {
    const msg = parsed.errors.map((e) => e.message).join("; ");
    const err = new Error(`GraphQL error: ${msg}`);
    err.errors = parsed.errors;
    throw err;
  }
  return parsed.data;
}

/**
 * Get repo owner, name, and PR details.
 *
 * @param {number} prNumber
 * @param {object} [options]
 * @param {string} [options.cwd] - Working directory for `gh` CLI invocation
 * @returns {Promise<{owner: string, name: string, prNodeId: string, headOid: string, state: string}>}
 */
export async function getPrInfo(prNumber, { cwd } = {}) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync("gh", ["repo", "view", "--json", "owner,name"], {
      encoding: "utf8",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cwd,
    }));
  } catch (err) {
    throw new Error(
      `Failed to query repository info via \`gh\`. Ensure \`gh auth login\` is complete.\n${err.message}`,
    );
  }
  const repo = JSON.parse(stdout);

  const data = await graphql(
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
