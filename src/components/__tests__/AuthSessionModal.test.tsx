import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthSessionModal } from "@/components/heliophysics/AuthSessionModal";
import type { AuthSessionState } from "@/lib/types/space-weather";
import {
  signInWithOAuth,
  signInWithPassword,
  signOutSession,
} from "@/lib/api/auth";

jest.mock("@/lib/api/auth", () => ({
  signInWithOAuth: jest.fn(),
  signInWithPassword: jest.fn(),
  signOutSession: jest.fn(),
}));

const defaultSession: AuthSessionState = {
  authRequired: true,
  authenticated: false,
  role: null,
  clearance: null,
  userId: null,
  email: null,
  emailVerified: false,
};

describe("AuthSessionModal", () => {
  const mockedSignInWithOAuth = jest.mocked(signInWithOAuth);
  const mockedSignInWithPassword = jest.mocked(signInWithPassword);
  const mockedSignOutSession = jest.mocked(signOutSession);
  const onOpenChange = jest.fn();
  const onSessionRefresh = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("submits password login and refreshes session", async () => {
    mockedSignInWithPassword.mockResolvedValue(undefined);

    render(
      <MemoryRouter>
        <AuthSessionModal
          open
          onOpenChange={onOpenChange}
          session={defaultSession}
          onSessionRefresh={onSessionRefresh}
        />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByPlaceholderText("Email"), {
      target: { value: "viewer@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "strong-password" },
    });

    fireEvent.click(screen.getByRole("button", { name: /sign in with password/i }));

    await waitFor(() => {
      expect(mockedSignInWithPassword).toHaveBeenCalledWith(
        "viewer@example.com",
        "strong-password",
      );
    });
    await waitFor(() => {
      expect(onSessionRefresh).toHaveBeenCalled();
    });
  });

  it("calls Google OAuth and refreshes session", async () => {
    mockedSignInWithOAuth.mockResolvedValue(undefined);

    render(
      <MemoryRouter>
        <AuthSessionModal
          open
          onOpenChange={onOpenChange}
          session={defaultSession}
          onSessionRefresh={onSessionRefresh}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /google sso/i }));

    await waitFor(() => {
      expect(mockedSignInWithOAuth).toHaveBeenCalledWith("google");
    });
    await waitFor(() => {
      expect(onSessionRefresh).toHaveBeenCalled();
    });
  });

  it("signs out when session is authenticated", async () => {
    mockedSignOutSession.mockResolvedValue(undefined);
    const authenticatedSession: AuthSessionState = {
      authRequired: true,
      authenticated: true,
      role: "operator",
      clearance: "mission",
      userId: "u-1",
      email: "operator@example.com",
      emailVerified: true,
    };

    render(
      <MemoryRouter>
        <AuthSessionModal
          open
          onOpenChange={onOpenChange}
          session={authenticatedSession}
          onSessionRefresh={onSessionRefresh}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => {
      expect(mockedSignOutSession).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(onSessionRefresh).toHaveBeenCalled();
    });
  });
});
