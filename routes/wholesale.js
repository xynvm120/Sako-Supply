import { db,transaction } from '../db.js';
import { requireAdmin,requireCustomer,adminEmail } from '../auth.js';
import { body } from '../services/http.js';
import { fail,str,now } from '../services/common.js';
import { storeSettings,deliverySlots } from '../services/wholesale.js';
export async function wholesaleRoute({p,method,req,res,send}) {
  if(p==='/api/delivery-slots' && method==='GET') return send(res,200,deliverySlots());
  if(p==='/api/admin/store-settings') {
    const admin=requireAdmin(req);
    if(method==='GET') return send(res,200,storeSettings());
    if(method==='PATCH') {
      const b=await body(req);
      if(!Number.isInteger(b.min_sacks)||b.min_sacks<1||b.min_sacks>1000||!Number.isInteger(b.reservation_minutes)||b.reservation_minutes<5||b.reservation_minutes>1440||!Number.isInteger(b.slot_capacity)||b.slot_capacity<1||b.slot_capacity>100) throw fail(400,'Use minimum sacks 1–1000, reservation minutes 5–1440, and slot capacity 1–100.');
      transaction(()=>{
        db.prepare('UPDATE store_settings SET min_sacks=?,reservation_minutes=?,slot_capacity=? WHERE id=1').run(b.min_sacks,b.reservation_minutes,b.slot_capacity);
        db.prepare('INSERT INTO admin_log(actor,action,created) VALUES(?,?,?)').run(admin.actor||adminEmail,'Updated wholesale settings',now());
      });
      return send(res,200,storeSettings());
    }
  }
  if(p==='/api/admin/feedback' && method==='GET') {
    requireAdmin(req);
    return send(res,200,db.prepare('SELECT f.*,u.name FROM order_feedback f JOIN users u ON u.id=f.user_id ORDER BY f.updated DESC LIMIT 200').all());
  }
  if(/^\/api\/orders\/[^/]+\/(feedback|confirm-delivery)$/.test(p) && method==='POST') {
    const customer=requireCustomer(req),b=await body(req),id=p.split('/')[3];
    transaction(()=>{
      const o=db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(id,customer.user_id);
      if(!o) throw fail(404,'Order not found.');
      if(p.endsWith('/feedback')) {
        if(o.status!=='Completed') throw fail(400,'Feedback is available after the order is completed.');
        if(!Number.isInteger(b.rating)||b.rating<1||b.rating>5||typeof b.comment!=='string'||b.comment.length>1000) throw fail(400,'Choose 1–5 stars and a comment up to 1000 characters.');
        db.prepare('INSERT INTO order_feedback(order_id,user_id,rating,comment,updated) VALUES(?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET rating=excluded.rating,comment=excluded.comment,updated=excluded.updated').run(id,customer.user_id,b.rating,str(b.comment,1000),now());
      } else {
        const proof=db.prepare('SELECT * FROM delivery_proofs WHERE order_id=?').get(id);
        if(!proof||!['Out for delivery','Completed'].includes(o.status)||b.confirmed!==true) throw fail(400,'A delivery acknowledgment and your confirmation are required.');
        db.prepare('UPDATE delivery_proofs SET customer_confirmed=COALESCE(customer_confirmed,?) WHERE order_id=?').run(now(),id);
      }
    });
    return send(res,200,{ok:true});
  }
  throw fail(405,'Method not allowed.');
}
