/* Daily animal care uses the same original-game inventory as the kitchen. */
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeTexture = value => /^game-assets\/[a-zA-Z0-9_./ -]+\.png$/.test(value || '') ? value : 'game-assets/img/springobjects.png';
  class AnimalsUI {
    constructor(options) {
      this.options=options; this.model=window.MeadowModel; this.catalog=options.catalog||{}; this.house='Coop';
      this.dialog=document.createElement('dialog'); this.dialog.className='animals-dialog'; this.dialog.id='animals-dialog';
      this.dialog.setAttribute('aria-labelledby','animals-title');
      this.dialog.innerHTML='<div class="dialog-heading"><div><p class="eyebrow">A LITTLE CARE, EVERY DAY</p><h2 id="animals-title">畜棚里的小伙伴</h2></div><button type="button" class="icon-button" data-animal-close aria-label="关闭畜棚">×</button></div><p class="animal-intro">添一把草，摸摸脑袋，再把今天的心意收进仓库。</p><nav class="animal-houses" aria-label="选择动物住所"><button type="button" data-animal-house="Coop" aria-pressed="true">鸡舍 · 鸡与鸭</button><button type="button" data-animal-house="Barn" aria-pressed="false">畜棚 · 牛与羊</button></nav><div class="animal-cards"></div><p class="animal-note">每只动物每天可收取 1 份产物，按电脑日期更新。这里采用每日照料节奏，进度会保存在本机。</p><p class="animal-feedback" role="status" aria-live="polite"></p><div class="dialog-actions"><button type="button" class="primary-button" data-animal-close>回到农场</button></div>';
      document.body.append(this.dialog);
      this.dialog.querySelectorAll('[data-animal-close]').forEach(button=>button.addEventListener('click',()=>this.close()));
      this.dialog.addEventListener('click',event=>{
        const houseButton=event.target.closest('[data-animal-house]');
        if(houseButton){this.house=houseButton.dataset.animalHouse;this.dialog.querySelector('.animal-feedback').textContent='';this.refresh();return;}
        const button=event.target.closest('[data-animal-action]'); if(!button||button.disabled)return;
        const animal=this.catalog.animals?.find(item=>item.id===button.dataset.animalId); if(!animal)return;
        try {
          const action=button.dataset.animalAction;
          const next=this.model.careForAnimal(this.options.getState(),animal.id,action,this.catalog);
          this.options.changeState(next); this.refresh();
          const product=this.catalog.objects?.[animal.productId];
          const messages={feed:`给${animal.name}添好了草。`,pet:`${animal.name}开心地蹭了蹭你的手。`,collect:`收到了 ${product?.name||'产物'} ×1，已放入仓库。`};
          this.dialog.querySelector('.animal-feedback').textContent=messages[action];
          this.dialog.querySelector(`[data-animal-id="${animal.id}"]:not(:disabled)`)?.focus({preventScroll:true});
        } catch(error) {this.options.onMessage?.(error.message);this.dialog.querySelector('.animal-feedback').textContent=error.message;}
      });
    }
    sprite(item,size=48) {
      if(!item)return '';
      const width=item.width||16,height=item.height||16,columns=item.columns||Math.floor((item.textureWidth||384)/width);
      const sx=item.sx??(item.spriteIndex%columns*width),sy=item.sy??(Math.floor(item.spriteIndex/columns)*height),scale=size/Math.max(width,height);
      return `<span class="game-sprite" aria-hidden="true" style="width:${width*scale}px;height:${height*scale}px;background-image:url('${safeTexture(item.texture)}');background-size:${(item.textureWidth||384)*scale}px ${(item.textureHeight||1024)*scale}px;background-position:-${sx*scale}px -${sy*scale}px"></span>`;
    }
    refresh() {
      if(!this.dialog.open)return;
      const state=this.options.getState(),today=this.model.localDate(),care=state.animalCare?.[today]||{},stock=this.model.inventory(state);
      const focused=this.dialog.contains(document.activeElement)?document.activeElement?.dataset.animalId:null;
      this.dialog.querySelector('#animals-title').textContent=this.house==='Coop'?'鸡舍里的小伙伴':'畜棚里的小伙伴';
      this.dialog.querySelector('[data-animal-close]').setAttribute('aria-label',this.house==='Coop'?'关闭鸡舍':'关闭畜棚');
      this.dialog.querySelectorAll('[data-animal-house]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.animalHouse===this.house)));
      this.dialog.querySelector('.animal-cards').innerHTML=(this.catalog.animals||[]).filter(animal=>animal.house===this.house).map(animal=>{
        const progress=care[animal.id]||{},product=this.catalog.objects?.[animal.productId];
        const action=progress.collected?'done':!progress.fed?'feed':!progress.petted?'pet':'collect';
        const label={feed:'添一把草',pet:'摸摸脑袋',collect:`收取${product?.name||'产物'}`,done:'今天已收取，明天见'}[action];
        return `<article class="animal-card ${progress.collected?'is-cared':''}"><div class="animal-habitat">${this.sprite(animal,64)}<span class="animal-heart" aria-hidden="true">${progress.petted?'♥':'· · ·'}</span></div><div class="animal-card-heading"><h3>${esc(animal.name)}</h3><span>${this.sprite(product,22)}${esc(product?.name||'产物')}</span></div><ol class="animal-steps" aria-label="今日照料进度"><li class="${progress.fed?'done':''}">${progress.fed?'✓':'1'} 喂食</li><li class="${progress.petted?'done':''}">${progress.petted?'✓':'2'} 抚摸</li><li class="${progress.collected?'done':''}">${progress.collected?'✓':'3'} 收取</li></ol><button type="button" class="${progress.collected?'secondary-button':'primary-button'}" data-animal-id="${esc(animal.id)}" data-animal-action="${action}" ${progress.collected?'disabled':''}>${esc(label)}</button><small>仓库现有 ${stock[animal.productId]||0} 份</small></article>`;
      }).join('');
      if(focused)this.dialog.querySelector(`[data-animal-id="${focused}"]:not(:disabled)`)?.focus({preventScroll:true});
    }
    open(house) {if(house==='Coop'||house==='Barn')this.house=house;this.dialog.querySelector('.animal-feedback').textContent='';if(!this.dialog.open)this.dialog.showModal();this.refresh();}
    close() {if(this.dialog.open)this.dialog.close();}
  }
  window.AnimalsUI=AnimalsUI;
})();
