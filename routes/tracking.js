import { randomBytes, createHash } from 'node:crypto';
import { db, transaction } from '../db.js';
import { requireAdmin, adminEmail } from '../auth.js';
import { body } from '../services/http.js';
import { fail, str, now } from '../services/common.js';
import { WindowLimiter } from '../services/security.js';
import { cleanupTracking } from '../services/tracking.js';
const hash = value=>createHash('sha256').update(value).digest('hex');
const positions = new WindowLimiter(30,60000);
function driver(req) {
  const token=(req.headers.authorization || '').replace(/^Bearer /,'');
  if (!/^[a-f0-9]{64}$/.test(token)) throw fail(401,'Invalid or expired driver link.');
  const access=db.prepare('SELECT a.*,o.status,o.method FROM driver_access a JOIN orders o ON o.id=a.order_id WHERE a.token_hash=? AND a.expires>?').get(hash(token),Date.now());
  if (!access || access.method!=='delivery' || ['Completed','Cancelled'].includes(access.status)) throw fail(401,'Invalid or expired driver link.');
  return access;
}
export async function trackingRoute({p,method,req,res,send}) {
  if (p==='/api/admin/driver-access' && ['POST','DELETE'].includes(method)) {
    const admin=requireAdmin(req), b=await body(req);
    const order=db.prepare('SELECT * FROM orders WHERE id=?').get(str(b.id));
    if (!order || order.method!=='delivery' || ['Completed','Cancelled'].includes(order.status)) throw fail(400,'Select an active delivery order.');
    cleanupTracking();
    const token=randomBytes(32).toString('hex');
    transaction(()=>{
      db.prepare('DELETE FROM driver_locations WHERE order_id=?').run(order.id);
      db.prepare('DELETE FROM driver_access WHERE order_id=?').run(order.id);
      if (method==='POST') db.prepare('INSERT INTO driver_access(order_id,token_hash,expires) VALUES(?,?,?)').run(order.id,hash(token),Date.now()+43200000);
      db.prepare('INSERT INTO admin_log(actor,action,created) VALUES(?,?,?)').run(admin.actor || adminEmail,`${method==='POST' ? 'Issued' : 'Revoked'} driver access for ${order.id}`,now());
    });
    return send(res,200,method==='POST' ? {path:'/driver#'+token,expires_hours:12} : {ok:true});
  }
  if (p==='/api/driver/session' && method==='GET') {
    const access=driver(req);
    return send(res,200,{order_id:access.order_id,status:access.status,expires:access.expires});
  }
  if (p==='/api/driver/location' && ['POST','DELETE'].includes(method)) {
    const access=driver(req);
    if (method==='DELETE') {
      db.prepare('DELETE FROM driver_locations WHERE order_id=?').run(access.order_id);
      return send(res,200,{ok:true});
    }
    if (access.status!=='Out for delivery') throw fail(409,'Wait for the administrator to set Out for delivery.');
    positions.check(access.order_id);positions.hit(access.order_id);
    const b=await body(req);
    if (!['latitude','longitude','accuracy','observed'].every(k=>typeof b[k]==='number' && Number.isFinite(b[k])) || Math.abs(b.latitude)>90 || Math.abs(b.longitude)>180 || b.accuracy<0 || b.accuracy>100000 || b.observed<Date.now()-60000 || b.observed>Date.now()+30000) throw fail(400,'Invalid or outdated device location.');
    // Recheck after reading the asynchronous request body: a link may have been revoked meanwhile.
    transaction(()=>{
      const current=driver(req);
      if(current.status!=='Out for delivery') throw fail(409,'Delivery is no longer active.');
      db.prepare('INSERT INTO driver_locations(order_id,latitude,longitude,accuracy,observed,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET latitude=excluded.latitude,longitude=excluded.longitude,accuracy=excluded.accuracy,observed=excluded.observed,updated=excluded.updated WHERE excluded.observed>driver_locations.observed').run(access.order_id,b.latitude,b.longitude,b.accuracy,b.observed,Date.now());
    });
    return send(res,200,{ok:true});
  }
  throw fail(405,'Method not allowed.');
}
