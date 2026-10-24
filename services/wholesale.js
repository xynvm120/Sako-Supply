import { db, transaction } from '../db.js';
import { fail, now } from './common.js';
export const storeSettings=()=>db.prepare('SELECT min_sacks,reservation_minutes,slot_capacity FROM store_settings WHERE id=1').get();
export function deliverySlots() {
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Manila'});
  const base=new Date(today+'T00:00:00Z');
  const capacity=storeSettings().slot_capacity, result=[];
  for(let i=1;i<=14;i++) {
    const date=new Date(+base+i*86400000).toISOString().slice(0,10);
    for(const slot of ['09:00–12:00','13:00–17:00']) {
      const used=db.prepare("SELECT count(*) n FROM orders WHERE delivery_date=? AND delivery_slot=? AND status<>'Cancelled'").get(date,slot).n;
      result.push({value:date+'|'+slot,date,slot,remaining:Math.max(0,capacity-used)});
    }
  }
  return result;
}
export function validateSchedule(value) {
  const slots=deliverySlots();
  const slot=value ? slots.find(s=>s.value===value) : slots.find(s=>s.remaining>0); // Older API clients receive the next available slot.
  if(!slot || slot.remaining<1) throw fail(400,'That delivery slot is unavailable. Choose another date/time.');
  return slot;
}
export function expireReservations() {
  transaction(()=>{
    const orders=db.prepare("SELECT id,user_id FROM orders WHERE status='Pending' AND payment_status='Unpaid' AND reservation_until IS NOT NULL AND reservation_until<=?").all(Date.now());
    for(const order of orders) {
      for(const item of db.prepare('SELECT product_id,quantity FROM order_items WHERE order_id=?').all(order.id)) {
        db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(item.quantity,item.product_id);
        db.prepare('INSERT INTO stock_movements(product_id,delta,reason,created) VALUES(?,?,?,?)').run(item.product_id,item.quantity,'Reservation expired '+order.id,now());
      }
      db.prepare("UPDATE orders SET status='Cancelled',cancellation_reason='Reservation expired before store acceptance' WHERE id=?").run(order.id);
      db.prepare("INSERT INTO order_events(order_id,status,created) VALUES(?,'Cancelled',?)").run(order.id,now());
      db.prepare('DELETE FROM driver_locations WHERE order_id=?').run(order.id);
      db.prepare('DELETE FROM driver_access WHERE order_id=?').run(order.id);
      if(order.user_id) db.prepare('INSERT INTO notifications(user_id,order_id,message,created) VALUES(?,?,?,?)').run(order.user_id,order.id,'Your unpaid reservation expired before store acceptance. Stock has been released; you may reorder.',now());
    }
  });
}
