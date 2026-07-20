import { useCallback, useEffect, useState } from 'react';
import type { AccountInfo } from '@azure/msal-browser';
import { getActiveAccount, pullFilesFromOneDrive, signIn as msalSignIn, signOut as msalSignOut } from '../lib/oneDrive';

export function useOneDrive() {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getActiveAccount()
      .then(setAccount)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to check Microsoft sign-in status.'))
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async () => {
    setError(null);
    try {
      const acc = await msalSignIn();
      setAccount(acc);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Microsoft sign-in failed.');
    }
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    try {
      await msalSignOut();
      setAccount(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Microsoft sign-out failed.');
    }
  }, []);

  const pullFiles = useCallback((subfolderName: string) => pullFilesFromOneDrive(subfolderName), []);

  return { account, loading, error, signIn, signOut, pullFiles };
}
