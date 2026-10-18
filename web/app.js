(() => {
  'use strict';
  const M = window.MeadowModel;
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const native = window.__MEADOW_NATIVE__ === true;
  const iconPaths = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    compact: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16M14 10h7"/>',
    pin: '<path d="m9 3 6 0-1 6 4 4v2H6v-2l4-4-1-6ZM12 15v6"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--paper)"/><circle cx="16" cy="17" r="3" fill="var(--paper)"/>',
    star: '<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6-5.4-2.8L6.6 20l1-6-4.4-4.3 6.1-.9Z"/>',
    edit: '<path d="m14 5 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14z"/>',
    sprout: '<path d="M12 21V11M12 15C4 15 3 11 3 7c6 0 9 2 9 8ZM12 11c0-6 3-8 9-8 0 6-3 8-9 8ZM6 22h12"/>',
    plant: '<path d="M12 22V4M12 12c-6 0-8-3-8-7 6 0 8 3 8 7ZM12 17c6 0 8-3 8-7-6 0-8 3-8 7ZM8 22h8"/><path d="M12 7c0-4 2-6 5-6 0 4-2 6-5 6Z"/>',
    wheat: '<path d="M12 23V3M12 9C7 9 6 6 6 3c5 0 6 3 6 6ZM12 14c-5 0-7-3-7-6 5 0 7 3 7 6ZM12 19c-5 0-7-3-7-6 5 0 7 3 7 6ZM12 9c5 0 6-3 6-6-5 0-6 3-6 6ZM12 14c5 0 7-3 7-6-5 0-7 3-7 6ZM12 19c5 0 7-3 7-6-5 0-7 3-7 6Z"/>',
    basket: '<path d="M3 11h18l-3 10H6L3 11ZM7 11l5-8 5 8M2 11h20M9 14v4M15 14v4"/><path d="M14 7c0-4 4-5 6-5 0 4-3 5-6 5Z" fill="#a7b07d"/>',
    flower: '<path d="M12 22V12M12 18c-4 0-5-2-5-4 3 0 5 1 5 4ZM12 20c4 0 5-2 5-4-3 0-5 1-5 4Z"/><path d="M9 5c-2-5 8-5 6 0 5-2 7 6 2 6 0 5-7 6-8 1-5 1-6-7 0-7Z" fill="#d2bc78"/><circle cx="12" cy="8" r="2" fill="#a29b65"/>',
    sunny: '<circle cx="12" cy="12" r="4" fill="#e3c275"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2"/>',
    cloudy: '<path d="M6 18a5 5 0 1 1 1-10 6 6 0 0 1 11 1 4.5 4.5 0 1 1 0 9Z" fill="#d5dcc8"/>',
    rain: '<path d="M5 14a4 4 0 1 1 2-8 5 5 0 0 1 10 0 4 4 0 1 1 1 8Z"/><path d="m7 17-1 3M12 17l-1 3M17 17l-1 3"/>',
    snow: '<path d="M12 2v20M3 7l18 10M3 17 21 7M9 4l3 3 3-3M9 20l3-3 3 3M3 10l4-1-1-4M18 19l-1-4 4-1M3 14l4 1-1 4M18 5l-1 4 4 1"/>',
    windy: '<path d="M3 8h13a3 3 0 1 0-3-3M2 12h17a3 3 0 1 1-3 3M5 17h5a2 2 0 1 1-2 2"/>',
    storm: '<path d="M5 14a4 4 0 1 1 2-8 5 5 0 0 1 10 0 4 4 0 1 1 1 8ZM13 12l-4 6h4l-2 5 6-8h-4Z"/>',
    fog: '<path d="M5 9a4 4 0 1 1 3-6 5 5 0 0 1 9 3h1a4 4 0 0 1 4 3M2 13h20M5 17h14M3 21h17"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.sprout}</svg>`;
  $$('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
  const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const categories = {life:'生活', work:'工作', growth:'成长'};
  let storage;
  let loadError = window.__MEADOW_LOAD_ERROR__ || '';
  let saveBlocked = window.__MEADOW_SAVE_BLOCKED__ === true;
  let unreadableData = window.__MEADOW_UNREADABLE_DATA__ || null;
  let state;
  try { storage = window.localStorage; } catch (_) { loadError = '浏览器未允许本地存储，请导出备份保存计划。'; }
  if (native) {
    if (window.__MEADOW_INITIAL_DATA__ != null) {
      try {state = M.parseBackup(JSON.stringify(window.__MEADOW_INITIAL_DATA__));}
      catch (_) {
        unreadableData = JSON.stringify(window.__MEADOW_INITIAL_DATA__, null, 2);
        saveBlocked = true;
        loadError = '原有数据格式暂不受支持，已停止写入以保留原文件。请先导出备份，再导入有效备份。';
      }
    }
    state ||= M.createState();
  }
  else {
    try {
      const raw = storage?.getItem(M.STORAGE_KEY);
      if (raw) {
        try { state = M.parseBackup(raw); }
        catch (_) {
          // Preserve the exact unreadable data before allowing a fresh start.
          unreadableData = raw;
          try { storage.setItem(`meadow-recovery:${Date.now()}`, raw); }
          catch (_) {saveBlocked = true;}
          loadError = saveBlocked ? '旧数据读取失败，已暂停写入以保留原文件。请先导出备份，再导入有效备份。' : '旧数据读取失败，已保留原始副本。你可以在设置中导入备份。';
        }
      }
    } catch (_) { loadError = '本地存储暂时不可用，请及时导出备份。'; }
    state ||= M.createState();
  }
  if (native && window.__MEADOW_NATIVE_STATE__) Object.assign(state.settings, window.__MEADOW_NATIVE_STATE__);
  let days = 7;
  let category = 'all';
  let today = M.localDate();
  let toastTimer;
  let undoAction = null;
  let liveWeather = null;
  let weatherFailure = false;
  let weatherRequest = 0;
  let cityRequest = 0;
  let farm;
  let garden;
  let fishing;
  let animals;
  let sceneRoom = 'outdoors';
  let plantingFromScene = false;

  function activateFarm(target) {
    if (target.type === 'fishing') {
      fishing?.open();
    } else if (target.type === 'animals') {
      animals?.open(target.house);
    } else if (target.type === 'task') {
      const task = state.tasks.find(item=>item.id===target.taskId);
      if (task) openTask(task);
    } else if (target.type === 'plant') {
      garden?.show('field');openTask();plantingFromScene=true;
    } else if (target.type === 'place') {
      if (target.all) {days=0;category='all';render();}
      garden?.show(target.place);
    }
  }

  function nativeMessage(action, extra = {}) {
    if (!native) return false;
    window.webkit.messageHandlers.meadow.postMessage({action, ...extra});
    return true;
  }
  function saveStatus(ok, pending = false) {
    const el = $('#save-status');
    el.innerHTML = `<span class="status-dot" style="background:${ok?'#a5b58a':'#bd9271'}"></span>${pending?'正在保存…':ok?'待办保存在本机':'保存失败 · 请导出备份'}`;
  }
  function save(recover = false) {
    if (saveBlocked) {saveStatus(false);toast('为保留原始数据，已暂停保存。请先导出备份，再导入有效备份。');return;}
    if (native) {
      saveStatus(true, true);
      try { nativeMessage('save', {data:state, ...(recover?{recover:true}:{})}); }
      catch (_) { saveStatus(false); toast('保存失败，请从设置中导出备份。'); }
    } else {
      const ok = M.saveState(storage, state);
      saveStatus(ok);
      if (!ok) toast('本地存储不可用，请从设置中导出备份。');
    }
  }
  function toast(message, undo = null) {
    clearTimeout(toastTimer);
    $('#toast-message').textContent = message;
    undoAction = undo;
    $('#toast-action').hidden = !undo;
    $('#toast').classList.add('visible');
    toastTimer = setTimeout(() => { $('#toast').classList.remove('visible'); undoAction = null; }, undo ? 7500 : 4500);
  }
  $('#toast-action').addEventListener('click', () => {
    const action = undoAction;
    undoAction = null;
    $('#toast').classList.remove('visible');
    clearTimeout(toastTimer);
    if (action) {try {action();} catch (error) {toast(error.message);}}
  });
  const prettyDate = (date, withWeekday = false) => new Date(`${date}T12:00:00`).toLocaleDateString('zh-CN', {month:'numeric',day:'numeric', ...(withWeekday?{weekday:'short'}:{})});
  function season() {
    if (state.settings.season !== 'auto') return state.settings.season;
    return ['winter','winter','spring','spring','spring','summer','summer','summer','autumn','autumn','autumn','winter'][new Date().getMonth()];
  }
  function landscape() {
    const s = season();
    const labels = {spring:'春',summer:'夏',autumn:'秋',winter:'冬'};
    const poems = {spring:'春日 · 宜种下期待',summer:'夏日 · 宜慢慢生长',autumn:'秋日 · 宜收获小事',winter:'冬日 · 宜好好休息'};
    const names = {sunny:'晴好',cloudy:'多云',rain:'细雨',snow:'落雪',windy:'微风',storm:'雷雨',fog:'薄雾'};
    const automatic = state.settings.weather === 'auto';
    const weather = automatic ? (liveWeather?.weather || (s === 'winter' ? 'snow' : 'sunny')) : state.settings.weather;
    const hour = new Date().getHours();
    const night = automatic && liveWeather ? !liveWeather.isDay : hour < 6 || hour >= 19;
    const options = {season:s, weather, night, tasks:state.tasks, catalog:window.GameCatalog, room:sceneRoom, onActivate:activateFarm, reducedMotion:state.settings.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches};
    $('.landscape').classList.toggle('inside-house',sceneRoom==='kitchen');
    if (!farm && window.FarmScene) farm = new window.FarmScene($('#farm-canvas'), options);
    else farm?.setOptions(options);
    $('#day-number').textContent = new Date().getDate();
    $('#today-label').textContent = prettyDate(today, true);
    $('#season-message').textContent = state.settings.season === 'auto' ? poems[s] : `${labels[s]}景 · 手动季节`;
    $('#season-message').title = state.settings.season === 'auto' ? '季节随电脑日期自动切换（北半球）' : '当前季节为手动风景，可在设置中恢复自动';
    $('#weather-icon').innerHTML = icon(weather);
    $('#weather-label').textContent = `${labels[s]} · ${names[weather]}${automatic && liveWeather ? ` ${liveWeather.temperature}°` : ''}`;
    $('#weather-source').textContent = automatic && liveWeather ? `${state.settings.city.name} · 实时天气` : weatherFailure && automatic ? '天气离线 · 装饰场景' : '装饰天气';
    $('#weather-button').title = automatic && liveWeather ? `实时天气更新于 ${new Date(liveWeather.fetchedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})} · 点击设置` : '当前为装饰天气 · 点击设置城市或风景';
    document.body.dataset.season = s;
  }
  function renderWindow() {
    const compact = native ? window.innerWidth < 620 : state.settings.compact || window.innerWidth < 620;
    document.body.classList.toggle('native', native);
    document.body.classList.toggle('compact', compact);
    $('#compact-button').setAttribute('aria-pressed', String(compact));
    $('#compact-button').title = compact ? '切换为宽窗口 · 也可拖动边缘调整' : '切换为小窗口 · 也可拖动边缘调整';
    $('#pin-button').setAttribute('aria-pressed', String(state.settings.pinned));
    $('#pin-button').title = native ? (state.settings.pinned?'取消窗口置顶':'窗口置顶') : '桌面 App 支持窗口置顶';
  }
  function filteredTasks() {
    const tasks = days ? M.selectTasks(state.tasks, {days,today,showCompleted:state.settings.showCompleted}) : M.sortTasks(state.tasks.filter(task => state.settings.showCompleted || !task.completed), {today});
    return tasks.filter(task => category === 'all' || task.category === category);
  }
  function render() {
    renderWindow();
    [7,30,90].forEach(value => {
      $(`#count-${value}`).textContent = M.selectTasks(state.tasks,{days:value,today}).length;
      const button = $(`[data-days="${value}"]`);
      button.classList.toggle('active', value === days);
      button.setAttribute('aria-pressed', String(value === days));
    });
    $$('.filter').forEach(button => {button.classList.toggle('active', button.dataset.category === category);button.setAttribute('aria-pressed',String(button.dataset.category === category));});
    $('#show-completed').checked = state.settings.showCompleted;
    $('#range-label').textContent = days ? `${prettyDate(today)} — ${prettyDate(M.addDays(today, days-1))} · 含今天与逾期` : '所有日期 · 含 90 天以后的计划';
    $('#all-tasks').textContent = days ? '全部待办 ↗' : '返回下一周 ↙';
    const tasks = filteredTasks();
    const list = $('#task-list');
    if (!tasks.length) {
      const empty = state.tasks.length === 0;
      list.innerHTML = `<div class="empty-state"><div class="empty-plant">${icon('sprout')}</div><h2>${empty?'这片小田，等你播种':'这片小田，暂时很清闲'}</h2><p>${empty?'一个小目标，一件想做的事。<br>从第一颗种子开始吧。':'这个范围里还没有待办。<br>去看看远一点的计划，或者好好休息。'}</p><button data-empty-add>${empty?'＋ 种下第一件小事':'＋ 写下一件想做的事'}</button></div>`;
    } else {
      list.innerHTML = M.groupTasks(tasks,{today}).map(group => `<section class="task-group"><h2 class="task-group-title ${group.key==='overdue'?'overdue':''}">${escape(group.key==='overdue'?'还等着收获 · 已逾期':group.key==='today'?'今天 · 照顾眼前的小事':group.key==='tomorrow'?'明天':prettyDate(group.key,true))}<span>${group.tasks.length}</span></h2>${group.tasks.map(task => {
        const diff = M.dayDiff(task.due,today);
        const dueLabel = diff < 0 ? `逾期 ${-diff} 天` : diff===0?'今天':diff===1?'明天':`${task.due.slice(5,7)}.${task.due.slice(8)}`;
        return `<div class="task-row ${task.completed?'done':''}" data-id="${escape(task.id)}"><button class="task-check" data-toggle="${escape(task.id)}" aria-label="${task.completed?'恢复待办':'完成待办'}：${escape(task.title)}" aria-pressed="${task.completed}">${task.completed?icon('check'):''}</button><button class="task-content" data-edit="${escape(task.id)}" aria-label="编辑：${escape(task.title)}"><span class="task-name">${escape(task.title)}${task.priority==='high'?`<span class="task-priority" title="重要">${icon('star')}</span>`:''}</span><span class="task-meta"><span class="category-tag ${task.category}">${categories[task.category]}</span>${task.note?`<span class="task-note">${escape(task.note)}</span>`:''}</span></button><span class="task-date ${diff<0&&!task.completed?'overdue':''}">${dueLabel}</span>${garden?.taskCrop(task,today)||''}<button class="icon-button task-edit" data-edit="${escape(task.id)}" aria-label="编辑：${escape(task.title)}">${icon('edit')}</button></div>`;
      }).join('')}</section>`).join('');
    }
    renderGarden();
    garden?.render(state);
    animals?.refresh();
    farm?.setOptions({tasks:state.tasks,catalog:window.GameCatalog});
  }
  function renderGarden() {
    const current = new Date(`${today}T12:00:00`);
    const monday = M.addDays(today, -((current.getDay()+6)%7));
    $('#calendar-month').textContent = `${current.getFullYear()} / ${String(current.getMonth()+1).padStart(2,'0')}`;
    $('#week-strip').innerHTML = Array.from({length:7},(_,index) => {
      const date = M.addDays(monday,index);
      const hasTasks = state.tasks.some(task => task.due===date && !task.completed);
      return `<div class="week-day ${date===today?'today':''} ${hasTasks?'has-tasks':''}" title="${escape(prettyDate(date))}${hasTasks?' · 有待办':''}"><span>${'一二三四五六日'[index]}</span><strong>${Number(date.slice(8))}</strong><i></i></div>`;
    }).join('');
    const doneToday = state.tasks.filter(task => task.completed && task.completedAt && M.localDate(new Date(task.completedAt)) === today).length;
    $('#harvest-count').innerHTML = `${doneToday}<span> 件</span>`;
    const total = days ? M.selectTasks(state.tasks,{days,today,showCompleted:true}) : state.tasks;
    const completed = total.filter(task => task.completed).length;
    $('#progress-fill').style.width = `${total.length ? completed/total.length*100 : 0}%`;
    $('#progress-caption').textContent = total.length ? `所选范围已收获 ${completed} / ${total.length} 件 · 一点点，也在前进。` : '每一颗种子，都有自己的节奏。';
  }
  function openTask(task = null) {
    plantingFromScene=false;
    $('#task-id').value = task?.id || '';
    $('#task-title').value = task?.title || '';
    $('#task-due').value = task?.due || M.addDays(today, days === 30 ? 29 : days === 90 ? 89 : 0);
    $('#task-category').value = task?.category || (category==='all'?'life':category);
    $('#task-priority').checked = task?.priority === 'high';
    $('#task-note').value = task?.note || '';
    $('#task-crop').value = task?.cropId || '';
    garden?.renderPicker(task);
    $('#task-error').textContent = '';
    $('#task-dialog-title').textContent = task ? '照顾这颗小种子' : '种下一件小事';
    $('#delete-task').hidden = !task;
    $('#harvest-task').hidden = !task || task.completed;
    $('#task-save').textContent = task ? '保存修改' : '保存这颗种子';
    $('#task-dialog').showModal();
    $('#task-title').focus();
  }
  function toggleTask(id) {
    const index = state.tasks.findIndex(task => task.id === id);
    if (index < 0) return;
    const old = {...state.tasks[index]};
    const oldHarvest = state.harvests.find(event=>event.taskId===id);
    try {state = M.toggleTask(state, id, !old.completed, {catalog:window.GameCatalog});}
    catch (error) {toast(error.message);return;}
    save(); render();
    if (!old.completed) farm?.celebrate();
    const crop = garden?.crops.get(old.cropId);
    toast(old.completed?'这件小事回到田里了':crop?`收获了 1 份${crop.name}，已经放进仓库。`:'收获一件小事，做得真好。', () => {
      const current = state.tasks.find(task=>task.id===id);
      if (old.completed && current?.cropId!==old.cropId) throw new Error('作物已经变更，请先恢复原品种再撤销。');
      const next = M.toggleTask(state, id, old.completed, {catalog:window.GameCatalog});
      if (old.completed) {
        next.tasks = next.tasks.map(task=>task.id===id?{...task,completedAt:old.completedAt}:task);
        if (oldHarvest) next.harvests = next.harvests.map(event=>event.taskId===id?oldHarvest:event);
      }
      state=next;
      save();render();
    });
  }
  $('#task-form').addEventListener('submit', event => {
    event.preventDefault();
    const id = $('#task-id').value;
    const old = state.tasks.find(task => task.id===id);
    const task = M.normalizeTask({...old,title:$('#task-title').value,due:$('#task-due').value,category:$('#task-category').value,note:$('#task-note').value,priority:$('#task-priority').checked?'high':'normal',cropId:old?.completed?old.cropId:$('#task-crop').value||null,plantedOn:old?.plantedOn||today,cropHorizon:old?.completed?old.cropHorizon:Number($('#task-crop').dataset.tier)||M.cropTier($('#task-due').value,old?.plantedOn||today)});
    if (!task) {$('#task-error').textContent = '请写下待办，并选择一个有效日期。';return;}
    if (old) state.tasks[state.tasks.indexOf(old)] = task;
    else state.tasks.push(task);
    const diff = M.dayDiff(task.due,today);
    if (days && diff >= days) days = diff <30 ?30:diff<90?90:0;
    if (category !== 'all' && category !== task.category) category = 'all';
    save();render();garden?.show('field');$('#task-dialog').close();
    if (!old) farm?.celebrate();
    if (plantingFromScene) $('.landscape').scrollIntoView({block:'start',behavior:'smooth'});
    if (event.submitter?.id==='harvest-task') {toggleTask(task.id);return;}
    toast(old?'小种子已经更新':'种下了，期待它慢慢长大。');
  });
  $('#delete-task').addEventListener('click', () => {
    const id = $('#task-id').value;
    const old = state.tasks.find(task => task.id===id);
    if (!old) return;
    state.tasks = state.tasks.filter(task => task.id!==id);
    save();render();$('#task-dialog').close();
    toast('这件待办已移走', () => {if(!state.tasks.some(task=>task.id===id))state.tasks.push(old);save();render();});
  });
  $('#task-list').addEventListener('click', event => {
    const toggle = event.target.closest('[data-toggle]');
    const edit = event.target.closest('[data-edit]');
    if (toggle) toggleTask(toggle.dataset.toggle);
    else if (edit) openTask(state.tasks.find(task=>task.id===edit.dataset.edit));
    else if (event.target.closest('[data-empty-add]')) openTask();
  });
  ['#add-button','#quick-add'].forEach(selector=>$(selector).addEventListener('click',()=>openTask()));
  $$('[data-close]').forEach(button=>button.addEventListener('click',()=>document.getElementById(button.dataset.close).close()));
  function updateCropPicker() {garden?.renderPicker(state.tasks.find(task=>task.id===$('#task-id').value));}
  $('#task-due').addEventListener('change',updateCropPicker);
  $$('[data-offset]').forEach(button=>button.addEventListener('click',()=>{$('#task-due').value=M.addDays(today,Number(button.dataset.offset));updateCropPicker();}));
  $$('[data-days]').forEach(button=>button.addEventListener('click',()=>{days=Number(button.dataset.days);render();}));
  $$('[data-category]').forEach(button=>button.addEventListener('click',()=>{category=button.dataset.category;render();}));
  $('#show-completed').addEventListener('change',event=>{state.settings.showCompleted=event.target.checked;save();render();});
  $('#all-tasks').addEventListener('click',()=>{days=days?0:7;render();});
  $('.brand').addEventListener('click',event=>{event.preventDefault();days=7;category='all';garden?.show('field');render();});
  $('#compact-button').addEventListener('click',()=>{
    const value = native ? window.innerWidth >= 620 : !state.settings.compact;
    if (!nativeMessage('compact',{value})) {state.settings.compact=value;render();save();}
  });
  $('#pin-button').addEventListener('click',()=>{
    if (!nativeMessage('pin',{value:!state.settings.pinned})) toast('在桌面 App 中打开，就可以把农场置顶。');
  });
  window.addEventListener('meadow:native-state',event=>{Object.assign(state.settings,event.detail);render();});
  window.addEventListener('resize',renderWindow);
  window.addEventListener('meadow:saved',()=>saveStatus(true));
  window.addEventListener('meadow:error',event=>{if(event.detail.action==='save')saveStatus(false);toast(event.detail.message);});
  window.addEventListener('meadow:exported',()=>toast('备份已保存，计划有了安心的副本。'));
  window.addEventListener('keydown',event=>{
    if ((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='n') {event.preventDefault();if(!document.querySelector('dialog[open]'))openTask();}
  });

  function populateSettings() {
    $('#season-select').value=state.settings.season;
    $('#weather-select').value=state.settings.weather;
    $('#reduce-motion').checked=state.settings.reducedMotion;
    $('#city-current').textContent=state.settings.city?`当前城市：${state.settings.city.name}`:'尚未设置城市，当前为装饰天气。';
    $('#clear-city').hidden=!state.settings.city;
  }
  function openSettings() {populateSettings();$('#settings-dialog').showModal();}
  $('#settings-button').addEventListener('click',openSettings);
  $('#weather-button').addEventListener('click',openSettings);
  $('#season-select').addEventListener('change',event=>{state.settings.season=event.target.value;save();landscape();});
  $('#weather-select').addEventListener('change',event=>{state.settings.weather=event.target.value;save();landscape();refreshWeather();});
  $('#reduce-motion').addEventListener('change',event=>{state.settings.reducedMotion=event.target.checked;save();landscape();});
  $('#clear-city').addEventListener('click',()=>{state.settings.city=null;liveWeather=null;weatherFailure=false;weatherRequest++;save();populateSettings();landscape();});
  async function fetchJSON(url) {
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(),10000);
    try {const response=await fetch(url,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});if(!response.ok)throw new Error('network');return await response.json();}
    finally {clearTimeout(timeout);}
  }
  async function searchCities() {
    const query=$('#city-search').value.trim();
    if(query.length<2){$('#city-results').textContent='请输入至少两个字符。';return;}
    const sequence=++cityRequest;
    $('#city-search-button').disabled=true;$('#city-results').textContent='正在寻找这个地方…';
    try {
      const data=await fetchJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=zh&format=json`);
      if(sequence!==cityRequest)return;
      const results=(data.results||[]).filter(city=>Number.isFinite(city.latitude)&&Number.isFinite(city.longitude));
      $('#city-results').replaceChildren();
      if(!results.length){$('#city-results').textContent='没有找到，试试城市的英文名。';return;}
      results.forEach(city=>{
        const button=document.createElement('button');
        button.textContent=[city.name,city.admin1,city.country].filter(Boolean).join(' · ');
        button.addEventListener('click',()=>{
          state.settings.city={name:city.name,latitude:city.latitude,longitude:city.longitude};state.settings.weather='auto';
          liveWeather=null;weatherFailure=false;save();populateSettings();$('#city-results').replaceChildren();landscape();refreshWeather();
        });$('#city-results').append(button);
      });
    } catch(_){if(sequence===cityRequest)$('#city-results').textContent='城市查询暂时不可用，稍后再试。装饰天气仍可使用。';}
    finally {if(sequence===cityRequest)$('#city-search-button').disabled=false;}
  }
  $('#city-search-button').addEventListener('click',searchCities);
  $('#city-search').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();searchCities();}});
  function weatherCode(code,wind){
    if(code>=95)return 'storm';
    if([71,73,75,77,85,86].includes(code))return 'snow';
    if(code>=51)return 'rain';
    if([45,48].includes(code))return 'fog';
    if(wind>=30)return 'windy';
    if(code>=2)return 'cloudy';
    return 'sunny';
  }
  async function refreshWeather() {
    const request=++weatherRequest;
    if(state.settings.weather!=='auto'||!state.settings.city){liveWeather=null;weatherFailure=false;landscape();return;}
    const city=state.settings.city;
    try {
      const data=await fetchJSON(`https://api.open-meteo.com/v1/forecast?latitude=${city.latitude}&longitude=${city.longitude}&current=temperature_2m,is_day,weather_code,wind_speed_10m&timezone=auto`);
      if(request!==weatherRequest)return;
      const current=data.current;
      if(!current||!Number.isFinite(current.temperature_2m)||!Number.isFinite(current.weather_code))throw new Error('invalid');
      liveWeather={temperature:Math.round(current.temperature_2m),weather:weatherCode(current.weather_code,current.wind_speed_10m),isDay:current.is_day===1,fetchedAt:Date.now()};weatherFailure=false;
    }catch(_){if(request!==weatherRequest)return;liveWeather=null;weatherFailure=true;}
    landscape();
  }

  function confirmAction(title,copy,label='确认') {
    return new Promise(resolve=>{
      const dialog=$('#confirm-dialog');$('#confirm-title').textContent=title;$('#confirm-copy').textContent=copy;$('#confirm-ok').textContent=label;
      let accepted=false;
      $('#confirm-ok').onclick=()=>{accepted=true;dialog.close();};
      $('#confirm-cancel').onclick=()=>dialog.close();
      dialog.addEventListener('close',()=>resolve(accepted),{once:true});dialog.showModal();
    });
  }
  $('#export-button').addEventListener('click',()=>{
    const data=saveBlocked&&unreadableData?unreadableData:M.exportBackup(state);
    if(nativeMessage('export',{data}))return;
    const blob=new Blob([data],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');
    a.href=url;a.download=`Stardew-Journal-backup-${today}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);toast('已生成备份，请在下载文件夹中查看。');
  });
  $('#import-button').addEventListener('click',()=>{if(!nativeMessage('import'))$('#import-file').click();});
  async function importBackup(text) {
    let imported;
    try {imported=M.parseBackup(text);}catch(error){toast(error.message);return;}
    if(!await confirmAction('把这份计划带回农场？',`备份中有 ${imported.tasks.length} 件待办。导入将替换当前待办、仓库、冰箱、钓鱼时间、动物照料和风景设置，建议先导出当前备份。`,'导入并替换'))return;
    fishing?.close();
    animals?.close();
    const previous=state;
    const previousSaveBlocked=saveBlocked;
    // Window layout remains controlled by the current desktop session.
    imported.settings.compact=state.settings.compact;imported.settings.pinned=state.settings.pinned;
    garden?.ensurePlantings(imported);
    state=imported;saveBlocked=false;liveWeather=null;weatherFailure=false;days=7;category='all';save(true);render();populateSettings();landscape();refreshWeather();
    toast(`已带回 ${state.tasks.length} 件待办`,previousSaveBlocked?null:()=>{state=previous;save();render();populateSettings();refreshWeather();});
  }
  $('#import-file').addEventListener('change',async event=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;
    if(file.size>10*1024*1024){toast('备份文件不能超过 10 MB。');return;}
    try {await importBackup(await file.text());}catch(_){toast('无法读取这个文件，请重试。');}
  });
  window.addEventListener('meadow:import',event=>importBackup(event.detail.text));
  $('#demo-button').addEventListener('click',()=>{
    const examples=[
      {title:'给阳台上的植物浇浇水',offset:0,category:'life',note:'也给自己泡一杯喜欢的茶'},
      {title:'把这周的灵感整理成一页笔记',offset:0,category:'work',priority:'high',note:'不用完美，先写下来'},
      {title:'读完床头那本书的一章',offset:1,category:'growth',note:'睡前留 20 分钟给自己'},
      {title:'去附近的公园，收集一点秋天',offset:4,category:'life',note:'带上相机，慢慢走'},
      {title:'做一次月度复盘',offset:18,category:'growth',note:'记下那些微小的进步'},
      {title:'完成一直想做的小项目',offset:65,category:'work',note:'一点一点来，总会抵达'},
    ];
    const added=[];
    examples.forEach(example=>{
      const title=`${example.title}（示例）`;
      if(!state.tasks.some(task=>task.title===title)){const task=M.normalizeTask({...example,title,due:M.addDays(today,example.offset)});state.tasks.push(task);added.push(task.id);}
    });garden?.ensurePlantings(state);save();render();$('#settings-dialog').close();
    toast(added.length?'几颗示例种子，已放进小田':'这些示例种子已经在小田里了',added.length?()=>{state.tasks=state.tasks.filter(task=>!added.includes(task.id));save();render();}:null);
  });
  function updateClock() {const current=M.localDate();if(current!==today){today=current;render();}landscape();}
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){updateClock();if(!liveWeather||Date.now()-liveWeather.fetchedAt>30*60*1000)refreshWeather();}});
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',landscape);
  setInterval(updateClock,60000);
  setInterval(()=>{if(!document.hidden)refreshWeather();},30*60*1000);
  if (window.GardenUI) {
    garden = new window.GardenUI({getState:()=>state,commit:next=>{state=next;save();render();},toast,onPlace:place=>{
      if (place==='kitchen'||place==='fridge') sceneRoom='kitchen';
      else if(place==='field') sceneRoom='outdoors';
      landscape();
    }});
    garden.ensurePlantings(state);
  }
  if (window.FishingUI) {
    fishing = new window.FishingUI({getState:()=>state,catalog:window.GameCatalog,onMessage:toast,changeState:next=>{
      if (saveBlocked) throw new Error('本机数据暂时无法保存，请先导出备份或恢复存档。');
      const caught = (next.fishing?.catches?.length||0) !== (state.fishing?.catches?.length||0);
      state=next;save();if(caught){render();farm?.celebrate();}
    }});
  }
  if (window.AnimalsUI) animals = new window.AnimalsUI({getState:()=>state,catalog:window.GameCatalog,onMessage:toast,changeState:next=>{
    if (saveBlocked) throw new Error('本机数据暂时无法保存，请先导出备份或恢复存档。');
    state=next;save();render();
  }});
  $('#fishing-button').addEventListener('click',()=>fishing?.open());
  $('#animals-button').addEventListener('click',()=>animals?.open());
  if (window.VillagerVisits) window.VillagerVisits.mount('#villager-visit');
  render();landscape();refreshWeather();
  if(loadError){saveStatus(false);setTimeout(()=>toast(loadError),300);}
})();
