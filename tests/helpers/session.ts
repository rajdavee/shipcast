import { join } from 'node:path';

/**
 * Sign the first account up against a test server and hand back what requests
 * need: the session cookie, the anti-forgery header and the workspace — plus
 * where that workspace's files live on disk.
 */
export async function signedIn(base: string, home: string, who = { email: 'owner@test.dev', password: 'test password 123', name: 'Owner' }) {
  const r = await fetch(base + '/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(who) });
  if (r.status !== 200) throw new Error(`sign-up failed: ${r.status} ${await r.text()}`);
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  const { workspace, user } = (await r.json()) as { workspace: string; user: { id: string } };
  return {
    cookie,
    workspace,
    user: user.id,
    headers: { cookie, 'x-shipcast': '1', 'x-shipcast-workspace': workspace } as Record<string, string>,
    dir: join(home, 'workspaces', workspace),
  };
}
