// Pure account logic for the web app: what a role may do, what an API error means for the screen,
// and the password rules as hints (mirrors services/engine/src/auth.ts). No DOM, no React.
// None of this is security — the server checks every request; this only avoids showing buttons that would fail.

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';
export const ROLES: Role[] = ['owner', 'admin', 'editor', 'viewer'];
const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 };

export const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', admin: 'Admin', editor: 'Editor', viewer: 'Viewer' };
export const ROLE_ABOUT: Record<Role, string> = {
  owner: 'Everything, including deleting the workspace',
  admin: 'Connections, settings, publishing and members',
  editor: 'Make, edit and schedule',
  viewer: 'Look, but not change anything',
};

export interface Perms {
  role: Role | null;
  /** See the workspace at all. */
  read: boolean;
  /** Make, edit, schedule. */
  write: boolean;
  /** Connections, keys, publishing, workspace settings, members. */
  manage: boolean;
  /** Delete the workspace. */
  own: boolean;
  /** Machine-wide: installs, this computer's Claude and GitHub sign-in, skills. */
  install: boolean;
}

export function perms(role: Role | null | undefined, installOwner = false): Perms {
  const r = role && RANK[role] ? role : null;
  const at = (n: number) => !!r && RANK[r] >= n;
  return { role: r, read: at(1), write: at(2), manage: at(3), own: at(4), install: !!installOwner };
}

/** Why a control is missing, in words for the person. */
export const askFor = (p: Perms, need: 'write' | 'manage' | 'own' | 'install') =>
  need === 'install' ? 'Only the person who set up this Shipcast can change this.'
  : need === 'write' && !p.write ? 'Viewers can look but not change things — ask an editor.'
  : need === 'own' ? 'Only an owner can do this.'
  : 'Ask a workspace admin to do this.';

/** Roles `me` may give `target` (current role) — mirrors setMemberRole: only owners touch owner/admin roles. */
export function roleChoices(me: Role | null, target: Role, o: { self?: boolean; personal?: boolean; owners?: number } = {}): Role[] {
  if (!me || !perms(me).manage) return [];
  if (o.personal && target === 'owner') return [];
  if (target === 'owner' && (o.owners ?? 1) <= 1) return [];
  if (o.self && me !== 'owner') return [];
  if (me === 'owner') return [...ROLES];
  return target === 'editor' || target === 'viewer' ? ['editor', 'viewer'] : [];
}

/** Roles `me` may invite people as (invites never make owners). */
export const inviteRoles = (me: Role | null): Role[] => (me === 'owner' ? ['admin', 'editor', 'viewer'] : me === 'admin' ? ['editor', 'viewer'] : []);

/** 'leave' for yourself, 'remove' for someone you outrank (owners may remove anyone), else null. Mirrors removeMember. */
export function removal(me: Role | null, target: Role, o: { self?: boolean; personal?: boolean; owners?: number } = {}): 'leave' | 'remove' | null {
  if (!me || o.personal) return null;
  if (target === 'owner' && (o.owners ?? 1) <= 1) return null;
  if (o.self) return 'leave';
  if (!perms(me).manage) return null;
  return me === 'owner' || RANK[me] > RANK[target] ? 'remove' : null;
}

export type ErrorDecision =
  | { kind: 'signin' }
  | { kind: 'setup' }
  | { kind: 'workspace-gone' }
  | { kind: 'forbidden'; message: string }
  | { kind: 'error'; message: string };

/** What the app should do about a failed API call. Only 401s and a lost workspace change the screen; the rest are shown where they happened. */
export function decideError(status: number, message: string, path = ''): ErrorDecision {
  const m = message || `Request failed (${status})`;
  if (status === 401 && !/^\/api\/(auth\/(signin|signup)|account\/password)$/.test(path)) return /first account/i.test(m) ? { kind: 'setup' } : { kind: 'signin' };
  // "workspace not found" means you're no longer in a workspace you named; the app re-checks which ones you have.
  if (status === 404 && /^workspace not found\.?$/i.test(m)) return { kind: 'workspace-gone' };
  if (status === 403) return { kind: 'forbidden', message: m === 'missing request header' ? 'This page is out of date — reload it and try again.' : m };
  return { kind: 'error', message: m };
}

export interface PasswordHint { id: string; text: string; ok: boolean }

/** The server's password rules as a live checklist; `problem` is the first unmet rule, worded like the server. */
export function passwordHints(pw: string, email = ''): { hints: PasswordHint[]; problem: string | null } {
  const local = email.trim().toLowerCase().split('@')[0] ?? '';
  const fromEmail = local.length >= 4 && pw.toLowerCase().includes(local);
  const easy = pw.length > 0 && (/^(.)\1+$/.test(pw) || /^(0123456789|1234567890|password|qwerty)/i.test(pw));
  const hints: PasswordHint[] = [
    { id: 'length', text: 'At least 10 characters', ok: pw.length >= 10 && pw.length <= 200 },
    { id: 'email', text: 'Not built from your email', ok: pw.length > 0 && !fromEmail },
    { id: 'easy', text: 'Not an easy guess (like “password…” or one repeated key)', ok: pw.length > 0 && !easy },
  ];
  const problem = pw.length < 10 ? 'Use at least 10 characters.' : pw.length > 200 ? 'That password is too long.' : fromEmail ? "Don't build the password from your email." : easy ? 'That password is too easy to guess.' : null;
  return { hints, problem };
}

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
export const emailProblem = (e: string) => (EMAIL_RE.test(e.trim().toLowerCase()) ? null : 'Enter a valid email address.');

/** What a pasted Claude credential is (mirrors credentialKind in claude-account.ts). */
export function credentialKind(value: string): 'token' | 'apiKey' | null {
  const v = String(value ?? '').trim();
  if (/^sk-ant-oat\d*-[\w-]{20,}$/.test(v)) return 'token';
  if (/^sk-ant-api\d*-[\w-]{20,}$/.test(v)) return 'apiKey';
  return null;
}

/** "Chrome on macOS" from a user-agent string, for the sessions list. */
export function deviceLabel(agent = ''): string {
  const browser = /Edg\//.test(agent) ? 'Edge' : /OPR\/|Opera/.test(agent) ? 'Opera' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\/|CriOS/.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : /curl|node|undici/i.test(agent) ? 'A script' : '';
  const os = /iPhone|iPad/.test(agent) ? 'iOS' : /Android/.test(agent) ? 'Android' : /Mac OS X|Macintosh/.test(agent) ? 'macOS' : /Windows/.test(agent) ? 'Windows' : /Linux/.test(agent) ? 'Linux' : '';
  return browser && os ? `${browser} on ${os}` : browser || os || 'Unknown device';
}

export const initials = (name: string) => name.trim().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
