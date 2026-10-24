import { useState } from 'react';
import { AuthError, type Auth } from '../lib/auth.ts';
import { Button, Alert } from '../ui/primitives.tsx';
import { Centered } from '../ui/shell.tsx';

export function SignInScreen({ auth, notice, error }: { auth: Auth; notice?: string; error?: string }) {
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState<string | undefined>(error);

  const start = async () => {
    setStarting(true);
    try {
      await auth.login(window.location.pathname + window.location.search);
    } catch (e) {
      setFailed(e instanceof AuthError ? e.message : 'Could not start sign-in.');
      setStarting(false);
    }
  };

  return (
    <Centered title="Sign in">
      <p>This is where AWS UG Delhi NCR organizers update the website. Only invited organizers can sign in.</p>
      {notice && <Alert tone="info">{notice}</Alert>}
      {failed && <Alert tone="error">{failed}</Alert>}
      <p>
        <Button variant="primary" onClick={start} disabled={starting}>
          {starting ? 'Redirecting…' : 'Sign in'}
        </Button>
      </p>
      <p className="text-base">You will be asked for your password and a code from your authenticator app. If you have not been invited, ask the lead organizer.</p>
    </Centered>
  );
}

export function NotAllowedScreen({ username, onSignOut }: { username: string; onSignOut: () => void }) {
  return (
    <Centered title="Not an organizer">
      <p>
        You are signed in as <strong className="text-foreground">{username}</strong>, but this account is not in the organizers group, so it cannot edit the site.
      </p>
      <p>Ask the lead organizer to add you, then sign in again.</p>
      <p>
        <Button onClick={onSignOut}>Sign out</Button>
      </p>
    </Centered>
  );
}

export function ConfigErrorScreen({ message }: { message: string }) {
  return (
    <Centered title="Not set up yet">
      <Alert tone="error">{message}</Alert>
      <p className="text-base">This is a setup problem, not something you did. Tell the tech volunteer.</p>
    </Centered>
  );
}
