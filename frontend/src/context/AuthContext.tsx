import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import * as SecureStore from 'expo-secure-store';
import { authApi, LoginPayload, RegisterPayload, AuthResponse, setUnauthorizedHandler } from '../services/api';

interface User {
  id: number;
  username: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (payload: LoginPayload) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const restoreSession = async () => {
      try {
        const storedToken = await SecureStore.getItemAsync('jwt_token');
        const storedUser = await SecureStore.getItemAsync('user_data');
        if (storedToken && storedUser) {
          setToken(storedToken);
          setUser(JSON.parse(storedUser));
        }
      } catch {
        // If restoring fails, stay logged out
      } finally {
        setIsLoading(false);
      }
    };
    restoreSession();
  }, []);

  const persistSession = async (data: AuthResponse) => {
    await SecureStore.setItemAsync('jwt_token', data.token);
    await SecureStore.setItemAsync('user_data', JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
  };

  const login = async (payload: LoginPayload) => {
    const response = await authApi.login(payload);
    await persistSession(response.data);
  };

  const register = async (payload: RegisterPayload) => {
    const response = await authApi.register(payload);
    await persistSession(response.data);
  };

  const logout = useCallback(async () => {
    await SecureStore.deleteItemAsync('jwt_token');
    await SecureStore.deleteItemAsync('user_data');
    setToken(null);
    setUser(null);
  }, []);

  // Enregistrer le handler dès que logout est stable
  useEffect(() => {
    setUnauthorizedHandler(logout);
  }, [logout]);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
