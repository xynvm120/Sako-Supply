const reduceMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
function addTopButton(container, page=false) {
  const button=document.createElement('button');
  button.type='button';button.className='back-to-top';button.textContent='↑ Top';
  button.setAttribute('aria-label',page ? 'Back to top of page' : 'Back to top of dialog');
  button.hidden=true;
  container.append(button);
  const update=()=>{
    button.hidden=(page ? window.scrollY : container.scrollTop)<300 || (page && Boolean(document.querySelector('dialog[open]')));
    if(!page && container.open) {
      const bounds=container.getBoundingClientRect();
      button.style.right=Math.max(18,innerWidth-bounds.right+16)+'px';
      button.style.bottom=Math.max(20,innerHeight-bounds.bottom+16)+'px';
    }
  };
  addEventListener('resize',update,{passive:true});
  (page ? window : container).addEventListener('scroll',update,{passive:true});
  button.onclick=()=>{
    (page ? window : container).scrollTo({top:0,behavior:reduceMotion() ? 'instant' : 'smooth'});
    const heading=page ? document.querySelector('header a, main h1, main a') : container.querySelector('h2');
    if(heading) {if(!heading.matches('a[href],button,input,select,textarea,[tabindex]')) heading.tabIndex=-1; heading.focus({preventScroll:true});}
  };
  new MutationObserver(update).observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
  update();
}
addTopButton(document.body,true);
document.querySelectorAll('dialog').forEach(dialog=>addTopButton(dialog));
