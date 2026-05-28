"use strict";

const { graphql } = require("./graphql.js");

function findPendingReview(prNodeId) {
  const data = graphql(
    `
      query ($prId: ID!) {
        node(id: $prId) {
          ... on PullRequest {
            viewerLatestReview: reviews(last: 1, states: PENDING, author: "@me") {
              nodes {
                id
                body
                comments(first: 100) {
                  totalCount
                  nodes {
                    id
                    body
                    path
                    startLine
                    line
                  }
                }
              }
            }
          }
        }
      }
    `,
    { prId: prNodeId },
  );
  const reviews = data.node.viewerLatestReview.nodes;
  if (reviews.length > 0 && reviews[0].comments.totalCount > 100) {
    const totalCount = reviews[0].comments.totalCount;
    console.warn(
      `WARN: Pending review has ${totalCount} comments, only first 100 checked for deduplication. Duplicates may occur.`,
    );
  }
  return reviews.length > 0 ? reviews[0] : null;
}

function createPendingReview(prNodeId, commitOid, body) {
  const data = graphql(
    `
      mutation ($input: AddPullRequestReviewInput!) {
        addPullRequestReview(input: $input) {
          pullRequestReview {
            id
          }
        }
      }
    `,
    {
      input: {
        pullRequestId: prNodeId,
        commitOID: commitOid,
        body,
      },
    },
  );
  return data.addPullRequestReview.pullRequestReview.id;
}

function updateReviewBody(reviewId, body) {
  graphql(
    `
      mutation ($input: UpdatePullRequestReviewInput!) {
        updatePullRequestReview(input: $input) {
          pullRequestReview {
            id
          }
        }
      }
    `,
    { input: { pullRequestReviewId: reviewId, body } },
  );
}

function addLineThread(reviewId, path, line, startLine, body) {
  const input = {
    pullRequestReviewId: reviewId,
    path,
    line,
    side: "RIGHT",
    body,
  };
  if (startLine) {
    input.startLine = startLine;
    input.startSide = "RIGHT";
  }
  graphql(
    `
      mutation ($input: AddPullRequestReviewThreadInput!) {
        addPullRequestReviewThread(input: $input) {
          thread {
            id
          }
        }
      }
    `,
    { input },
  );
}

function addFileThread(reviewId, path, body) {
  graphql(
    `
      mutation ($input: AddPullRequestReviewThreadInput!) {
        addPullRequestReviewThread(input: $input) {
          thread {
            id
          }
        }
      }
    `,
    {
      input: {
        pullRequestReviewId: reviewId,
        path,
        body,
        subjectType: "FILE",
      },
    },
  );
}

module.exports = {
  findPendingReview,
  createPendingReview,
  updateReviewBody,
  addLineThread,
  addFileThread,
};
