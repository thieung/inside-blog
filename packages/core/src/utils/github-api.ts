/** GitHub API wrapper for admin dashboard operations */

const API_BASE = 'https://api.github.com';

export class GitHubClient {
  private headers: Record<string, string>;

  constructor(
    private token: string,
    private owner: string,
    private repo: string,
  ) {
    this.headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    };
  }

  private url(path: string): string {
    return `${API_BASE}/repos/${this.owner}/${this.repo}${path}`;
  }

  /** Get file content and SHA (needed for updates) */
  async getFileContent(path: string): Promise<{ content: string; sha: string }> {
    const res = await fetch(this.url(`/contents/${path}`), { headers: this.headers });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return { content: atob(data.content), sha: data.sha };
  }

  /** Create or update a file */
  async updateFile(
    path: string,
    content: string,
    message: string,
    sha?: string,
  ): Promise<void> {
    const body: Record<string, string> = { message, content: btoa(content) };
    if (sha) body.sha = sha;
    const res = await fetch(this.url(`/contents/${path}`), {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  }

  /** Create a pull request */
  async createPR(
    title: string,
    head: string,
    base: string,
    body: string,
  ): Promise<string> {
    const res = await fetch(this.url('/pulls'), {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ title, head, base, body }),
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.html_url;
  }

  /** Create an issue (for needs-update workflow) */
  async createIssue(
    title: string,
    body: string,
    labels: string[],
  ): Promise<string> {
    const res = await fetch(this.url('/issues'), {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ title, body, labels }),
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.html_url;
  }
}
