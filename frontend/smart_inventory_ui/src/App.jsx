import { useEffect, useState } from 'react';
import Layout from './components/Layout';
import Login from './pages/auth/Login';
import SignUp from './pages/auth/SignUp';
import TechnicianDashboard from './pages/technician/TechnicianDashboard';
import RepairJobs from './pages/technician/RepairJobs';
import RepairJobDetails from './pages/technician/RepairJobDetails';
import PartsSearch from './pages/technician/PartsSearch';
import TransferRequests from './pages/technician/TransferRequests';
import ManagerDashboard from './pages/manager/ManagerDashboard';
import BranchInventory from './pages/manager/BranchInventory';
import LowStockSettings from './pages/manager/LowStockSettings';
import TransferApprovals from './pages/manager/TransferApprovals';
import DispatchTransfers from './pages/manager/DispatchTransfers';
import ReceiveTransfers from './pages/manager/ReceiveTransfers';
import DailySales from './pages/manager/DailySales';
import ManagerWorkOrders from './pages/manager/ManagerWorkOrders';
import AdminDashboard from './pages/admin/AdminDashboard';
import GlobalInventory from './pages/admin/GlobalInventory';
import Branches from './pages/admin/Branches';
import UsersPermissions from './pages/admin/UsersPermissions';
import Suppliers from './pages/admin/Suppliers';
import PartsCatalog from './pages/admin/PartsCatalog';
import TransferHistory from './pages/admin/TransferHistory';
import StockAudit from './pages/admin/StockAudit';
import SystemSettings from './pages/admin/SystemSettings';
import SalesReport from './pages/admin/SalesReport';
import { InventoryProvider, useInventory } from './data/InventoryContext';
import { api, clearToken, getToken, setToken } from './data/api';

const roleLabels = {
  technician: 'Technician',
  branch_manager: 'Branch Manager',
  head_office_admin: 'Head Office Admin'
};

function Shell({ session, onLogout }) {
  const [page, setPage] = useState('dashboard');
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState(null);
  const role = roleLabels[session.role];
  const props = { setPage, onOpenWorkOrder: id => { setSelectedWorkOrderId(id); setPage('jobdetail'); }, workOrderId: selectedWorkOrderId };
  const content = role === 'Technician' ? {
    dashboard: <TechnicianDashboard {...props} />, jobs: <RepairJobs {...props} />, jobdetail: <RepairJobDetails key={selectedWorkOrderId || 'none'} {...props} />,
    parts: <PartsSearch {...props} />, request: <TransferRequests request {...props} />, transfers: <TransferRequests {...props} />
  }[page] : role === 'Branch Manager' ? {
    dashboard: <ManagerDashboard {...props} />, inventory: <BranchInventory {...props} />, lowstock: <LowStockSettings {...props} />,
    workorders: <ManagerWorkOrders {...props} />, approvals: <TransferApprovals {...props} />, dispatch: <DispatchTransfers {...props} />, receive: <ReceiveTransfers {...props} />, sales: <DailySales {...props} />
  }[page] : {
    dashboard: <AdminDashboard {...props} />, global: <GlobalInventory {...props} />, reports: <SalesReport {...props} />, branches: <Branches {...props} />, users: <UsersPermissions {...props} />,
    suppliers: <Suppliers {...props} />, catalog: <PartsCatalog {...props} />, history: <TransferHistory {...props} />, audit: <StockAudit {...props} />, settings: <SystemSettings {...props} />
  }[page];

  return <InventoryProvider account={session}>
    <InventoryScreen role={role} page={page} setPage={setPage} onLogout={onLogout}>{content}</InventoryScreen>
  </InventoryProvider>;
}

function InventoryScreen({ role, page, setPage, onLogout, children }) {
  const { loading, error, refreshWarning } = useInventory();
  return <Layout role={role} page={page} setPage={setPage} onLogout={onLogout}>
    {loading ? <div className="card" role="status">Loading live system data…</div>
      : error ? <div className="card notice" role="alert">{error}</div>
        : <>{refreshWarning && <div className="notice" role="status">{refreshWarning} Use Refresh or reopen the page to load current data.</div>}{children || <div className="card"><h2>Page not found</h2></div>}</>}
  </Layout>;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [signup, setSignup] = useState(false);
  const [authError, setAuthError] = useState('');
  const [checkingSession, setCheckingSession] = useState(Boolean(getToken()));

  useEffect(() => {
    const handleSessionExpired = event => {
      setSession(null);
      setSignup(false);
      setAuthError(event.detail?.message || 'Your session expired or was revoked. Please sign in again.');
    };
    window.addEventListener('smart-inventory:session-expired', handleSessionExpired);
    if (!getToken()) return () => window.removeEventListener('smart-inventory:session-expired', handleSessionExpired);
    api('/auth/me')
      .then(({ user }) => setSession(user))
      .catch(error => {
        clearToken();
        setAuthError(error.message);
      })
      .finally(() => setCheckingSession(false));
    return () => window.removeEventListener('smart-inventory:session-expired', handleSessionExpired);
  }, []);

  const login = async credentials => {
    setAuthError('');
    try {
      const result = await api('/auth/login', { method: 'POST', body: JSON.stringify(credentials) });
      setToken(result.token);
      setSession(result.user);
      setSignup(false);
    } catch (error) {
      setAuthError(error.message);
    }
  };

  const register = async details => {
    setAuthError('');
    try {
      await api('/auth/register', { method: 'POST', body: JSON.stringify(details) });
      await login({ email: details.email, password: details.password });
    } catch (error) {
      setAuthError(error.message);
    }
  };

  if (checkingSession) return <div className="auth"><div className="authCard">Checking your session…</div></div>;
  if (!session) return signup
    ? <SignUp onBack={() => { setSignup(false); setAuthError(''); }} onCreated={register} error={authError} />
    : <Login onLogin={login} onSignUp={() => { setSignup(true); setAuthError(''); }} error={authError} />;

  return <Shell key={session.id} session={session} onLogout={() => {
    clearToken();
    setSession(null);
    setSignup(false);
  }} />;
}
