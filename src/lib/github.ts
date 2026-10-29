import { getRuntimeSecret } from './admin.ts';

const RECIPE_DIRECTORY = 'src/content/recipes';

export function getGithubConfig() {
  const token = getRuntimeSecret('ADMIN_GITHUB_TOKEN');
  const owner = getRuntimeSecret('ADMIN_GITHUB_OWNER');
  const repo = getRuntimeSecret('ADMIN_GITHUB_REPO');
  const branch = getRuntimeSecret('ADMIN_GITHUB_BRANCH', 'main');
  return { token, owner, repo, branch };
}

export function repoRecipePath(slug: string) {
  const safe = String(slug ?? '').trim();
  if (!safe || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(safe)) {
    throw new Error('Invalid recipe slug.');
  }

  return `${RECIPE_DIRECTORY}/${safe}.md`;
}

export function assertRepoRecipePath(path: string) {
  if (typeof path !== 'string') {
    throw new Error('Invalid recipe file path.');
  }

  const normalized = path.replace(/\\/g, '/').replace(/^\.?\//, '');
  if (!normalized.startsWith(`${RECIPE_DIRECTORY}/`) || !normalized.endsWith('.md')) {
    throw new Error('Invalid recipe file path.');
  }

  if (normalized.includes('../') || normalized.includes('/..') || normalized.startsWith('../') || normalized.includes('..')) {
    throw new Error('Recipe file path is not allowed.');
  }
}

function getGithubHeaders(token: string, extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'CrockBites-Admin',
    ...extra,
  };
}

type GitHubFile = {
  sha: string;
  path: string;
  url: string;
  html_url?: string;
  download_url?: string | null;
  type?: string;
  encoding?: string;
  content?: string;
};

type GitHubWriteResponse = {
  content?: { sha?: string };
  commit?: { sha?: string };
};

async function githubJson<T>(requestUrl: string, init?: RequestInit): Promise<T> {
  const response = await fetch(requestUrl, init);
  const text = await response.text();

  if (!response.ok) {
    let message = 'GitHub API request failed';
    try {
      const payload = JSON.parse(text) as { message?: string };
      if (payload?.message) {
        message = payload.message;
      }
    } catch {
      if (text) {
        message = text;
      }
    }

    throw new Error(message);
  }

  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export async function listRepoFiles(path = RECIPE_DIRECTORY, branch = 'main'): Promise<GitHubFile[]> {
  const config = getGithubConfig();
  if (!config.token || !config.owner || !config.repo) {
    throw new Error('GitHub publishing is not configured.');
  }

  const safePath = path.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/^\/+/, '');
  if (safePath.includes('..')) {
    throw new Error('Invalid repository path.');
  }

  const query = safePath ? `/${encodeURIComponent(safePath)}` : '';
  const requestUrl = `https://api.github.com/repos/${config.owner}/${config.repo}/contents${query}?ref=${encodeURIComponent(branch || config.branch)}`;
  return githubJson(requestUrl, { headers: getGithubHeaders(config.token) });
}

export async function getRepoFile(path: string, branch = 'main'): Promise<GitHubFile> {
  const config = getGithubConfig();
  if (!config.token || !config.owner || !config.repo) {
    throw new Error('GitHub publishing is not configured.');
  }

  assertRepoRecipePath(path);

  const safePath = path.replace(/\\/g, '/').replace(/^\.?\//, '');
  const requestUrl = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(safePath)}?ref=${encodeURIComponent(branch || config.branch)}`;
  return githubJson<GitHubFile>(requestUrl, {
    headers: getGithubHeaders(config.token),
  });
}

export async function writeRepoFile(path: string, content: string, message: string, sha?: string): Promise<GitHubWriteResponse> {
  const config = getGithubConfig();
  if (!config.token || !config.owner || !config.repo) {
    throw new Error('GitHub publishing is not configured.');
  }

  assertRepoRecipePath(path);

  const payload: Record<string, string> = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: config.branch,
  };

  if (sha) payload.sha = sha;

  const safePath = path.replace(/\\/g, '/').replace(/^\.?\//, '');
  const requestUrl = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(safePath)}`;
  return githubJson<GitHubWriteResponse>(requestUrl, {
    method: 'PUT',
    headers: getGithubHeaders(config.token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
}

export async function deleteRepoFile(path: string, sha: string, message: string): Promise<GitHubWriteResponse> {
  const config = getGithubConfig();
  if (!config.token || !config.owner || !config.repo) {
    throw new Error('GitHub publishing is not configured.');
  }

  assertRepoRecipePath(path);

  const safePath = path.replace(/\\/g, '/').replace(/^\.?\//, '');
  const requestUrl = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(safePath)}`;
  return githubJson<GitHubWriteResponse>(requestUrl, {
    method: 'DELETE',
    headers: getGithubHeaders(config.token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ message, branch: config.branch, sha }),
  });
}
