import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { useEffect, useMemo, useState } from 'react';
import { DashboardPage } from './components/DashboardPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { OrderDetailModal } from './components/OrderDetailModal';
import { OrderForm } from './components/OrderForm';
import { OrdersPage } from './components/OrdersPage';
import { PrivateAccessGate } from './components/PrivateAccessGate';
import { ReportsPage } from './components/ReportsPage';
import { SettingsPage } from './components/SettingsPage';
import { OWNER_EMAIL, auth } from './firebase/config';
import { getUserFriendlyError } from './firebase/errors';
import { subscribeToOrders } from './services/orders';
import { subscribeToSettings } from './services/settings';
import type { AppView, Order, StoreSettings } from './types/order';
import { DEFAULT_STORE_SETTINGS } from './utils/payment';

function AppShell() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  const [settings, setSettings] = useState<StoreSettings>(DEFAULT_STORE_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);

  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  const [activeView, setActiveView] = useState<AppView>('dashboard');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
      setAccessDenied(false);
      setDataError(null);
      if (!firebaseUser) {
        setOrders([]);
        setOrdersLoading(false);
        setSettingsLoaded(false);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || !user) return;
    const email = user.email?.toLowerCase() ?? '';
    if (!email || !user.emailVerified) {
      setAccessDenied(true);
      setSettingsLoaded(true);
      return;
    }

    const unsubSettings = subscribeToSettings(
      (nextSettings) => {
        setSettings(nextSettings);
        setSettingsLoaded(true);
        const isOwner = email === OWNER_EMAIL;
        const isPartner = nextSettings.partnerEmails.some(
          (p) => p.trim().toLowerCase() === email
        );
        setAccessDenied(!isOwner && !isPartner);
      },
      (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Missing or insufficient permissions') || msg.includes('permission-denied')) {
          setAccessDenied(true);
          setSettingsLoaded(true);
        } else {
          setDataError(getUserFriendlyError(err));
          setSettingsLoaded(true);
        }
      }
    );

    return () => unsubSettings();
  }, [authReady, user]);

  useEffect(() => {
    if (!authReady || !user || !settingsLoaded || accessDenied) return;
    const email = user.email?.toLowerCase() ?? '';
    if (!email) return;

    setOrdersLoading(true);
    const unsubOrders = subscribeToOrders(
      email,
      (nextOrders) => {
        setOrders(nextOrders);
        setOrdersLoading(false);
        setDataError(null);
      },
      (err) => {
        setOrdersLoading(false);
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Missing or insufficient permissions') || msg.includes('permission-denied')) {
          setAccessDenied(true);
        } else {
          setDataError(getUserFriendlyError(err, 'Could not load orders.'));
        }
      }
    );

    return () => unsubOrders();
  }, [authReady, user, settingsLoaded, accessDenied]);

  const selectedOrder = useMemo(
    () => (selectedOrderId ? orders.find((o) => o.id === selectedOrderId) ?? null : null),
    [orders, selectedOrderId]
  );

  async function handleSignOut() {
    await signOut(auth);
    setSelectedOrderId(null);
    setEditingOrder(null);
    setActiveView('dashboard');
  }

  function handleNavigate(view: AppView) {
    setSelectedOrderId(null);
    setEditingOrder(null);
    setActiveView(view);
  }

  function handleOpenNewOrder() {
    setSelectedOrderId(null);
    setEditingOrder(null);
    setActiveView('new-order');
  }

  if (!authReady || (user && !settingsLoaded)) {
    return (
      <div className="min-h-screen bg-[#F8F7F4] flex flex-col items-center justify-center p-6">
        <p className="font-display text-3xl font-semibold tracking-[0.06em] text-[#141413]">
          SHISHU.CLO
        </p>
        <p className="mt-2 text-xs text-[#78716C]">Loading private workspace...</p>
      </div>
    );
  }

  if (!user) {
    return <PrivateAccessGate mode="signed-out" />;
  }

  if (accessDenied) {
    return <PrivateAccessGate mode="unauthorized" signedInEmail={user.email} />;
  }

  return (
    <Layout
      activeView={activeView}
      onNavigate={handleNavigate}
      onOpenNewOrder={handleOpenNewOrder}
      userEmail={user.email ?? ''}
      brandName={settings.brandName}
      onSignOut={handleSignOut}
    >
      {dataError && (
        <div className="mb-5 rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm font-medium text-rose-800">
          {dataError}
        </div>
      )}

      {editingOrder ? (
        <OrderForm
          mode="edit"
          initialOrder={editingOrder}
          settings={settings}
          user={user}
          onCancel={() => setEditingOrder(null)}
          onSuccess={() => {
            setEditingOrder(null);
          }}
        />
      ) : selectedOrder ? (
        <OrderDetailModal
          order={selectedOrder}
          settings={settings}
          onClose={() => setSelectedOrderId(null)}
          onEdit={(order) => setEditingOrder(order)}
          onDeleted={() => {
            setSelectedOrderId(null);
          }}
        />
      ) : activeView === 'new-order' ? (
        <OrderForm
          mode="create"
          settings={settings}
          user={user}
          onCancel={() => setActiveView('dashboard')}
          onSuccess={(created) => {
            if (created) {
              setActiveView('orders');
              setSelectedOrderId(created.id);
            } else {
              setActiveView('orders');
            }
          }}
        />
      ) : activeView === 'orders' ? (
        <OrdersPage
          orders={orders}
          loading={ordersLoading}
          settings={settings}
          onNewOrder={handleOpenNewOrder}
          onSelectOrder={(order) => setSelectedOrderId(order.id)}
        />
      ) : activeView === 'reports' ? (
        <ReportsPage orders={orders} settings={settings} />
      ) : activeView === 'settings' ? (
        <SettingsPage
          settings={settings}
          orders={orders}
          user={user}
          onSignOut={handleSignOut}
        />
      ) : (
        <DashboardPage
          orders={orders}
          loading={ordersLoading}
          settings={settings}
          onNewOrder={handleOpenNewOrder}
          onSelectOrder={(order) => setSelectedOrderId(order.id)}
          onViewAllOrders={() => handleNavigate('orders')}
        />
      )}
    </Layout>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  );
}
