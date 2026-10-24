// All arithmetic is integer centavos. These are explicitly sample defense prices.
export const deliveryZones = [
  { id: "koronadal", name: "Koronadal", fee_centavos: 15000 },
  { id: "tupi", name: "Tupi", fee_centavos: 30000 },
  { id: "tantangan", name: "Tantangan", fee_centavos: 25000 },
];
export const bulkTiers = [
  { min_sacks: 25, discount_centavos: 5000 },
  { min_sacks: 10, discount_centavos: 2500 },
];
export function priceOrder(items, method, zoneId = "koronadal") {
  const count = items.reduce((n, i) => n + i.quantity, 0);
  const tier = bulkTiers.find((t) => count >= t.min_sacks);
  const lines = items.map((i) => {
    const original = i.price_centavos ?? Math.round(i.price * 100);
    const discount = Math.min(
      tier?.discount_centavos || 0,
      Math.max(0, original - 100),
    );
    return {
      ...i,
      original_price_centavos: original,
      unit_price_centavos: original - discount,
      price: (original - discount) / 100,
    };
  });
  const subtotal = lines.reduce(
    (s, i) => s + i.original_price_centavos * i.quantity,
    0,
  );
  const discount = lines.reduce(
    (s, i) =>
      s + (i.original_price_centavos - i.unit_price_centavos) * i.quantity,
    0,
  );
  const zone =
    method === "delivery" ? deliveryZones.find((z) => z.id === zoneId) : null;
  if (method === "delivery" && !zone)
    throw Object.assign(Error("Choose a supported delivery zone."), {
      status: 400,
    });
  const fee = zone?.fee_centavos || 0;
  return {
    lines,
    sacks: count,
    subtotal_centavos: subtotal,
    discount_centavos: discount,
    delivery_fee_centavos: fee,
    total_centavos: subtotal - discount + fee,
    delivery_zone: zone?.id || "",
    discount_per_sack_centavos: tier?.discount_centavos || 0,
  };
}
