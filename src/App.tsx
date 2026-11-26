import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardPage } from './components/DashboardPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { InventoryPage } from './components/InventoryPage';
import { Layout } from './components/Layout';
import { OrderDetailModal } from './components/OrderDetailModal';
import { OrderForm } from './components/OrderForm';
import { OrdersPage } from './components/OrdersPage';
import { PrivateAccessGate } from './components/PrivateAccessGate';
import { ReportsPage } from './components/ReportsPage';
import { SettingsPage } from './components/SettingsPage';
import { ToastContainer, type ToastMessage } from './components/Toast';
import { OWNER_EMAIL, auth } from './firebase/config';
import { getUserFriendlyError } from './firebase/errors';
import { getStockState, subscribeToInventory } from './services/inventory';
import { subscribeToOrders } from './services/orders';
import { subscribeToSettings } from './services/settings';
import type {
  AppView,
  InventoryItem,
  Order,
  OrderStatus,
  StoreSettings,
} from './types/order';
import { DEFAULT_STORE_SETTINGS } from './utils/payment';

function AppShell() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  const [settings, setSettings] = useState<StoreSettings>(DEFAULT_STORE_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);

  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  const [activeView, setActiveView] = useState<AppView>('dashboard');
  const [ordersInitialStatus, setOrdersInitialStatus] = useState<OrderStatus | 'ALL'>('ALL');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [preselectedStockItem, setPreselectedStockItem] = useState<InventoryItem | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((text: string, tone: 'success' | 'info' = 'success') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-2), { id, text, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
      setAccessDenied(false);
      setDataError(null);
      if (!firebaseUser) {
        setOrders([]);
        setOrdersLoading(false);
        setInventory([]);
        setInventoryLoading(false);
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

    setInventoryLoading(true);
    const unsubInventory = subscribeToInventory(
      email,
      (nextItems) => {
        setInventory(nextItems);
        setInventoryLoading(false);
      },
      (err) => {
        setInventoryLoading(false);
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Missing or insufficient permissions') || msg.includes('permission-denied')) {
          setAccessDenied(true);
        } else {
          setDataError(getUserFriendlyError(err, 'Could not load inventory.'));
        }
      }
    );

    return () => {
      unsubOrders();
      unsubInventory();
    };
  }, [authReady, user, settingsLoaded, accessDenied]);

  const selectedOrder = useMemo(
    () => (selectedOrderId ? orders.find((o) => o.id === selectedOrderId) ?? null : null),
    [orders, selectedOrderId]
  );

  const activeOrderCount = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.status !== 'COMPLETED' && o.status !== 'CANCELLED' && o.status !== 'RETURNED'
      ).length,
    [orders]
  );

  const lowStockCount = useMemo(
    () => inventory.filter((item) => getStockState(item) !== 'ok').length,
    [inventory]
  );

  async function handleSignOut() {
    await signOut(auth);
    setSelectedOrderId(null);
    setEditingOrder(null);
    setPreselectedStockItem(null);
    setOrdersInitialStatus('ALL');
    setActiveView('dashboard');
  }

  function handleNavigate(view: AppView, statusFilter: OrderStatus | 'ALL' = 'ALL') {
    setSelectedOrderId(null);
    setEditingOrder(null);
    setPreselectedStockItem(null);
    setOrdersInitialStatus(statusFilter);
    setActiveView(view);
  }

  function handleOpenNewOrder(stockItem?: InventoryItem) {
    setSelectedOrderId(null);
    setEditingOrder(null);
    setPreselectedStockItem(stockItem ?? null);
    setActiveView('new-order');
  }

  if (!authReady || (user && !settingsLoaded)) {
    return (
      <div className="min-h-screen bg-[#F7F5F0] flex flex-col items-center justify-center p-6">
        <div className="w-11 h-11 rounded-xl overflow-hidden border border-[#E6E2D8] bg-white flex items-center justify-center mb-4">
          <img
            src="/favicon.ico"
            alt="Shishu.clo"
            className="w-7 h-7 object-contain"
            referrerPolicy="no-referrer"
          />
        </div>
        <p className="font-display text-3xl font-semibold tracking-[0.08em] text-[#121211]">
          SHISHU.CLO
        </p>
        <p className="mt-2 text-xs text-[#8C877E]">Loading private studio...</p>
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
      onNavigate={(view) => handleNavigate(view)}
      onOpenNewOrder={() => handleOpenNewOrder()}
      userEmail={user.email ?? ''}
      brandName={settings.brandName}
      activeOrderCount={activeOrderCount}
      lowStockCount={lowStockCount}
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
          orders={orders}
          inventory={inventory}
          settings={settings}
          user={user}
          onCancel={() => setEditingOrder(null)}
          onInventoryCreated={(item) => addToast(`Added ${item.pieceName} to inventory`, 'info')}
          onSuccess={(updated) => {
            setEditingOrder(null);
            addToast(`Saved changes to ${updated?.orderNumber ?? 'order'}`);
          }}
        />
      ) : selectedOrder ? (
        <OrderDetailModal
          order={selectedOrder}
          inventory={inventory}
          settings={settings}
          onClose={() => setSelectedOrderId(null)}
          onEdit={(order) => setEditingOrder(order)}
          onOpenInventory={() => handleNavigate('inventory')}
          onDeleted={(stockRestored, deletedOrderNumber) => {
            const num = deletedOrderNumber || selectedOrder.orderNumber;
            setSelectedOrderId(null);
            addToast(
              stockRestored ? `Deleted ${num} · Stock restored` : `Deleted ${num}`,
              'info'
            );
          }}
          onNotify={(msg) => addToast(msg)}
        />
      ) : activeView === 'new-order' ? (
        <OrderForm
          mode="create"
          orders={orders}
          inventory={inventory}
          preselectedInventoryItem={preselectedStockItem}
          settings={settings}
          user={user}
          onCancel={() => {
            setPreselectedStockItem(null);
            setActiveView('dashboard');
          }}
          onInventoryCreated={(item) => addToast(`Added ${item.pieceName} to inventory`, 'info')}
          onSuccess={(created) => {
            setPreselectedStockItem(null);
            if (created) {
              setOrdersInitialStatus('ALL');
              setActiveView('orders');
              setSelectedOrderId(created.id);
              const stockUpdatesCount =
                'stockUpdates' in created && Array.isArray(created.stockUpdates)
                  ? created.stockUpdates.length
                  : 0;
              const updatedQty =
                'updatedStockQuantity' in created && typeof created.updatedStockQuantity === 'number'
                  ? created.updatedStockQuantity
                  : undefined;
              const pieceLabel =
                'stockPieceLabel' in created && created.stockPieceLabel
                  ? `${created.stockPieceLabel} `
                  : '';
              addToast(
                created.stockDeducted
                  ? stockUpdatesCount > 1
                    ? `Created ${created.orderNumber} · ${stockUpdatesCount} stock pieces updated`
                    : `Created ${created.orderNumber} · ${pieceLabel}stock updated${
                        typeof updatedQty === 'number' ? ` (${updatedQty} left)` : ''
                      }`
                  : `Created order ${created.orderNumber}`
              );
            } else {
              setActiveView('orders');
            }
          }}
        />
      ) : activeView === 'inventory' ? (
        <InventoryPage
          items={inventory}
          orders={orders}
          loading={inventoryLoading}
          settings={settings}
          user={user}
          onCreateOrderFromStock={(item) => handleOpenNewOrder(item)}
          onSelectOrder={(order) => {
            setOrdersInitialStatus('ALL');
            setActiveView('orders');
            setSelectedOrderId(order.id);
          }}
          onNotify={(msg) => addToast(msg)}
        />
      ) : activeView === 'orders' ? (
        <OrdersPage
          orders={orders}
          loading={ordersLoading}
          settings={settings}
          initialStatusFilter={ordersInitialStatus}
          onNewOrder={() => handleOpenNewOrder()}
          onSelectOrder={(order) => setSelectedOrderId(order.id)}
          onNotify={(msg) => addToast(msg)}
        />
      ) : activeView === 'reports' ? (
        <ReportsPage
          orders={orders}
          inventory={inventory}
          settings={settings}
          onNotify={(msg) => addToast(msg)}
        />
      ) : activeView === 'settings' ? (
        <SettingsPage
          settings={settings}
          orders={orders}
          inventory={inventory}
          user={user}
          onSignOut={handleSignOut}
          onNotify={(msg) => addToast(msg)}
        />
      ) : (
        <DashboardPage
          orders={orders}
          inventory={inventory}
          loading={ordersLoading}
          settings={settings}
          onNewOrder={() => handleOpenNewOrder()}
          onOrderFromStock={(item) => handleOpenNewOrder(item)}
          onSelectOrder={(order) => setSelectedOrderId(order.id)}
          onViewAllOrders={(statusFilter) =>
            handleNavigate('orders', statusFilter ?? 'ALL')
          }
          onOpenInventory={() => handleNavigate('inventory')}
          onNotify={(msg) => addToast(msg)}
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
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
