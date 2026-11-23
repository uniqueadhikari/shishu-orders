import { signInWithPopup, signOut } from 'firebase/auth';
import { Lock, LogOut, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { auth, googleProvider } from '../firebase/config';
import { getUserFriendlyError } from '../firebase/errors';

interface PrivateAccessGateProps {
  mode: 'signed-out' | 'unauthorized';
  signedInEmail?: string | null;
}

export function PrivateAccessGate({ mode, signedInEmail }: PrivateAccessGateProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogleSignIn() {
    setError(null);
    setBusy(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError(getUserFriendlyError(err, 'Could not complete Google Sign-In.'));
    } finally {
      setBusy(false);
    }
  }

  async function handleSwitchAccount() {
    setError(null);
    setBusy(true);
    try {
      await signOut(auth);
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError(getUserFriendlyError(err, 'Could not switch Google account.'));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setBusy(true);
    try {
      await signOut(auth);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F8F7F4] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white border border-[#E8E5DF] rounded-2xl p-7 sm:p-9">
        <div className="text-center">
          <p className="font-display text-3xl font-semibold tracking-[0.06em] text-[#141413]">
            SHISHU.CLO
          </p>
          <p className="mt-1 text-xs font-medium tracking-wide text-[#78716C]">
            Order Management Atelier
          </p>
        </div>

        <div className="my-7 border-t border-[#ECE9E2]" />

        {mode === 'unauthorized' ? (
          <div className="space-y-5">
            <div className="flex items-start gap-3 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900">
              <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5 text-rose-700" />
              <div className="text-sm leading-relaxed">
                <p className="font-semibold">Private Workspace Access Only</p>
                <p className="mt-1 text-rose-800">
                  The account <span className="font-medium break-all">{signedInEmail || 'signed in'}</span> is not authorized to access Shishu.clo orders.
                </p>
              </div>
            </div>

            {error && (
              <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
                {error}
              </p>
            )}

            <div className="space-y-2.5">
              <button
                type="button"
                disabled={busy}
                onClick={handleSwitchAccount}
                className="w-full min-h-[46px] px-5 py-3 rounded-xl bg-[#141413] text-white text-sm font-medium hover:bg-[#292826] disabled:opacity-50 transition-colors cursor-pointer"
              >
                {busy ? 'Opening Google Sign-In...' : 'Switch Google Account'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleSignOut}
                className="w-full min-h-[44px] px-5 py-2.5 rounded-xl border border-[#DFDBD2] text-[#57534E] text-sm font-medium hover:bg-[#F5F3EE] transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <div className="mx-auto w-11 h-11 rounded-full bg-[#F5F3EE] border border-[#E8E5DF] flex items-center justify-center text-[#141413]">
                <Lock className="w-5 h-5" />
              </div>
              <h1 className="text-lg font-semibold text-[#141413]">
                Private Studio Sign-In
              </h1>
              <p className="text-sm text-[#57534E] leading-relaxed">
                Sign in with an authorized Shishu.clo Google account to manage orders, photos, and reports.
              </p>
            </div>

            {error && (
              <div className="text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
                {error}
              </div>
            )}

            <button
              type="button"
              disabled={busy}
              onClick={handleGoogleSignIn}
              className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-[#141413] text-white text-sm font-medium hover:bg-[#292826] active:scale-[0.99] disabled:opacity-50 transition-all flex items-center justify-center gap-3 cursor-pointer"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81Z"
                />
              </svg>
              {busy ? 'Signing in...' : 'Continue with Google'}
            </button>

            <p className="text-center text-xs text-[#78716C]">
              Restricted to authorized Shishu.clo team accounts.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
