import { graphql } from "./graphql.js";

const MAX_PAGES = 50;

async function fetchRemainingComments(reviewId, initialPageInfo) {
  const comments = [];
  let pageInfo = initialPageInfo;
  let pages = 0;
  while (pageInfo.hasNextPage && pages++ < MAX_PAGES) {
    const page = await graphql(
      `
        query ($reviewId: ID!, $after: String!) {
          node(id: $reviewId) {
            ... on PullRequestReview {
              comments(first: 100, after: $after) {
                pageInfo {
                  hasNextPage
                  endCursor
                }
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
      `,
      { reviewId, after: pageInfo.endCursor },
    );
    const next = page.node.comments;
    comments.push(...next.nodes);
    pageInfo = next.pageInfo;
  }
  return comments;
}

export async function findPendingReview(prNodeId) {
  const data = await graphql(
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
                  pageInfo {
                    hasNextPage
                    endCursor
                  }
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
  if (reviews.length === 0) return null;

  const review = reviews[0];
  const comments = [...review.comments.nodes];
  const remaining = await fetchRemainingComments(review.id, review.comments.pageInfo);
  comments.push(...remaining);

  return { ...review, comments: { totalCount: review.comments.totalCount, nodes: comments } };
}

export async function createPendingReview(prNodeId, commitOid, body) {
  const data = await graphql(
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

export async function updateReviewBody(reviewId, body) {
  await graphql(
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

export async function addLineThread(reviewId, path, line, startLine, body) {
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
  await graphql(
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

export async function addFileThread(reviewId, path, body) {
  await graphql(
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
