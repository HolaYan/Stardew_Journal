/* Crop, pantry and kitchen views. All names/recipes/sprites come from the local
 * game catalog; owned quantities come from saved crop, fishing and animal ledgers. */
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const $ = selector => document.querySelector(selector);
  const sum = counts => Object.values(counts).reduce((total,n)=>total+n,0);
  const safeTexture = value => /^game-assets\/[a-zA-Z0-9_./ -]+\.png$/.test(value||'') ? value : 'game-assets/img/springobjects.png';
  class GardenUI {
    constructor(options) {
      this.options=options;this.model=window.MeadowModel;
      this.catalog=window.GameCatalog || {crops:[],recipes:[],objects:{},ui:{}};
      this.place='field';this.onlyCookable=false;
      this.crops=new Map(this.catalog.crops.map(crop=>[String(crop.id),crop]));
      document.querySelectorAll('[data-place]').forEach(button=>button.addEventListener('click',()=>this.show(button.dataset.place)));
      $('#crop-picker').addEventListener('click',event=>{
        const button=event.target.closest('[data-crop]');if(!button||button.disabled)return;
        $('#task-crop').value=button.dataset.crop;
        $('#crop-picker').querySelectorAll('[data-crop]').forEach(el=>{el.classList.toggle('selected',el===button);el.setAttribute('aria-pressed',String(el===button));});
      });
      $('#kitchen-view').addEventListener('click',event=>{
        const button=event.target.closest('[data-cook]');if(!button||button.disabled)return;
        try {
          const next=this.model.cookRecipe(this.options.getState(),button.dataset.cook,this.catalog);
          const recipe=this.catalog.recipes.find(recipe=>String(recipe.id)===button.dataset.cook);
          this.options.commit(next);
          this.options.toast(`${recipe?.name || '料理'}做好了，已放进冰箱。`);
        }catch(error){this.options.toast(error.message);}
      });
      $('#kitchen-view').addEventListener('change',event=>{if(event.target.id==='only-cookable'){this.onlyCookable=event.target.checked;this.render(this.options.getState());}});
      $('#fridge-view').addEventListener('click',event=>{
        const button=event.target.closest('[data-uncook]');if(!button)return;
        try {this.options.commit(this.model.undoCooking(this.options.getState(),button.dataset.uncook));this.options.toast('料理已还原，原来使用的食材回到了仓库。');}
        catch(error){this.options.toast(error.message);}
      });
      ['#storage-view','#kitchen-view','#fridge-view'].forEach(selector=>$(selector).addEventListener('click',event=>{
        const button=event.target.closest('[data-go]');if(button)this.show(button.dataset.go);
      }));
      this.renderNavIcons();
    }
    object(id) {return this.catalog.objects[String(id)] || this.crops.get(String(id)) || {id,name:`物品 ${id}`,spriteIndex:Number(id)||0};}
    sprite(item, size=32) {
      if(typeof item==='string'||typeof item==='number')item=this.object(item);
      if(!item)return '';
      const width=item.width||16,height=item.height||16,columns=item.columns||item.spriteColumns||24;
      const index=Number(item.spriteIndex)||0,scale=size/width;
      return `<span class="game-sprite" aria-hidden="true" style="width:${size}px;height:${height*scale}px;background-image:url('${safeTexture(item.texture)}');background-size:${columns*size}px auto;background-position:-${index%columns*size}px -${Math.floor(index/columns)*height*scale}px"></span>`;
    }
    renderNavIcons() {
      const ui=this.catalog.ui||{};
      $('#place-field-art').innerHTML=this.sprite(this.catalog.crops[0]||this.object('24'),23);
      $('#place-storage-art').innerHTML=this.sprite(ui.chest||{texture:'game-assets/img/craftables.png',spriteIndex:130,width:16,height:32,columns:8},20);
      $('#place-kitchen-art').innerHTML=this.sprite(this.object('194'),25);
      $('#place-fridge-art').innerHTML=this.sprite(ui.fridge||{texture:'game-assets/img/craftables.png',spriteIndex:216,width:16,height:32,columns:8},19);
    }
    show(place) {
      if(!['field','storage','kitchen','fridge'].includes(place))return;
      this.place=place;
      document.querySelectorAll('[data-place]').forEach(button=>{const active=button.dataset.place===place;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
      ['field','storage','kitchen','fridge'].forEach(key=>{$(`#${key}-view`).hidden=key!==place;});
      this.render(this.options.getState());
      this.options.onPlace?.(place);
    }
    defaultCrop(tier) {
      const preferred={7:'24',30:'190',90:'276'}[tier];
      const match=this.crops.get(preferred);
      return match?.tier===tier?match:this.catalog.crops.find(crop=>crop.tier===tier);
    }
    ensurePlantings(state) {
      state.tasks.forEach(task=>{
        if(task.cropId||task.completed)return;
        task.plantedOn ||= this.model.localDate(new Date(task.createdAt));
        task.cropHorizon=this.model.cropTier(task.due,task.plantedOn);
        task.cropId=this.defaultCrop(task.cropHorizon)?.id || null;
      });
    }
    renderPicker(task=null) {
      const due=$('#task-due').value,plantedOn=task?.plantedOn || this.model.localDate();
      if(!this.model.isValidDate(due))return;
      const tier=task?.completed?task.cropHorizon:this.model.cropTier(due,plantedOn);
      const selected=$('#task-crop').value || task?.cropId;
      const options=task?.completed?[this.crops.get(task.cropId)].filter(Boolean):this.catalog.crops.filter(crop=>crop.tier===tier);
      const chosen=options.find(crop=>crop.id===selected)||options.find(crop=>crop.id===this.defaultCrop(tier)?.id)||options[0];
      $('#task-crop').value=chosen?.id||'';
      $('#task-crop').dataset.tier=String(tier);
      $('#crop-tier-label').textContent={7:'一周田 · 短期作物',30:'月度田 · 慢慢长大',90:'季度田 · 长期与再生作物'}[tier];
      $('#crop-picker').innerHTML=options.length?options.map(crop=>`<button type="button" class="crop-option ${crop.id===chosen?.id?'selected':''}" data-crop="${esc(crop.id)}" aria-pressed="${crop.id===chosen?.id}" ${task?.completed?'disabled':''} title="${esc(crop.name)} · 游戏中 ${crop.growthDays} 天成熟${crop.regrowDays>0?`，每 ${crop.regrowDays} 天再生`:''}">${this.sprite(crop,30)}<span>${esc(crop.name)}</span><small>${crop.growthDays} 天${crop.regrowDays>0?' · 再生':''}</small></button>`).join(''):`<p class="catalog-warning">${task?.completed&&!task.cropId?'这是一件升级前完成的待办，保留原有记录。':'未找到本机作物数据，请重新运行素材导入。'}</p>`;
      $('#crop-picker-help').textContent=task?.completed?'这株作物已经收获，品种保持不变。':'日期决定可种的品种；这里展示游戏原始生长天数。完成待办即可收获 1 份，无须等待游戏天数。';
    }
    taskCrop(task,today) {
      const crop=this.crops.get(task.cropId);if(!crop)return '';
      const elapsed=Math.max(0,this.model.dayDiff(today,task.plantedOn));
      const duration=Math.max(1,this.model.dayDiff(task.due,task.plantedOn));
      const progress=Math.min(1,elapsed/duration);
      const phaseCount=crop.growthPhases?.length || crop.phaseCount || 4;
      const phase=progress>=1?(crop.regrowDays>0?6:phaseCount+1):Math.min(phaseCount,1+Math.floor(progress*phaseCount));
      const row=Number(crop.cropSpriteIndex)||0;
      const label=task.completed?'已收获':progress>=1?'待收获':progress>.35?'生长中':'已播种';
      const sprite=task.completed?this.sprite(crop,30):`<span class="growing-sprite" aria-hidden="true" style="background-position:-${(row%2*128+phase*16)*1.5}px -${Math.floor(row/2)*32*1.5}px"></span>`;
      return `<span class="task-crop" title="${esc(crop.name)} · ${label}" aria-label="${esc(crop.name)}，${label}">${sprite}<span>${esc(crop.name)}</span><small>${label}</small></span>`;
    }
    eligibleRecipes() {
      return this.catalog.recipes.filter(recipe=>this.model.recipeRequirements(recipe,this.catalog).supported);
    }
    canCook(recipe,stock) {return this.model.resolveRecipeIngredients(recipe,this.catalog,stock).canCook;}
    ingredientInfo(ingredient,requirements,stock) {
      const category={fish:{name:'任意鱼',sprite:'128'},egg:{name:'任意蛋',sprite:'176'},milk:{name:'任意奶',sprite:'184'}}[ingredient.kind];
      const ids=category?requirements[`${ingredient.kind}Ids`]:[ingredient.id];
      return {name:category?.name||this.object(ingredient.id).name,sprite:category?.sprite||ingredient.id,
        count:(ids||[]).reduce((n,id)=>n+(stock[id]||0),0),pantry:ingredient.kind==='pantry'};
    }
    render(state) {
      const inventory=this.model.inventory(state),lifetime=this.model.totalGathered(state),fridge=this.model.fridge(state);
      $('#field-total').textContent=state.tasks.filter(task=>!task.completed).length;
      $('#storage-total').textContent=sum(inventory);
      $('#fridge-total').textContent=sum(fridge);
      this.renderStorage(inventory,lifetime);
      this.renderKitchen(inventory);
      this.renderFridge(state,fridge);
    }
    heading(kicker,title,copy,summary='') {return `<div class="place-heading"><div><p class="eyebrow">${kicker}</p><h2>${title}</h2><p>${copy}</p></div>${summary?`<span class="place-summary">${summary}</span>`:''}</div>`;}
    itemCard(id,count,caption='') {
      const item=this.object(id);
      return `<div class="inventory-item ${count?'':'used-up'}"><div class="inventory-slot">${this.sprite(item,42)}<b>${count}</b></div><strong>${esc(item.name)}</strong>${caption?`<small>${esc(caption)}</small>`:''}</div>`;
    }
    renderStorage(stock,lifetime) {
      const ids=Object.keys(lifetime).sort((a,b)=>(stock[b]||0)-(stock[a]||0)||lifetime[b]-lifetime[a]);
      $('#storage-view').innerHTML=this.heading('THE LITTLE THINGS ADD UP','今天的努力，已经入仓。','种下的作物、鱼塘的鱼获、照料动物的产物，都在这里。做过菜的食材，也会保留累计记录。',`累计 ${sum(lifetime)} · 可用 ${sum(stock)}`)+
      (ids.length?`<div class="inventory-grid">${ids.map(id=>this.itemCard(id,stock[id]||0,`累计获得 ${lifetime[id]} 份`)).join('')}</div><div class="room-bottom"><p>数字是目前可用的数量。已做成料理的作物、鱼获和畜产仍计入累计获得。</p><button class="secondary-button" data-go="kitchen">带着收获去厨房 →</button></div>`:`<div class="room-empty">${this.sprite(this.catalog.ui?.chest||{spriteIndex:130,texture:'game-assets/img/craftables.png',columns:8,width:16,height:32},40)}<h3>木箱还空着，春天才刚刚开始。</h3><p>完成待办、去鱼塘钓鱼，或照料小动物，都能为仓库添一份食材。</p><button class="secondary-button" data-go="field">去看看我的作物</button></div>`);
    }
    renderKitchen(stock) {
      const recipes=this.catalog.recipes.slice().sort((a,b)=>Number(this.canCook(b,stock))-Number(this.canCook(a,stock))||Number(this.model.recipeRequirements(b,this.catalog).supported)-Number(this.model.recipeRequirements(a,this.catalog).supported)||a.name.localeCompare(b.name,'zh'));
      const visible=this.onlyCookable?recipes.filter(recipe=>this.canCook(recipe,stock)):recipes;
      const pantry=new Set(this.model.pantryIds||[]),supported=this.eligibleRecipes().length;
      $('#kitchen-view').innerHTML=this.heading('FROM YOUR FARM, WITH LOVE','用收获，做一顿好吃的。','作物、鱼获和畜产都能成为食材。按照游戏原版配方下厨，料理自动放进冰箱。',`${recipes.length} 道食谱 · ${recipes.filter(recipe=>this.canCook(recipe,stock)).length} 道能做`)+
      `<div class="pantry-note"><span>${this.sprite('246',24)}${this.sprite('247',24)}</span><p>厨房常备：${[...pantry].map(id=>esc(this.object(id).name)).join('、')}。<br><small>这些调料不限量，其余食材从仓库扣除。当前有 ${supported} 道菜的食材可以收集。</small></p><label><input type="checkbox" id="only-cookable" ${this.onlyCookable?'checked':''}>只看能做的</label></div>`+
      (visible.length?`<div class="recipe-grid">${visible.map(recipe=>{
        const resolved=this.model.resolveRecipeIngredients(recipe,this.catalog,stock),requirements=resolved.requirements,can=resolved.canCook;
        const reason=resolved.supported?'还需要一些食材':requirements.reason==='pantry-only'?'需使用自己收获的食材':'需要尚未开放的食材';
        return `<article class="recipe-card ${can?'can-cook':''} ${resolved.supported?'':'recipe-unavailable'}"><div class="recipe-title">${this.sprite(recipe,38)}<div><h3>${esc(recipe.name)}</h3><small>原版配方 · 做出 ${recipe.outputCount||1} 份</small></div></div><div class="recipe-ingredients">${requirements.ingredients.map(ingredient=>{
          const info=this.ingredientInfo(ingredient,requirements,stock);
          return `<span class="ingredient ${!info.pantry&&info.count<ingredient.count?'missing':''} ${ingredient.supported?'':'unavailable'}" title="${esc(info.name)}">${this.sprite(info.sprite,19)}<span>${esc(info.name)} ×${ingredient.count}</span><small>${info.pantry?'常备':!ingredient.supported?'来源未开放':`仓库 ${info.count}`}</small></span>`;
        }).join('')}</div><button class="${can?'primary-button':'secondary-button'} cook-button" data-cook="${esc(recipe.id)}" ${can?'':'disabled'}>${can?'开始烹饪 → 冰箱':reason}</button></article>`;
      }).join('')}</div>`:`<div class="room-empty"><h3>${this.onlyCookable?'攒一些食材，再回来下厨。':'还没有读到可用菜谱。'}</h3><p>${this.onlyCookable?'种植收获、鱼塘钓鱼、照料动物，都能带来新食材。取消「只看能做的」可以浏览全部食谱。':'菜谱会从本机游戏中读取。'}</p></div>`)+
      `<p class="room-footnote">展示全部 ${recipes.length} 道游戏原版菜谱。「任意鱼」不包含藻类；「任意蛋」「任意奶」可以使用对应的鸭蛋、羊奶等产物。标注「来源未开放」的食材暂时无法取得，集齐原版配方才可以烹饪。</p>`;
    }
    renderFridge(state,stock) {
      const ids=Object.keys(stock);
      $('#fridge-view').innerHTML=this.heading('A TASTE OF YOUR PROGRESS','把生活的滋味，好好存起来。','每一道料理，都来自亲手收获的作物、鱼获与畜产。',`${sum(stock)} 份料理`)+
      (ids.length?`<div class="inventory-grid fridge-grid">${ids.map(id=>this.itemCard(id,stock[id],'已放入冰箱')).join('')}</div><div class="cooking-history"><h3>最近下厨</h3>${(state.cooking||[]).slice().reverse().map(entry=>`<div class="cooking-entry">${this.sprite(entry.outputId,25)}<div><strong>${esc(this.object(entry.outputId).name)} ×${entry.quantity}</strong><small>${new Date(entry.at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</small></div><button class="text-button" data-uncook="${esc(entry.id)}" title="移除这份料理，并把原来使用的食材退回仓库">还原食材</button></div>`).join('')}</div>`:`<div class="room-empty">${this.sprite(this.catalog.ui?.fridge||{spriteIndex:216,texture:'game-assets/img/craftables.png',columns:8,width:16,height:32},40)}<h3>留一个位置，给下一顿好饭。</h3><p>去厨房，把攒下的食材做成喜欢的料理。</p><button class="secondary-button" data-go="kitchen">去厨房看看</button></div>`);
    }
  }
  window.GardenUI=GardenUI;
})();
