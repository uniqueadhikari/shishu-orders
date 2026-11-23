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
    <div className="min-h-screen bg-[#F7F5F0] text-[#121211] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-[420px] bg-white border border-[#E6E2D8] rounded-2xl p-8 sm:p-10 shadow-[0_12px_36px_-18px_rgba(18,18,17,0.12)]">
        <div className="text-center">
          <div className="mx-auto w-12 h-12 rounded-xl overflow-hidden border border-[#E6E2D8] bg-[#F7F5F0] flex items-center justify-center mb-4">
            <img
              src="/favicon.ico"
              alt="Shishu.clo"
              className="w-8 h-8 object-contain"
              referrerPolicy="no-referrer"
            />
          </div>
          <p className="font-display text-3xl sm:text-[34px] font-semibold tracking-[0.08em] text-[#121211] leading-none">
            SHISHU.CLO
          </p>
          <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[#8C877E]">
            Private Order Atelier
          </p>
        </div>

        <div className="my-7 border-t border-[#ECE9E2]" />

        {mode === 'unauthorized' ? (
          <div className="space-y-5">
            <div className="flex items-start gap-3 p-4 rounded-xl bg-rose-50/90 border border-rose-200 text-rose-900">
              <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5 text-rose-700" />
              <div className="text-sm leading-relaxed">
                <p className="font-semibold">Private Workspace Access Only</p>
                <p className="mt-1 text-rose-800">
                  The account{' '}
                  <span className="font-medium break-all">{signedInEmail || 'signed in'}</span> is
                  not authorized to access Shishu.clo orders.
                </p>
              </div>
            </div>

            {error && (
              <p className="text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
                {error}
              </p>
            )}

            <div className="space-y-2.5">
              <button
                type="button"
                disabled={busy}
                onClick={handleSwitchAccount}
                className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-[#121211] text-[#F7F5F0] text-sm font-medium hover:bg-[#272624] active:scale-[0.99] disabled:opacity-50 transition-all cursor-pointer"
              >
                {busy ? 'Opening Google Sign-In...' : 'Switch Google Account'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleSignOut}
                className="w-full min-h-[44px] px-5 py-2.5 rounded-xl border border-[#DDD8CE] text-[#5C5852] text-sm font-medium hover:bg-[#F7F5F0] transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <div className="inline-flex items-center gap-1.5 text-xs font-medium text-[#5C5852]">
                <Lock className="w-3.5 h-3.5 text-[#8C877E]" />
                <span>Two-Person Private Studio</span>
              </div>
              <p className="text-sm text-[#5C5852] leading-relaxed">
                Sign in with an authorized Shishu.clo Google account to manage orders, piece photos,
                and studio reports.
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
              className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-[#121211] text-[#F7F5F0] text-sm font-medium hover:bg-[#272624] active:scale-[0.99] disabled:opacity-50 transition-all flex items-center justify-center gap-3 shadow-sm cursor-pointer"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81Z"
                />
              </svg>
              <span>{busy ? 'Signing in...' : 'Continue with Google'}</span>
            </button>

            <p className="text-center text-xs text-[#8C877E]">
              Restricted to authorized Shishu.clo team accounts.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
