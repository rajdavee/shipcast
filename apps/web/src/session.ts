import { useSyncExternalStore } from 'react';
import { auth, currentWorkspace, setCurrentWorkspace, setProblemHandler, type Account, type AuthStatus, type ClaudeConnection, type WorkspaceSummary } from './api.ts';
import { perms, type Perms } from './auth-model.ts';
import { toast } from './hooks.ts';

/**
 * Who is signed in and which workspace this tab works in. One small store for
 * the whole app; the API's 401s and "workspace not found" land here too.
 */

export type Phase = 'loading' | 'setup' | 'signed-out' | 'ready' | 'offline';
export interface SessionState {
  phase: Phase;
  status?: AuthStatus;
  account?: Account;
  claude?: ClaudeConnection;
  /** Shown once on the sign-in screen (e.g. "You were signed out"). */
  notice?: string;
}

let state: SessionState = { phase: 'loading' };
const listeners = new Set<() => void>();
const set = (patch: Partial<SessionState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
export const sessionState = () => state;
export function useSession(): SessionState {
  return useSyncExternalStore((cb) => (listeners.add(cb), () => void listeners.delete(cb)), () => state);
}

const personalOf = (a: Account) => a.workspaces.find((w) => w.personal) ?? a.workspaces[0];
export const workspaceIn = (a: Account | undefined, id = currentWorkspace()): WorkspaceSummary | undefined => a?.workspaces.find((w) => w.id === id);

/** What the signed-in person may do in the current workspace. */
export function useAccess(): Perms & { workspace?: WorkspaceSummary; installOwner: boolean } {
  const s = useSession();
  useSyncExternalStore((cb) => (listeners.add(cb), () => void listeners.delete(cb)), currentWorkspace);
  const w = workspaceIn(s.account);
  const owner = !!s.account?.user.installOwner;
  return { ...perms(w?.role, owner), workspace: w, installOwner: owner };
}

/** Load the account and settle on a workspace: this tab's last one if still yours, else the server's, else your own. */
export async function loadAccount(): Promise<void> {
  const [account, claude] = await Promise.all([auth.account(), auth.claude().catch(() => undefined)]);
  const pick = workspaceIn(account) ?? workspaceIn(account, account.current) ?? personalOf(account);
  setCurrentWorkspace(pick?.id ?? null);
  // Header-less GETs (event streams, <img>/<video> sources) use the server's idea of your workspace: keep it in step.
  if (pick && pick.id !== account.current) await auth.switchTo(pick.id).catch(() => {});
  set({ phase: 'ready', account: { ...account, current: pick?.id }, claude, notice: undefined });
}

export async function boot(): Promise<void> {
  try {
    const status = await auth.status();
    set({ status });
    if (!status.signedIn) return set({ phase: status.setUp ? 'signed-out' : 'setup' });
    await loadAccount();
  } catch (e) {
    if (state.phase === 'loading') set({ phase: 'offline', notice: (e as Error).message });
  }
}

export async function refreshAccount() {
  if (state.phase === 'ready') await loadAccount().catch(() => {});
}
export async function refreshClaude() {
  set({ claude: await auth.claude() });
}

export async function switchWorkspace(id: string, quiet = false) {
  await auth.switchTo(id);
  setCurrentWorkspace(id);
  await loadAccount();
  if (!quiet) toast(`Now in ${workspaceIn(state.account, id)?.name ?? 'workspace'}`);
}

export async function signOut(everywhere = false) {
  await auth.signOut(everywhere).catch(() => {});
  setCurrentWorkspace(null);
  set({ phase: 'signed-out', account: undefined, claude: undefined, status: { ...(state.status ?? { openSignup: false }), setUp: true, signedIn: false, user: undefined }, notice: everywhere ? 'Signed out on every device.' : undefined });
}

let fallingBack = false;
setProblemHandler(async (d) => {
  if (d.kind === 'signin' || d.kind === 'setup') {
    if (state.phase !== 'ready') return;
    set({ phase: d.kind === 'setup' ? 'setup' : 'signed-out', account: undefined, claude: undefined, notice: 'Your session ended — sign in again.' });
    return;
  }
  if (d.kind === 'workspace-gone' && state.phase === 'ready' && !fallingBack) {
    fallingBack = true;
    try {
      const was = workspaceIn(state.account)?.name;
      const account = await auth.account();
      if (workspaceIn(account)) return;
      const home = personalOf(account);
      setCurrentWorkspace(home?.id ?? null);
      if (home) await auth.switchTo(home.id).catch(() => {});
      set({ account: { ...account, current: home?.id } });
      toast(`You're no longer a member of ${was ?? 'that workspace'} — back in ${home?.name ?? 'your workspace'}.`);
    } catch {
      // A 401 on the way is handled by the branch above.
    } finally {
      fallingBack = false;
    }
  }
});
