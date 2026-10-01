const STORAGE_KEY = 'gym.adminWelcomeAt';

// Survives the redirect from /login to the dashboard (a plain React state in
// LoginPage would be thrown away by the navigation) but not a page reload,
// so the welcome banner shows once per sign-in instead of on every refresh.
export function flagAdminWelcome(user) {
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        name: user?.full_name || user?.email || 'Administrator',
        role: user?.role || 'admin',
        at: Date.now(),
      })
    );
  } catch {
    // Private browsing or a full quota: the banner is cosmetic, so skip it
    // rather than blocking the sign-in.
  }
}

// Reads and clears in one step so the banner cannot reappear on the next
// dashboard visit. Returns null for staff/trainer accounts.
export function takeAdminWelcome() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || parsed.role !== 'admin') return null;
    return parsed;
  } catch {
    return null;
  }
}