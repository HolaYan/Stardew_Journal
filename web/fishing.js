/* A small, local fishing break. Only active casts spend the saved daily budget. */
(() => {
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  class FishingUI {
    constructor(options) {
      this.options=options;this.model=window.MeadowModel;this.catalog=options.catalog||window.GameCatalog||{};
      this.fish=(this.catalog.fish||[]).filter(item=>item.id&&item.name);
      this.phase='idle';this.pressed=false;this.unpaid=0;this.usageDay=null;this.lastFrame=0;this.frame=null;this.lastCatch=null;
      this.createDialog();
      this.onVisibility=()=>{if(document.hidden)this.pause('已经暂停。回来后可以再抛一竿。');};
      this.onBlur=()=>this.pause('已经暂停。回来后可以再抛一竿。');
      this.onPageHide=()=>this.pause();
      document.addEventListener('visibilitychange',this.onVisibility);
      window.addEventListener('blur',this.onBlur);
      window.addEventListener('pagehide',this.onPageHide);
    }
    sprite(item,size=32) {
      if(!item)return '';
      const texture=/^game-assets\/[a-zA-Z0-9_./ -]+\.png$/.test(item.texture||'')?item.texture:'game-assets/img/springobjects.png';
      const width=item.width||16,height=item.height||16,columns=item.columns||item.spriteColumns||24,index=Number(item.spriteIndex)||0,scale=size/width;
      return `<span class="game-sprite" aria-hidden="true" style="width:${size}px;height:${height*scale}px;background-image:url('${texture}');background-size:${columns*size}px auto;background-position:-${index%columns*size}px -${Math.floor(index/columns)*height*scale}px"></span>`;
    }
    createDialog() {
      const dialog=document.createElement('dialog');dialog.id='fishing-dialog';dialog.className='fishing-dialog';dialog.setAttribute('aria-labelledby','fishing-title');
      dialog.innerHTML=`<div class="dialog-heading"><div><p class="eyebrow">A LITTLE BREAK BY THE POND</p><h2 id="fishing-title">去鱼塘坐一会儿</h2></div><button class="icon-button fishing-close" type="button" aria-label="关闭鱼塘">×</button></div>
        <div class="fishing-budget"><div><span>今天还可以玩</span><strong class="fishing-remaining">—</strong></div><p class="fishing-used"></p></div>
        <div class="fishing-pond" aria-hidden="true"><span class="fishing-reeds reeds-left"></span><span class="fishing-reeds reeds-right"></span><i class="fishing-ripple ripple-one"></i><i class="fishing-ripple ripple-two"></i><span class="fishing-bobber"></span><div class="fishing-catch-art"></div><span class="fishing-pond-label">农场鱼塘</span></div>
        <p class="fishing-message" role="status" aria-live="polite">给今天留一点湖边的时间。</p>
        <div class="fishing-reel" hidden><div class="fishing-track" role="img" aria-label="绿色捕捉条和鱼的位置"><span class="fishing-catch-zone"></span><span class="fishing-target"></span></div><div class="fishing-progress-heading"><span>收竿进度</span><span class="fishing-progress-text">20%</span></div><progress class="fishing-progress" max="1" value=".2" aria-label="收竿进度"></progress></div>
        <button class="primary-button fishing-action" type="button">抛竿</button><p class="fishing-instructions">抛竿后等浮漂动起来，再点击收竿。按住按钮或空格让绿条向右，松开向左；让鱼留在绿条里。也可用 ← / → 方向键切换方向。</p>
        <div class="fishing-last" hidden></div>
        <div class="fishing-settings"><label class="field-label" for="fishing-target-select">这次想遇见</label><select id="fishing-target-select"><option value="">随机的湖边惊喜</option>${this.fish.map(item=>`<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}</select><form class="fishing-limit-form"><label class="field-label" for="fishing-daily-limit">每天的钓鱼时间</label><div class="fishing-limit-row"><input id="fishing-daily-limit" type="number" min="0" max="180" step="1" inputmode="numeric" required aria-describedby="fishing-limit-help"><span>分钟</span><button type="submit" class="secondary-button">保存</button></div><p id="fishing-limit-help" class="setting-help">0–180 分钟，0 表示关闭。只计算抛竿到收竿的时间；离开窗口或关闭鱼塘会暂停。每天按电脑日期重新计算，修改上限不会清除今天已用时间。</p></form><p class="form-error fishing-error" role="alert"></p></div>
        <p class="fishing-footnote">鱼获会存进仓库，可以按原版配方下厨。休闲鱼塘包含游戏中的鱼、贝类和藻类，不受原游戏的地点与季节限制。</p>`;
      document.body.append(dialog);this.dialog=dialog;this.refs={};
      ['remaining','used','message','reel','track','catch-zone','target','progress','progress-text','action','catch-art','last','error'].forEach(key=>this.refs[key]=dialog.querySelector(`.fishing-${key}`));
      dialog.querySelector('.fishing-settings').addEventListener('focusin',()=>this.pause('先歇一会儿。设置好后可以再抛一竿。'));
      this.limitInput=dialog.querySelector('#fishing-daily-limit');this.targetSelect=dialog.querySelector('#fishing-target-select');
      dialog.querySelector('.fishing-close').addEventListener('click',()=>this.close());
      dialog.addEventListener('cancel',event=>{event.preventDefault();this.close();});
      dialog.addEventListener('close',()=>this.pause());
      dialog.querySelector('.fishing-limit-form').addEventListener('submit',event=>{event.preventDefault();this.saveLimit();});
      this.refs.action.addEventListener('click',()=>{if(this.phase==='idle')this.cast();else if(this.phase==='bite')this.hook();});
      this.refs.action.addEventListener('pointerdown',event=>{if(this.phase!=='reel')return;event.preventDefault();this.pressed=true;this.refs.action.setPointerCapture?.(event.pointerId);});
      this.refs.action.addEventListener('pointerup',()=>this.pressed=false);
      this.refs.action.addEventListener('pointercancel',()=>this.pressed=false);
      this.refs.action.addEventListener('lostpointercapture',()=>this.pressed=false);
      dialog.addEventListener('keydown',event=>{
        if(this.phase==='reel'&&['ArrowLeft','ArrowRight'].includes(event.code)&&!event.target.matches('input,select,textarea')){event.preventDefault();this.pressed=event.code==='ArrowRight';return;}
        if(event.code!=='Space'||event.target.matches('input,select,textarea')||event.target.closest('.fishing-limit-form')||event.target.classList.contains('fishing-close'))return;
        event.preventDefault();if(event.repeat)return;
        if(this.phase==='idle')this.cast();else if(this.phase==='bite')this.hook();else if(this.phase==='reel')this.pressed=true;
      });
      dialog.addEventListener('keyup',event=>{if(event.code==='Space'&&!event.target.matches('input,select,textarea')){event.preventDefault();this.pressed=false;}});
    }
    formatTime(seconds) {const total=Math.max(0,Math.ceil(seconds));return `${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`;}
    refresh() {
      if(!this.dialog.open)return;
      const state=this.options.getState(),status=this.model.fishingStatus(state);
      this.refs.remaining.textContent=this.formatTime(status.remainingSeconds-(this.usageDay===this.model.localDate()?this.unpaid:0));
      this.refs.used.textContent=`已用 ${this.formatTime(status.usedSeconds)} / ${Math.round(status.limitSeconds/60)} 分钟`;
      if(document.activeElement!==this.limitInput)this.limitInput.value=String(state.fishing?.dailyLimitMinutes??10);
      this.refs.action.disabled=this.phase==='idle'&&(!status.remainingSeconds||!this.fish.length);
      this.targetSelect.disabled=this.phase!=='idle';this.dialog.classList.toggle('fishing-reduced-motion',!!state.settings?.reducedMotion||matchMedia('(prefers-reduced-motion: reduce)').matches);
      if(this.phase==='idle'&&!status.remainingSeconds){this.refs.action.textContent=status.limitSeconds?'今天先到这里':'钓鱼已关闭';}
      else if(this.phase==='idle')this.refs.action.textContent=this.lastCatch?'再抛一竿':'抛竿';
    }
    open() {
      if(!this.dialog.open)this.dialog.showModal();
      const status=this.model.fishingStatus(this.options.getState());
      this.refs.error.textContent='';
      if(!this.fish.length)this.message('鱼塘素材还没有准备好，请重新导入游戏素材。');
      else if(!status.limitSeconds)this.message('钓鱼已关闭。可以在下方设置每天的休息时间。');
      else if(!status.remainingSeconds)this.message('今天的钓鱼时间用完了，明天再来湖边坐坐。');
      this.refresh();
    }
    close() {this.pause();this.dialog.close();}
    message(text) {this.refs.message.textContent=text;}
    commit(next) {this.options.changeState(next);}
    saveLimit() {
      if(!this.limitInput.reportValidity())return;
      const value=Number(this.limitInput.value);
      this.pause();
      try {this.commit(this.model.setFishingLimit(this.options.getState(),value));this.refs.error.textContent='';this.message(value?`每天的钓鱼时间已设为 ${value} 分钟。`:'钓鱼已关闭，设置大于 0 的时间即可重新开启。');this.refresh();}
      catch(error){this.refs.error.textContent=error.message;}
    }
    cast() {
      if(!this.dialog.open||document.hidden||this.phase!=='idle')return;
      const status=this.model.fishingStatus(this.options.getState());if(!status.remainingSeconds||!this.fish.length){this.refresh();return;}
      this.currentFish=this.fish.find(item=>String(item.id)===this.targetSelect.value)||this.fish[Math.floor(Math.random()*this.fish.length)];
      this.phase='waiting';this.waitFor=1.5+Math.random()*2;this.phaseTime=0;this.elapsed=0;this.unpaid=0;this.usageDay=this.model.localDate();this.lastFrame=performance.now();this.pressed=false;
      this.refs['catch-art'].innerHTML='';this.refs.reel.hidden=true;this.dialog.dataset.fishingPhase=this.phase;this.refs.action.textContent='等一等，浮漂快动了…';this.message('鱼钩入水了，留意浮漂。');this.refresh();
      this.frame=requestAnimationFrame(time=>this.tick(time));
    }
    hook() {
      if(this.phase!=='bite')return;
      this.phase='reel';this.phaseTime=0;this.progress=.25;this.zone=.30;this.fishPosition=.48;this.pressed=false;this.seed=Math.random()*Math.PI*2;
      this.refs.reel.hidden=false;this.refs.target.innerHTML=this.sprite(this.currentFish,24);this.refs['catch-art'].innerHTML=this.sprite(this.currentFish,40);
      this.refs.action.textContent='按住 → · 松开 ←';this.message(`咬钩了！让 ${this.currentFish.name} 留在绿条里。`);this.dialog.dataset.fishingPhase=this.phase;this.drawReel();
    }
    spend(force=false) {
      if(this.unpaid<=0)return;
      const seconds=force?Math.ceil(this.unpaid):Math.floor(this.unpaid);if(!seconds)return;this.unpaid=Math.max(0,this.unpaid-seconds);
      try {this.commit(this.model.spendFishingTime(this.options.getState(),seconds,{today:this.usageDay}));}
      catch(error){this.phase='idle';this.refs.error.textContent=error.message;this.refresh();}
    }
    tick(time) {
      this.frame=null;if(this.phase==='idle')return;
      if(document.hidden||!this.dialog.open){this.pause();return;}
      const today=this.model.localDate();
      if(today!==this.usageDay){this.spend(true);this.usageDay=today;this.lastFrame=time;}
      // A delayed callback is never charged as uninterrupted play. Normal
      // background transitions also pause immediately via blur/visibilitychange.
      const raw=Math.max(0,(time-this.lastFrame)/1000);this.lastFrame=time;
      if(raw>1.5){this.pause('已经暂停。回来后可以再抛一竿。');return;}
      const status=this.model.fishingStatus(this.options.getState()),remaining=Math.max(0,status.remainingSeconds-this.unpaid);
      const dt=Math.min(raw,remaining);this.unpaid+=dt;this.phaseTime+=dt;this.elapsed+=dt;
      let outcome=null;
      if(this.phase==='waiting'&&this.phaseTime>=this.waitFor){this.phase='bite';this.phaseTime=0;this.dialog.dataset.fishingPhase=this.phase;this.refs.action.textContent='鱼咬钩了 · 点击收竿！';this.message('浮漂动了！点击收竿，或按一下空格。');}
      else if(this.phase==='bite'&&this.phaseTime>=5){outcome='miss';}
      else if(this.phase==='reel'){
        const reduced=this.dialog.classList.contains('fishing-reduced-motion');
        const speed=reduced ? .31 : .40;this.zone=clamp(this.zone+(this.pressed?1:-1)*speed*dt,.16,.84);
        this.fishPosition=clamp(.50+Math.sin(this.phaseTime*(reduced ? .6 : .9)+this.seed)*.27+Math.sin(this.phaseTime*1.9+this.seed)*.045,.10,.90);
        const aligned=Math.abs(this.zone-this.fishPosition)<.19;this.progress=clamp(this.progress+(aligned ? .235 : -.075)*dt,0,1);
        this.refs.track.classList.toggle('on-target',aligned);this.drawReel();
        if(this.progress>=1)outcome='caught';else if(this.progress<=0||this.phaseTime>=30)outcome='miss';
      }
      if(this.unpaid>=1||outcome||dt>=remaining)this.spend(!!outcome||dt>=remaining);
      if(outcome){this.finish(outcome);return;}
      if(dt>=remaining){this.pause('今天的钓鱼时间用完了，明天再来湖边坐坐。');return;}
      this.refresh();if(this.phase!=='idle')this.frame=requestAnimationFrame(next=>this.tick(next));
    }
    drawReel() {
      this.refs['catch-zone'].style.left=`${this.zone*100}%`;this.refs.target.style.left=`${this.fishPosition*100}%`;
      this.refs.progress.value=this.progress;this.refs['progress-text'].textContent=`${Math.round(this.progress*100)}%`;
      this.refs.track.setAttribute('aria-label',`绿条位置 ${Math.round(this.zone*100)}%，鱼的位置 ${Math.round(this.fishPosition*100)}%`);
    }
    finish(outcome) {
      this.spend(true);this.phase='idle';this.pressed=false;this.refs.reel.hidden=true;this.dialog.dataset.fishingPhase='idle';
      if(outcome==='caught'){
        try {
          this.commit(this.model.catchFish(this.options.getState(),String(this.currentFish.id),this.catalog));this.lastCatch=this.currentFish;
          this.refs['catch-art'].innerHTML=this.sprite(this.lastCatch,48);this.refs.last.hidden=false;
          this.refs.last.innerHTML=`${this.sprite(this.lastCatch,30)}<div><strong>${esc(this.lastCatch.name)} ×1 · 已存入仓库</strong><span>${esc(this.lastCatch.description||'带上今天的鱼获，去厨房看看能做什么。')}</span></div>`;
          this.message(`钓到了 ${this.lastCatch.name}！今天的鱼获已经入仓。`);this.options.onMessage?.(`${this.lastCatch.name} ×1 已存入仓库。`);
        }catch(error){this.message(error.message);}
      }else {this.refs['catch-art'].innerHTML='';this.message('它轻轻游走了。没关系，再试一次。');}
      this.refresh();
    }
    pause(message) {
      if(this.phase==='idle')return;
      if(this.frame!==null)cancelAnimationFrame(this.frame);this.frame=null;
      const tail=(performance.now()-this.lastFrame)/1000;
      if(tail>0&&tail<=1.5){const status=this.model.fishingStatus(this.options.getState(),{today:this.usageDay});this.unpaid+=Math.min(tail,Math.max(0,status.remainingSeconds-this.unpaid));}
      this.spend(true);this.phase='idle';this.pressed=false;this.refs.reel.hidden=true;this.dialog.dataset.fishingPhase='idle';
      this.refs['catch-art'].innerHTML=this.lastCatch?this.sprite(this.lastCatch,48):'';
      if(message)this.message(message);this.refresh();
    }
  }
  window.FishingUI=FishingUI;
})();
