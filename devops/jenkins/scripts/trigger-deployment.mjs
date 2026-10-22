import { appendFileSync, readFileSync } from 'node:fs';

const required = ['JENKINS_URL', 'JENKINS_USER', 'JENKINS_API_TOKEN', 'REPO_URL', 'GIT_CREDENTIALS_ID', 'GITHUB_SHA'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
}
const target = process.argv[2];
if (!['testing', 'production'].includes(target)) throw new Error('Specify testing or production');
const production = target === 'production';
const jobName = production ? 'DEPLOY_CODE' : 'DEPLOY_TESTING';
let commit = process.env.GITHUB_SHA;
if (production) {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request' || !process.env.GITHUB_EVENT_PATH) {
    throw new Error('Production requires a merged pull request event');
  }
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (event.action !== 'closed' || event.pull_request?.merged !== true || event.pull_request.base.ref !== 'main') {
    throw new Error('Production requires a merged pull request targeting main');
  }
  commit = event.pull_request.merge_commit_sha;
} else if (process.env.GITHUB_REF !== 'refs/heads/development') {
  throw new Error('Testing requires development');
}
if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('Deployment requires a full commit SHA');
const base = new URL(process.env.JENKINS_URL.replace(/\/$/, '') + '/');
const job = new URL(`job/${jobName}/`, base);
const authorization = 'Basic ' + Buffer.from(`${process.env.JENKINS_USER}:${process.env.JENKINS_API_TOKEN}`).toString('base64');
const deadline = Date.now() + 50 * 60_000;
const sleep = () => new Promise(resolve => setTimeout(resolve, 10_000));
const request = async (url, options = {}) => {
  const target = new URL(url, base);
  if (target.origin !== base.origin) throw new Error('Refusing to send credentials to another origin');
  return fetch(target, {
    ...options, redirect: 'manual', signal: AbortSignal.timeout(30_000),
    headers: { Authorization: authorization, ...options.headers },
  });
};
async function read(url) {
  while (Date.now() < deadline) {
    let response;
    try { response = await request(url); }
    catch (error) {
      if (!['TypeError', 'TimeoutError'].includes(error.name)) throw error;
      await sleep(); continue;
    }
    if (response.ok) return response.json();
    if (response.status < 500) throw new Error(`Jenkins read failed: HTTP ${response.status}`);
    await sleep();
  }
  throw new Error('Timed out waiting for Jenkins; inspect the job before retrying');
}

await read(new URL('api/json', job));
// Never retry the POST: a lost response may still have queued a deployment.
const response = await request(new URL('buildWithParameters', job), {
  method: 'POST',
  body: new URLSearchParams({COMMIT: commit, ...(production ? {BRANCH: 'main', IMAGE: ''} : {}), REPO_URL: process.env.REPO_URL,
    GIT_CREDENTIALS_ID: process.env.GIT_CREDENTIALS_ID}),
});
if (response.status !== 201 || !response.headers.get('location')) {
  throw new Error(`Jenkins did not queue the deployment: HTTP ${response.status}`);
}
// Use only the queue ID/build number from Jenkins. Jenkins's browser root URL
// may be a private HTTPS hostname while this runner connects over cluster DNS.
const queuePath = new URL(response.headers.get('location'), base).pathname;
const match = queuePath.match(/\/queue\/item\/(\d+)\/?$/);
if (!match) throw new Error('Jenkins returned an invalid queue location');
const queue = new URL(`queue/item/${match[1]}/api/json`, base);
let build;
while (Date.now() < deadline) {
  const state = await read(build ? new URL('api/json', build) : queue);
  if (!build) {
    if (state.cancelled) throw new Error('Jenkins queue item was cancelled');
    if (state.executable) {
      const number = state.executable.number;
      if (!Number.isSafeInteger(number) || number <= 0) throw new Error('Invalid Jenkins build number');
      build = new URL(`${number}/`, job);
      console.log(`Following ${jobName} #${number}`);
    }
  } else if (state.result !== null && state.result !== undefined) {
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${jobName} deployment: **${state.result}** (Jenkins #${state.number}).\n`);
    }
    if (state.result !== 'SUCCESS') throw new Error(`Deployment failed: ${state.result}`);
    console.log(`${jobName} deployment succeeded.`);
    process.exit(0);
  }
  await sleep();
}
throw new Error('Timed out; Jenkins may still be running. Inspect Jenkins before retrying.');
