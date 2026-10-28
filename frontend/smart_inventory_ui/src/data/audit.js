export function mapAuditEntry(row, { parts, branches, transfers }) {
  const details = row.details?.details || row.details || {};
  const isDispatch = details.action === 'STOCK_DISPATCHED';
  const previousInventory = row.details?.old;
  const nextInventory = row.details?.new;
  const partId = isDispatch
    ? previousInventory?.part_id ?? nextInventory?.part_id
    : details.partId;
  const transfer = isDispatch
    ? transfers.find(item => String(item.id) === String(details.transferId))
    : null;
  const destination = transfer
    ? branches.find(branch => branch.id === transfer.destinationBranchId)?.name
      || transfer.destinationBranch?.name
      || ''
    : '';
  const quantity = isDispatch && previousInventory && nextInventory
    ? Number(nextInventory.quantity_on_hand) - Number(previousInventory.quantity_on_hand)
    : details.quantity ?? details.quantityChange ?? '';

  return {
    ...row,
    action: details.action || `${row.tableName}_${row.operation}`,
    part: details.partName || parts.find(part => part.id === String(partId))?.name || partId || '',
    qty: quantity,
    from: row.branch || '',
    to: destination,
    user: row.user || 'System',
    time: row.timestamp
  };
}
