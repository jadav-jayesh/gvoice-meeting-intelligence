import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  deleteAccount as deleteAccountApi,
  getMe,
  login as loginApi,
  logout as logoutApi,
  setUnauthorizedHandler,
  signup as signupApi,
  updateMe as updateMeApi,
  UnauthorizedError,
  type LoginPayload,
  type SignupPayload,
  type UpdateProfilePayload
} from "../lib/api";
import type { User } from "../lib/types";

type AuthStatus = "loading" | "authenticated" | "anonymous";

interface AuthCtx {
  user: User | null;
  status: AuthStatus;
  login: (payload: LoginPayload) => Promise<User>;
  signup: (payload: SignupPayload) => Promise<User>;
  logout: () => Promise<void>;
  updateProfile: (payload: UpdateProfilePayload) => Promise<User>;
  deleteAccount: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const didBootstrap = useRef(false);

  const handleUnauthorized = useCallback(() => {
    setUser(null);
    setStatus("anonymous");
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(handleUnauthorized);
    return () => setUnauthorizedHandler(null);
  }, [handleUnauthorized]);

  useEffect(() => {
    if (didBootstrap.current) return;
    didBootstrap.current = true;
    (async () => {
      try {
        const { user: me } = await getMe();
        setUser(me);
        setStatus("authenticated");
      } catch (err) {
        if (!(err instanceof UnauthorizedError)) {
          // Network/server error — still treat as anonymous so the user
          // lands on /login instead of being stuck on a spinner forever.
          // eslint-disable-next-line no-console
          console.warn("auth bootstrap failed", err);
        }
        setUser(null);
        setStatus("anonymous");
      }
    })();
  }, []);

  const login = useCallback(async (payload: LoginPayload) => {
    const { user: me } = await loginApi(payload);
    setUser(me);
    setStatus("authenticated");
    return me;
  }, []);

  const signup = useCallback(async (payload: SignupPayload) => {
    const { user: me } = await signupApi(payload);
    setUser(me);
    setStatus("authenticated");
    return me;
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutApi();
    } finally {
      setUser(null);
      setStatus("anonymous");
    }
  }, []);

  const updateProfile = useCallback(async (payload: UpdateProfilePayload) => {
    const { user: me } = await updateMeApi(payload);
    setUser(me);
    return me;
  }, []);

  const deleteAccount = useCallback(async (password: string) => {
    // Server deletes all data and clears the auth cookies; mirror that locally
    // so the app drops straight to the anonymous (landing/login) state.
    await deleteAccountApi(password);
    setUser(null);
    setStatus("anonymous");
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({ user, status, login, signup, logout, updateProfile, deleteAccount }),
    [user, status, login, signup, logout, updateProfile, deleteAccount]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
