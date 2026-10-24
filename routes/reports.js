export function reportsRoute({ db, url, res, send, orderDTO, fail, csvCell }) {
  const from = url.searchParams.get("from") || "2000-01-01",
    to = url.searchParams.get("to") || "2100-01-01";
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
    from > to
  )
    throw fail(400, "Select a valid date range.");
  const list = db
    .prepare(
      "SELECT * FROM orders WHERE status='Completed' AND date(created,'+8 hours') BETWEEN ? AND ? ORDER BY created DESC",
    )
    .all(from, to)
    .map(orderDTO);
  const byProduct = new Map();
  for (const o of list)
    for (const i of o.items) {
      const key = i.id;
      const v = byProduct.get(key) || {
        name: i.name,
        sacks: 0,
        sales: 0,
      };
      v.sacks += i.quantity;
      v.sales += i.quantity * i.price;
      byProduct.set(key, v);
    }
  const collections = db
    .prepare(
      "SELECT c.*,o.customer FROM collections c JOIN orders o ON o.id=c.order_id WHERE date(c.created,'+8 hours') BETWEEN ? AND ? ORDER BY c.created DESC",
    )
    .all(from, to);
  const summary = {
    collections,
    collectedCash: collections.reduce((n, c) => n + c.amount_centavos, 0) / 100,
    orders: list,
    total:
      list.reduce(
        (s, o) => s + (o.total_centavos ?? Math.round(o.total * 100)),
        0,
      ) / 100,
    deliveryFees: list.reduce((s, o) => s + o.delivery_fee, 0),
    bestSellers: [...byProduct.values()].sort((a, b) => b.sacks - a.sacks),
  };
  if (url.searchParams.get("format") === "csv") {
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="sako-sales.csv"',
      "Cache-Control": "no-store",
    });
    return res.end(
      "\uFEFF" +
        [
          [
            "Order",
            "Date (UTC)",
            "Customer",
            "Payment status",
            "Total PHP",
            "Delivery PHP",
          ],
          ...list.map((o) => [
            o.id,
            o.created,
            o.customer,
            o.payment_status,
            o.total,
            o.delivery_fee,
          ]),
        ]
          .map((row) => row.map(csvCell).join(","))
          .join("\r\n"),
    );
  }
  return send(res, 200, summary);
}
