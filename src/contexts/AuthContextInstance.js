import { createContext } from 'react';

export const AuthContext = createContext({
  user: null,
  loading: true,
  isConfigured: false,
  login: async () => {},
  logout: async () => {},
});
