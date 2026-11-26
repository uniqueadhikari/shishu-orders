import type { User } from 'firebase/auth';
import { Check, Loader2, LogOut, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { OWNER_EMAIL } from '../firebase/config';
import { getUserFriendlyError } from '../firebase/errors';
import { saveStoreSettings } from '../services/settings';
import type { InventoryItem, Order, StoreSettings } from '../types/order';

interface SettingsPageProps {
  settings: StoreSettings;
  orders: Order[];
  inventory: InventoryItem[];
  user: User;
  onSignOut: () => void;
  onNotify?: (text: string) => void;
}

export function SettingsPage({
  settings,
  orders,
  inventory,
  user,
  onSignOut,
  onNotify,
}: SettingsPageProps) {
  const isOwner = user.email?.toLowerCase() === OWNER_EMAIL;

  const [brandName, setBrandName] = useState(settings.brandName);
  const [currency, setCurrency] = useState(settings.currency);
  const [insideValleyRate, setInsideValleyRate] = useState(String(settings.insideValleyRate));
  const [outsideValleyRate, setOutsideValleyRate] = useState(String(settings.outsideValleyRate));
  const [otherRate, setOtherRate] = useState(String(settings.otherRate));
  const [partnerEmail, setPartnerEmail] = useState(settings.partnerEmails[0] ?? '');

  const [saving, setSaving] = useState(false);
  const [savedBanner, setSavedBanner] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBrandName(settings.brandName);
    setCurrency(settings.currency);
    setInsideValleyRate(String(settings.insideValleyRate));
    setOutsideValleyRate(String(settings.outsideValleyRate));
    setOtherRate(String(settings.otherRate));
    setPartnerEmail(settings.partnerEmails[0] ?? '');
  }, [settings]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!isOwner) return;

    setError(null);
    setSavedBanner(false);
    setSaving(true);
    try {
      const partnerEmails = partnerEmail.trim() ? [partnerEmail.trim().toLowerCase()] : [];
      await saveStoreSettings(
        {
          brandName,
          currency,
          insideValleyRate: Number(insideValleyRate),
          outsideValleyRate: Number(outsideValleyRate),
          otherRate: Number(otherRate),
          partnerEmails,
        },
        user,
        orders,
        inventory
      );
      setSavedBanner(true);
      onNotify?.('Studio settings saved and synced');
    } catch (err) {
      setError(getUserFriendlyError(err, 'Could not save settings.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#8C877E]">
          Studio Defaults & Access
        </p>
        <h1 className="mt-1 text-3xl sm:text-4xl font-display font-semibold tracking-tight text-[#121211]">
          Settings
        </h1>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm font-medium text-rose-800">
          {error}
        </div>
      )}

      {savedBanner && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm font-medium text-emerald-900 flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" />
          <span>Settings updated and synced.</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Brand & Currency */}
        <section className="bg-white border border-[#E6E2D8] rounded-2xl p-5 sm:p-6 space-y-4">
          <h2 className="text-sm font-semibold text-[#121211]">Brand & Currency</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="brandName" className="block text-xs font-medium text-[#5C5852] mb-1.5">
                Brand name
              </label>
              <input
                id="brandName"
                type="text"
                disabled={!isOwner}
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none disabled:opacity-60 text-sm"
              />
            </div>

            <div>
              <label htmlFor="currency" className="block text-xs font-medium text-[#5C5852] mb-1.5">
                Currency symbol (NPR)
              </label>
              <input
                id="currency"
                type="text"
                disabled={!isOwner}
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none disabled:opacity-60 text-sm"
              />
            </div>
          </div>
        </section>

        {/* Delivery Charges */}
        <section className="bg-white border border-[#E6E2D8] rounded-2xl p-5 sm:p-6 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-[#121211]">Delivery Charges</h2>
            <p className="text-xs text-[#8C877E] mt-0.5">
              Changes apply immediately to new orders without affecting past order totals.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="rateInside" className="block text-xs font-medium text-[#5C5852] mb-1.5">
                Inside Valley ({currency})
              </label>
              <input
                id="rateInside"
                type="number"
                min="0"
                step="any"
                disabled={!isOwner}
                value={insideValleyRate}
                onChange={(e) => setInsideValleyRate(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none disabled:opacity-60 text-sm font-mono tabular-nums"
              />
            </div>

            <div>
              <label htmlFor="rateOutside" className="block text-xs font-medium text-[#5C5852] mb-1.5">
                Outside Valley ({currency})
              </label>
              <input
                id="rateOutside"
                type="number"
                min="0"
                step="any"
                disabled={!isOwner}
                value={outsideValleyRate}
                onChange={(e) => setOutsideValleyRate(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none disabled:opacity-60 text-sm font-mono tabular-nums"
              />
            </div>

            <div>
              <label htmlFor="rateOther" className="block text-xs font-medium text-[#5C5852] mb-1.5">
                Other ({currency})
              </label>
              <input
                id="rateOther"
                type="number"
                min="0"
                step="any"
                disabled={!isOwner}
                value={otherRate}
                onChange={(e) => setOtherRate(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none disabled:opacity-60 text-sm font-mono tabular-nums"
              />
            </div>
          </div>
        </section>

        {/* Private Two-User Access */}
        <section className="bg-white border border-[#E6E2D8] rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-[#121211] shrink-0 mt-0.5" />
            <div>
              <h2 className="text-sm font-semibold text-[#121211]">Private Team Access</h2>
              <p className="text-xs text-[#5C5852] mt-0.5">
                Only these two Google accounts can sign in and access Shishu.clo orders and photos.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#5C5852] mb-1.5">
                Primary Owner Account
              </label>
              <input
                type="text"
                readOnly
                value={OWNER_EMAIL}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-[#E6E2D8] bg-[#F7F5F0] text-sm text-[#5C5852]"
              />
            </div>

            <div>
              <label htmlFor="partnerEmail" className="block text-xs font-medium text-[#5C5852] mb-1.5">
                Partner Google Email
              </label>
              <input
                id="partnerEmail"
                type="email"
                disabled={!isOwner}
                value={partnerEmail}
                onChange={(e) => setPartnerEmail(e.target.value)}
                placeholder="partner@gmail.com"
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none disabled:opacity-60 text-sm"
              />
            </div>
          </div>

          {!isOwner && (
            <p className="text-xs text-[#8C877E]">
              Only the primary owner ({OWNER_EMAIL}) can modify store rates or authorized partner email.
            </p>
          )}
        </section>

        {isOwner && (
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="min-h-[46px] px-6 py-2.5 rounded-xl bg-[#121211] text-[#F7F5F0] text-sm font-medium hover:bg-[#272624] disabled:opacity-60 transition-colors inline-flex items-center gap-2 cursor-pointer"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{saving ? 'Saving Settings...' : 'Save Settings'}</span>
            </button>
          </div>
        )}
      </form>

      {/* Account Session */}
      <section className="bg-white border border-[#E6E2D8] rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs text-[#8C877E]">Signed-in Google Account</p>
          <p className="text-sm font-medium text-[#121211] mt-0.5">{user.email}</p>
        </div>

        <button
          type="button"
          onClick={onSignOut}
          className="min-h-[42px] px-4 py-2 rounded-xl border border-[#DDD8CE] bg-white hover:bg-[#F7F5F0] text-sm font-medium text-[#121211] inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign Out</span>
        </button>
      </section>
    </div>
  );
}
