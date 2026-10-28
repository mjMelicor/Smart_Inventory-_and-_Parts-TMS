export const localDate = date => {
  const fields = Object.fromEntries(new Intl.DateTimeFormat('en', {
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
};

export function partsUsedOnDate(jobs, dateKey = localDate(new Date())) {
  const countedItems = new Set();
  return jobs.reduce((total, job) => total + job.items.reduce((jobTotal, item) => {
    if (!item.addedAt) return jobTotal;
    const addedAt = new Date(item.addedAt);
    if (Number.isNaN(addedAt.getTime()) || localDate(addedAt) !== dateKey) return jobTotal;
    if (item.id != null && countedItems.has(String(item.id))) return jobTotal;
    if (item.id != null) countedItems.add(String(item.id));
    const quantity = Number(item.quantityUsed);
    return Number.isFinite(quantity) && quantity > 0 ? jobTotal + quantity : jobTotal;
  }, 0), 0);
}
