import { useState } from 'react';
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
import AdminDashboard from './pages/admin/AdminDashboard';
import GlobalInventory from './pages/admin/GlobalInventory';
import Branches from './pages/admin/Branches';
import UsersPermissions from './pages/admin/UsersPermissions';
import Suppliers from './pages/admin/Suppliers';
import PartsCatalog from './pages/admin/PartsCatalog';
import TransferHistory from './pages/admin/TransferHistory';
import StockAudit from './pages/admin/StockAudit';
import SystemSettings from './pages/admin/SystemSettings';
import { InventoryProvider } from './data/InventoryContext';

export default function App() {
  const [session, setSession] = useState(null);
  const [page, setPage] = useState('dashboard');
  const [signup, setSignup] = useState(false);
  const role = session?.role;
  const login = r => { setSession({ role: r, isNewAccount: false }); setPage('dashboard'); };
  const createAccount = account => { setSession({ ...account, isNewAccount: true }); setPage('dashboard'); setSignup(false); };
  if (!role) return signup ? <SignUp onBack={() => setSignup(false)} onCreated={createAccount} /> : <Login onLogin={login} onSignUp={() => setSignup(true)} />;

  let content;
  const props = { setPage };
  if (role === 'Technician') content = {
    dashboard: <TechnicianDashboard {...props} />, jobs: <RepairJobs {...props} />, jobdetail: <RepairJobDetails {...props} />,
    parts: <PartsSearch {...props} />, request: <TransferRequests request {...props} />, transfers: <TransferRequests {...props} />
  }[page];
  if (role === 'Branch Manager') content = {
    dashboard: <ManagerDashboard {...props} />, inventory: <BranchInventory {...props} />, lowstock: <LowStockSettings {...props} />,
    approvals: <TransferApprovals {...props} />, dispatch: <DispatchTransfers {...props} />, receive: <ReceiveTransfers {...props} />, sales: <DailySales {...props} />
  }[page];
  if (role === 'Head Office Admin') content = {
    dashboard: <AdminDashboard {...props} />, global: <GlobalInventory {...props} />, branches: <Branches {...props} />, users: <UsersPermissions {...props} />,
    suppliers: <Suppliers {...props} />, catalog: <PartsCatalog {...props} />, history: <TransferHistory {...props} />, audit: <StockAudit {...props} />, settings: <SystemSettings {...props} />
  }[page];

  return <InventoryProvider isNewAccount={session.isNewAccount} account={session}><Layout role={role} page={page} setPage={setPage} onLogout={() => { setSession(null); setSignup(false); }}>{content || <div className="card"><h2>Page not found</h2></div>}</Layout></InventoryProvider>;
}
