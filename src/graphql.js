"use strict";

const { execSync } = require("node:child_process");

/**
 * Execute a GraphQL query via `gh api graphql --input -`.
 *
 * @param {string} query - GraphQL query/mutation string
 * @param {object} variables - Variables object
 * @returns {object} Parsed JSON response data
 * @throws {Error} On non-zero exit or GraphQL errors
 */
function graphql(query, variables = {}) {
  const body = JSON.stringify({ query, variables });
  const result = execSync("gh api graphql --input -", {
    input: body,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 10 * 1024 * 1024,
  });

  const parsed = JSON.parse(result);
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
  const repoResult = execSync("gh repo view --json owner,name", { encoding: "utf8" });
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
