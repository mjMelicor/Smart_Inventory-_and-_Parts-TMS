export const moneyCents = amount => Math.round(Number(amount) * 100);

export function dailySalesTotals(sales) {
  const totals = sales.reduce((sum, sale) => ({
    repairBillings: sum.repairBillings + moneyCents(sale.total),
    partsRevenue: sum.partsRevenue + moneyCents(sale.partsTotal),
    laborRevenue: sum.laborRevenue + moneyCents(sale.laborFee)
  }), { repairBillings: 0, partsRevenue: 0, laborRevenue: 0 });

  return Object.fromEntries(Object.entries(totals).map(([key, cents]) => [key, cents / 100]));
}
