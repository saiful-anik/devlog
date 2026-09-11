import { useEffect, useState } from "react";
import { Github } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isAuthenticated, signInWithGitHub } from "@/lib/auth";

type LoginState = {
  from?: {
    pathname?: string;
  };
};

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const nextPath = new URLSearchParams(location.search).get("next") || "/";

  useEffect(() => {
    const authError = new URLSearchParams(location.search).get("authError");
    if (authError === "not-authorized") setErrorMessage("You do not have permission to use this app.");
    if (authError === "login-failed") setErrorMessage("GitHub login could not be completed. Please try again.");
  }, [location.search]);

  useEffect(() => {
    let active = true;

    void isAuthenticated().then((authed) => {
      if (active && authed) {
        navigate(nextPath, { replace: true });
      }
    });

    return () => {
      active = false;
    };
  }, [navigate, nextPath]);

  const handleGitHubLogin = async () => {
    setIsLoggingIn(true);
    setErrorMessage(null);

    try {
      const state = (location.state ?? {}) as LoginState;
      const targetPath = state.from?.pathname || nextPath;
      await signInWithGitHub(targetPath);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "GitHub login failed.");
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl">DevLog</CardTitle>
          <CardDescription>Sign in with GitHub</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => void handleGitHubLogin()}
            disabled={isLoggingIn}
            className="w-full"
            size="lg"
          >
            <Github className="mr-2 h-5 w-5" />
            {isLoggingIn ? "Redirecting..." : "Continue with GitHub"}
          </Button>
          {errorMessage && <p className="mt-3 text-center text-sm text-destructive">{errorMessage}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
