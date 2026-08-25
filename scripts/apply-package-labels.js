#!/usr/bin/env node
const { Octokit } = require("octokit");

const repoOwner = process.env.GITHUB_OWNER || 'stellar-compliance-kit';
const repoName = process.env.GITHUB_REPO || 'compliance-adapters';
const token = process.env.GITHUB_TOKEN;

if (!token) {
  console.error('Set GITHUB_TOKEN to run this script');
  process.exit(1);
}

const octokit = new Octokit({ auth: token });

async function ensureLabel(name, color, description) {
  try {
    await octokit.request('GET /repos/{owner}/{repo}/labels/{name}', {
      owner: repoOwner,
      repo: repoName,
      name,
    });
    console.log('Label exists:', name);
  } catch (err) {
    await octokit.request('POST /repos/{owner}/{repo}/labels', {
      owner: repoOwner,
      repo: repoName,
      name,
      color,
      description,
    });
    console.log('Created label:', name);
  }
}

async function applyLabelToOpenIssues(label) {
  const issues = await octokit.paginate('GET /repos/{owner}/{repo}/issues', {
    owner: repoOwner,
    repo: repoName,
    state: 'open',
    per_page: 100,
  });

  for (const issue of issues) {
    // Skip pull requests
    if (issue.pull_request) continue;
    // Heuristic: add label if the package name appears in title/body
    const text = (issue.title + '\n' + (issue.body || '')).toLowerCase();
    if (text.includes('sep10-auth') || text.includes('sep-10') || text.includes('sep 10')) {
      await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/labels', {
        owner: repoOwner,
        repo: repoName,
        issue_number: issue.number,
        labels: [label],
      });
      console.log('Labeled issue', issue.number, 'with', label);
    } else if (text.includes('sanctions-oracle') || text.includes('sanctions oracle') ) {
      await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/labels', {
        owner: repoOwner,
        repo: repoName,
        issue_number: issue.number,
        labels: [label],
      });
      console.log('Labeled issue', issue.number, 'with', label);
    } else if (text.includes('horizon-listener') || text.includes('horizon listener') ) {
      await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/labels', {
        owner: repoOwner,
        repo: repoName,
        issue_number: issue.number,
        labels: [label],
      });
      console.log('Labeled issue', issue.number, 'with', label);
    }
  }
}

(async function main(){
  const labels = [
    { name: 'package: sep10-auth', color: '1d76db', description: 'Issue pertains to sep10-auth package' },
    { name: 'package: sanctions-oracle', color: '5319e7', description: 'Issue pertains to sanctions-oracle package' },
    { name: 'package: horizon-listener', color: '0e8a16', description: 'Issue pertains to horizon-listener package' },
  ];

  for (const l of labels) await ensureLabel(l.name, l.color, l.description);

  // Apply heuristics to open issues retroactively
  await applyLabelToOpenIssues('package: sep10-auth');
  await applyLabelToOpenIssues('package: sanctions-oracle');
  await applyLabelToOpenIssues('package: horizon-listener');
})();
