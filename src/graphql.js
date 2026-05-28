"use strict";

const { execFileSync } = require("node:child_process");

/**
 * Execute a GraphQL query via `gh api graphql --input -`.
 *
 * @param {string} query - GraphQL query/mutation string
 * @param {object} variables - Variables object
 * @returns {object} The `data` field from the GraphQL response
 * @throws {Error} On non-zero exit, non-JSON response, or GraphQL errors
 */
function graphql(query, variables = {}) {
  const body = JSON.stringify({ query, variables });
  let result;
  try {
    result = execFileSync("gh", ["api", "graphql", "--input", "-"], {
      input: body,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    });
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
 * @returns {{owner: string, name: string, prNodeId: string, headOid: string, state: string}}
 */
function getPrInfo(prNumber) {
  const repoResult = execFileSync("gh", ["repo", "view", "--json", "owner,name"], {
    encoding: "utf8",
  });
  const repo = JSON.parse(repoResult);

  const data = graphql(
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

  return {
    owner: repo.owner.login,
    name: repo.name,
    prNodeId: data.repository.pullRequest.id,
    headOid: data.repository.pullRequest.headRefOid,
    state: data.repository.pullRequest.state,
  };
}

module.exports = { graphql, getPrInfo };
