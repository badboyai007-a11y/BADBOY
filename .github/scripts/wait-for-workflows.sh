#!/usr/bin/env bash
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${WORKFLOW_NAMES:?WORKFLOW_NAMES is required}"
: "${PR_HEAD_SHA:?PR_HEAD_SHA is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

api_url="https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/runs?head_sha=${PR_HEAD_SHA}&event=pull_request&per_page=100"
IFS=';' read -r -a required_workflows <<< "${WORKFLOW_NAMES}"

for attempt in $(seq 1 240); do
  response="$(curl --silent --show-error --fail \
    -H "Authorization: Bearer ${GH_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "${api_url}")"

  pending=0
  failed=0
  for workflow_name in "${required_workflows[@]}"; do
    run="$(jq -c --arg name "${workflow_name}" \
      '[.workflow_runs[] | select(.name == $name)] | sort_by(.created_at) | last // empty' \
      <<< "${response}")"

    if [[ -z "${run}" ]]; then
      echo "Waiting for '${workflow_name}' to be created for ${PR_HEAD_SHA}."
      pending=$((pending + 1))
      continue
    fi

    status="$(jq -r '.status' <<< "${run}")"
    conclusion="$(jq -r '.conclusion // empty' <<< "${run}")"
    run_url="$(jq -r '.html_url' <<< "${run}")"
    echo "${workflow_name}: status=${status}, conclusion=${conclusion}, url=${run_url}"

    if [[ "${status}" != "completed" ]]; then
      pending=$((pending + 1))
    elif [[ "${conclusion}" != "success" ]]; then
      echo "::error::Upstream workflow '${workflow_name}' concluded '${conclusion}'."
      failed=$((failed + 1))
    fi
  done

  if [[ "${failed}" -gt 0 ]]; then
    exit 1
  fi
  if [[ "${pending}" -eq 0 ]]; then
    echo "All ${#required_workflows[@]} upstream workflows passed for ${PR_HEAD_SHA}."
    exit 0
  fi

  echo "Waiting for ${pending} upstream workflow(s) (attempt ${attempt}/240)."
  sleep 10
done

echo "::error::Timed out waiting for required upstream workflows."
exit 1
