import { useMemo, useState } from 'react';
import { useInventory } from '../data/InventoryContext';
import './Topbar.css';

function getNotifications({ role, account, branches, parts, jobs, transfers, availableStock }) {
  const notifications = [];
  const isAdmin = role === 'Head Office Admin';
  const isManager = role === 'Branch Manager';
  const branchCodes = isAdmin ? branches.map(branch => branch.id) : isManager ? [account.branch].filter(Boolean) : [];

  for (const branchCode of branchCodes) {
    const branchName = branches.find(branch => branch.id === branchCode)?.name || branchCode;
    for (const part of parts) {
      const minimum = Number(part.reorderLevels[branchCode] || 0);
      const available = availableStock(part.id, branchCode);
      if (minimum > 0 && available <= minimum) {
        notifications.push({
          id: `stock-${branchCode}-${part.id}`,
          title: `Low stock: ${part.name}`,
          detail: `${available} available · minimum ${minimum} · ${branchName}`,
          page: isAdmin ? 'global' : 'lowstock'
        });
      }
    }
  }

  const actionableTransfers = transfers.filter(transfer =>
    transfer.status === 'Pending Approval' && (isAdmin || (isManager && transfer.from === account.branch))
  );
  for (const transfer of actionableTransfers) {
    notifications.push({
      id: `transfer-${transfer.id}`,
      title: `Transfer ${transfer.code} needs approval`,
      detail: `${transfer.qty} requested from ${transfer.from} to ${transfer.to}`,
      page: isAdmin ? 'history' : 'approvals'
    });
  }

  if (role === 'Technician') {
    for (const job of jobs.filter(item =>
      item.assignedTechnicianId === String(account.id) && ['Open', 'In Progress'].includes(item.status)
    )) {
      notifications.push({
        id: `work-order-${job.id}`,
        title: `Repair order ${job.number}`,
        detail: `${job.customer} · ${job.status}`,
        page: 'jobs'
      });
    }
    for (const transfer of transfers) {
      notifications.push({
        id: `transfer-update-${transfer.id}`,
        title: `Transfer ${transfer.code}: ${transfer.status}`,
        detail: `${transfer.from} to ${transfer.to}`,
        page: 'transfers'
      });
    }
  }

  return notifications;
}

export default function Topbar({ role, onLogout, setPage }) {
  const { account, branches, parts, jobs, transfers, availableStock } = useInventory();
  const [isOpen, setIsOpen] = useState(false);
  const notifications = useMemo(
    () => getNotifications({ role, account, branches, parts, jobs, transfers, availableStock }),
    [role, account, branches, parts, jobs, transfers, availableStock]
  );

  return <header className="topbar"><div><span className="mobileBrand">SIPT</span><h2>{role} Portal</h2></div><div className="topActions"><div className="notificationMenu">
    <button className="notify" type="button" aria-label="Notifications" aria-expanded={isOpen} aria-controls="notification-panel" onClick={() => setIsOpen(open => !open)}>
      🔔{notifications.length > 0 && <span>{notifications.length > 99 ? '99+' : notifications.length}</span>}
    </button>
    {isOpen && <section className="notificationPanel" id="notification-panel" aria-label="Notifications">
      <div className="notificationPanelHeader"><b>Notifications</b><span>{notifications.length}</span></div>
      {notifications.length === 0
        ? <p className="notificationEmpty">You're all caught up.</p>
        : <ul>{notifications.map(notification => <li key={notification.id}>
          <button type="button" className="notificationItem" onClick={() => { setPage(notification.page); setIsOpen(false); }}>
            <b>{notification.title}</b><small>{notification.detail}</small>
          </button>
        </li>)}</ul>}
    </section>}
  </div><div className="avatar">A</div><button className="textBtn" onClick={onLogout}>Logout</button></div></header>;
}
