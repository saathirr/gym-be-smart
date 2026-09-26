import { useCallback, useEffect, useMemo, useState } from 'react';
import { settingsService } from '../services/settingsService';
import { useAuth } from '../hooks/useAuth';
import { GymContext } from './GymContextInstance';

// Public branding for screens shown before sign-in, where the database is
// not readable yet. Once signed in the value from gym_settings takes over.
const FALLBACK_NAME = import.meta.env.VITE_GYM_NAME?.trim() || 'Be Smart Fitness Club';

export function GymProvider({ children }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState({
    ...settingsService.DEFAULT_SETTINGS,
    gym_name: FALLBACK_NAME,
  });
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [profile, branchList] = await Promise.all([
        settingsService.getGymSettings(),
        settingsService.getBranches({ includeInactive: false }),
      ]);
      setSettings(profile);
      setBranches(branchList);
    } catch (err) {
      console.error('Could not load club settings:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    load();
  }, [user, load]);

  const name = settings.gym_name || FALLBACK_NAME;

  // Keep the browser tab in sync with the club name from gym_settings.
  useEffect(() => {
    document.title = `${name} | Gym Management System`;
  }, [name]);

  const saveSettings = useCallback(async (values) => {
    await settingsService.saveGymSettings(values);
    await load();
  }, [load]);

  const value = useMemo(
    () => ({
      settings,
      branches,
      loading,
      reload: load,
      saveSettings,
      gymName: name,
      currency: settings.currency || 'LKR',
    }),
    [settings, branches, loading, load, saveSettings, name]
  );

  return <GymContext.Provider value={value}>{children}</GymContext.Provider>;
}
