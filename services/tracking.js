import { db } from '../db.js';
export function mapConfig() {
  const key = process.env.MAPTILER_KEY;
  return {
    center: [6.5004,124.8451],
    tiles: key ? `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}` : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: key ? '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  };
}
export function cleanupTracking() {
  db.prepare("DELETE FROM driver_access WHERE expires<=? OR order_id IN (SELECT id FROM orders WHERE status IN ('Completed','Cancelled'))").run(Date.now());
  db.prepare('DELETE FROM driver_locations WHERE updated<? OR order_id NOT IN (SELECT order_id FROM driver_access)').run(Date.now()-86400000);
}
export function trackingDTO(order) {
  const active = order.method==='delivery' && order.status==='Out for delivery';
  const location = active ? db.prepare('SELECT l.* FROM driver_locations l JOIN driver_access a ON a.order_id=l.order_id WHERE l.order_id=? AND a.expires>?').get(order.id,Date.now()) : null;
  const stale = !location || Date.now()-location.updated>90000;
  return {demo:false,available:order.method==='delivery',status:order.status,
    source:'device-gps',sharing:active && Boolean(location),stale,
    position:location ? [location.latitude,location.longitude] : null,
    accuracy:location?.accuracy ?? null,updated:location ? new Date(location.updated).toISOString() : null,
    observed:location ? new Date(location.observed).toISOString() : null,
    note:!active ? 'Location sharing is available only while Out for delivery.' : !location ? 'Waiting for the driver to start location sharing.' : stale ? 'Last location is stale; the driver may be offline.' : 'Latest location received from the driver device.'};
}
