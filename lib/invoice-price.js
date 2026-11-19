// The listed invoice price applies to every online payment method. The owner
// can instead apply a lower offline cash/bank price before recording payment.
const cents = items => (items || []).reduce((sum, item) => sum + Math.round((Number(item.amount) || 0) * 100), 0);

export function invoiceAmountCents(invoice) {
  const base = cents(invoice.events) + cents(invoice.lineItems);
  if (!invoice.priceOption?.onlinePriceEnabled || invoice.priceOption.cashDiscountApplied) return base;
  return base > 0 ? Math.ceil((base + 30) / 0.971 - 1e-8) : 0;
}
