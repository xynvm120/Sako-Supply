const token=location.hash.slice(1);
history.replaceState(null,'',location.pathname);
const $=s=>document.querySelector(s);
let watch=null, active=false, stopping=false, permitted=false, pending=Promise.resolve(), lastSent=0, lastObserved=0;
async function api(path,method='GET',body,keepalive=false) {
  const response=await fetch(path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body ? JSON.stringify(body) : undefined,cache:'no-store',keepalive});
  const data=await response.json();
  if(!response.ok) throw Object.assign(Error(data.error || 'Unable to contact server.'),{status:response.status});
  return data;
}
function controls() {
  $('#driver-start').disabled=!permitted || active || stopping || !$('#driver-consent').checked;
  $('#driver-stop').disabled=!active;
}
async function stop(message='Location sharing stopped.',keepalive=false) {
  stopping=true;active=false;
  if(watch!==null) navigator.geolocation.clearWatch(watch);
  watch=null;controls();
  $('#driver-status').textContent=message;
  $('#driver-fix').textContent='';
  try { await pending; await api('/api/driver/location','DELETE',undefined,keepalive); }
  catch { $('#driver-status').textContent=message+' The last server fix may remain visible as stale until connectivity returns or access expires.'; }
  finally { stopping=false;controls(); }
}
async function check() {
  try {
    const session=await api('/api/driver/session');
    permitted=session.status==='Out for delivery';
    $('#driver-order').textContent=`Order ${session.order_id} · ${session.status}`;
    if(!permitted && active) await stop('Delivery is no longer active. Sharing stopped.');
    if(!permitted) $('#driver-status').textContent='Waiting for the administrator to set Out for delivery.';
  } catch(e) {
    permitted=false;
    if(active) await stop('Driver access is unavailable. Sharing stopped.');
    $('#driver-order').textContent=e.message;
  }
  controls();
}
$('#driver-consent').onchange=()=>{
  if(!$('#driver-consent').checked && active) void stop();
  controls();
};
$('#driver-stop').onclick=()=>stop();
$('#driver-start').onclick=async()=>{
  if(!permitted || active || stopping || !$('#driver-consent').checked) return;
  if(!window.isSecureContext || !navigator.geolocation) {
    $('#driver-status').textContent='Location sharing needs HTTPS (or localhost on this computer) and a browser with location support.';return;
  }
  active=true;lastSent=0;lastObserved=0;controls();
  $('#driver-status').textContent='Waiting for device GPS. Allow location access when prompted.';
  watch=navigator.geolocation.watchPosition(position=>{
    if(!active || Date.now()-lastSent<5000 || position.timestamp<=lastObserved) return;
    lastSent=Date.now();lastObserved=position.timestamp;
    const fix={latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy,observed:position.timestamp};
    pending=pending.then(async()=>{
      if(!active) return;
      try {
        await api('/api/driver/location','POST',fix);
        if(active) {
          $('#driver-status').textContent='Sharing location with the assigned customer and administrator.';
          $('#driver-fix').textContent=`Last sent ${new Date().toLocaleTimeString()} · accuracy approximately ${Math.round(fix.accuracy)} m`;
        }
      } catch(e) {
        if([401,409].includes(e.status)) { active=false;if(watch!==null) navigator.geolocation.clearWatch(watch);watch=null;permitted=false;controls(); }
        $('#driver-status').textContent=e.message+' No updated location was confirmed.';
      }
    });
  },error=>{
    void stop(error.code===1 ? 'Location permission denied. Allow access in browser settings and try again.' : 'Device location unavailable. Move to an open area, check location settings and try again.');
  },{enableHighAccuracy:true,maximumAge:0,timeout:20000});
};
document.addEventListener('visibilitychange',()=>{if(document.hidden && active) void stop('Page hidden. Sharing stopped; return and press Start to resume.',true);});
addEventListener('pagehide',()=>{if(active) void stop('Sharing stopped.',true);});
if(!/^[a-f0-9]{64}$/.test(token)) $('#driver-order').textContent='Open the complete private link issued by your administrator.';
else { void check();setInterval(check,10000); }
