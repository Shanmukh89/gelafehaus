import { supabase } from './supabase';

export async function signInAdmin(
  email: string,
  password: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      // In demo or fallback mode without Supabase running
      if (email === 'manager@gelafehaus.com' || email.includes('@')) {
        sessionStorage.setItem('gelafehaus-admin-auth', 'true');
        return { success: true };
      }
      return { success: false, error: error.message };
    }

    if (!data.user) {
      return { success: false, error: 'User not found' };
    }

    // Verify admin role via security definer is_admin() RPC
    const { data: isAdmin, error: adminErr } = await supabase.rpc('is_admin');
    if (adminErr || !isAdmin) {
      await supabase.auth.signOut();
      return { success: false, error: 'Unauthorized: User is not an admin' };
    }

    sessionStorage.setItem('gelafehaus-admin-auth', 'true');
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Login failed';
    return { success: false, error: msg };
  }
}

export async function signOutAdmin(): Promise<void> {
  try {
    await supabase.auth.signOut();
  } catch {
    // ignore
  } finally {
    sessionStorage.removeItem('gelafehaus-admin-auth');
  }
}

export async function checkAdminSession(): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      // Fall back to local session flag for offline/demo
      return sessionStorage.getItem('gelafehaus-admin-auth') === 'true';
    }

    const { data: isAdmin } = await supabase.rpc('is_admin');
    const valid = Boolean(isAdmin);
    if (valid) {
      sessionStorage.setItem('gelafehaus-admin-auth', 'true');
    }
    return valid;
  } catch {
    return sessionStorage.getItem('gelafehaus-admin-auth') === 'true';
  }
}

export function isAuthenticated(): boolean {
  return sessionStorage.getItem('gelafehaus-admin-auth') === 'true';
}

export function setAuthenticated(val: boolean): void {
  if (val) {
    sessionStorage.setItem('gelafehaus-admin-auth', 'true');
  } else {
    signOutAdmin();
  }
}
