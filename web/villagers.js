/* Visits use dialogue and portraits imported from the locally installed game. */
(() => {
  'use strict';

  const RANDOM_VISITOR = '__random__';
  let visitNumber = 0;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  class VillagerVisits {
    constructor(container, options = {}) {
      this.container = typeof container === 'string' ? document.querySelector(container) : container;
      if (!this.container) throw new Error('VillagerVisits requires a container.');
      this.options = options;
      this.selection = RANDOM_VISITOR;
      this.currentVillager = null;
      this.currentQuote = null;
      this.events = [];
      this.id = `villager-visit-${++visitNumber}`;
      this.build();
      this.render();
    }

    static mount(container, options) {
      return new VillagerVisits(container, options);
    }

    listen(target, type, listener) {
      target.addEventListener(type, listener);
      this.events.push(() => target.removeEventListener(type, listener));
    }

    build() {
      this.card = element('section', 'villager-visits');
      this.card.setAttribute('aria-labelledby', `${this.id}-heading`);
      const heading = element('div', 'vv-heading');
      const title = element('h2', 'vv-title', '今日来访');
      title.id = `${this.id}-heading`;
      heading.append(title);

      const controls = element('div', 'vv-controls');
      const selectLabel = element('label', 'vv-sr-only', '选择来访村民');
      selectLabel.htmlFor = `${this.id}-select`;
      this.select = element('select', 'vv-select');
      this.select.id = `${this.id}-select`;
      this.next = element('button', 'vv-next');
      this.next.type = 'button';
      const refresh = element('span', 'vv-refresh', '↻');
      refresh.setAttribute('aria-hidden', 'true');
      this.nextLabel = element('span', 'vv-next-label', '再来一位');
      this.next.append(refresh, this.nextLabel);
      controls.append(selectLabel, this.select, this.next);
      heading.append(controls);

      this.conversation = element('div', 'vv-conversation');
      this.conversation.setAttribute('aria-live', 'polite');
      this.conversation.setAttribute('aria-atomic', 'true');
      this.portraitFrame = element('div', 'vv-portrait-frame');
      this.portraitFrame.setAttribute('aria-hidden', 'true');
      this.portrait = element('img', 'vv-portrait');
      this.portrait.alt = '';
      this.portrait.width = 64;
      this.portrait.height = 64;
      this.portraitFrame.append(this.portrait);
      this.copy = element('div', 'vv-copy');
      this.name = element('p', 'vv-name');
      this.quote = element('blockquote', 'vv-quote');
      this.quote.id = `${this.id}-quote`;
      this.copy.append(this.name, this.quote);
      this.conversation.append(this.portraitFrame, this.copy);

      this.more = element('button', 'vv-more', '展开对话');
      this.more.type = 'button';
      this.more.setAttribute('aria-controls', this.quote.id);
      this.more.setAttribute('aria-expanded', 'false');
      this.more.hidden = true;
      this.source = element('small', 'vv-source', '原版游戏对话');
      const foot = element('div', 'vv-foot');
      foot.append(this.more, this.source);
      this.card.append(heading, this.conversation, foot);
      this.container.replaceChildren(this.card);

      this.listen(this.select, 'change', () => {
        this.selection = this.select.value;
        this.visit();
      });
      this.listen(this.next, 'click', () => this.visit());
      this.listen(this.more, 'click', () => {
        const expanded = this.more.getAttribute('aria-expanded') !== 'true';
        this.more.setAttribute('aria-expanded', String(expanded));
        this.more.textContent = expanded ? '收起对话' : '展开对话';
        this.quote.classList.toggle('vv-quote-expanded', expanded);
      });
      this.listen(this.portrait, 'error', () => {
        this.portrait.hidden = true;
        this.portraitFrame.classList.add('vv-portrait-missing');
      });
      if (typeof ResizeObserver === 'function') {
        this.resizeObserver = new ResizeObserver(() => this.updateOverflow());
        this.resizeObserver.observe(this.container);
      } else {
        this.listen(window, 'resize', () => this.updateOverflow());
      }
    }

    render() {
      const catalog = this.options.catalog || window.GameCatalog || {};
      const candidates = this.options.villagers || catalog.villagers || [];
      this.villagers = Array.isArray(candidates) ? candidates.filter(villager =>
        villager && typeof villager.id === 'string' && typeof villager.name === 'string' &&
        Array.isArray(villager.quotes) && villager.quotes.some(quote =>
          quote && typeof quote.text === 'string' && quote.text.trim())
      ) : [];
      const randomOption = element('option', '', '随机来访');
      randomOption.value = RANDOM_VISITOR;
      this.select.replaceChildren(randomOption);
      this.villagers.forEach(villager => {
        const option = element('option', '', villager.name);
        option.value = villager.id;
        this.select.append(option);
      });
      if (!this.villagers.some(villager => villager.id === this.selection)) {
        this.selection = RANDOM_VISITOR;
      }
      this.select.value = this.selection;
      this.select.disabled = !this.villagers.length;
      this.next.disabled = !this.villagers.length;
      this.card.classList.toggle('vv-empty', !this.villagers.length);
      this.visit();
      return this;
    }

    choose(items, previous) {
      const choices = items.length > 1 ? items.filter(item => item !== previous) : items;
      return choices[Math.floor(Math.random() * choices.length)];
    }

    visit() {
      if (!this.villagers.length) {
        this.currentVillager = null;
        this.currentQuote = null;
        this.portraitFrame.hidden = true;
        this.name.textContent = '还没有读取村民对话';
        this.quote.textContent = '导入本机游戏的中文对话后，村民就会来这里坐坐。';
        this.quote.classList.remove('vv-quote-expanded');
        this.more.hidden = true;
        this.source.hidden = true;
        return;
      }
      const random = this.selection === RANDOM_VISITOR;
      const villager = random
        ? this.choose(this.villagers, this.currentVillager)
        : this.villagers.find(candidate => candidate.id === this.selection);
      if (!villager) return;
      const quotes = villager.quotes.filter(quote => quote && typeof quote.text === 'string' && quote.text.trim());
      const quote = this.choose(quotes, this.currentQuote);
      this.currentVillager = villager;
      this.currentQuote = quote;

      this.name.textContent = villager.name;
      this.quote.textContent = quote.text;
      this.quote.classList.remove('vv-quote-expanded');
      this.more.textContent = '展开对话';
      this.more.setAttribute('aria-expanded', 'false');
      this.nextLabel.textContent = random ? '再来一位' : '再聊一句';
      this.next.title = random ? '随机邀请另一位村民' : `听听${villager.name}的另一句对话`;
      this.portraitFrame.hidden = !villager.portrait;
      this.card.classList.toggle('vv-no-portrait', !villager.portrait);
      this.portraitFrame.classList.remove('vv-portrait-missing');
      this.portrait.classList.toggle('vv-portrait-sprite', villager.portraitKind === 'sprite');
      this.portrait.hidden = false;
      if (villager.portrait) this.portrait.src = villager.portrait;
      this.source.hidden = false;
      const source = typeof quote.source === 'string' && quote.source
        ? `${quote.source}${quote.source.endsWith('.xnb') ? '' : '.xnb'}`
        : '原版游戏文本';
      this.source.title = `${villager.name} · ${source} · ${quote.key || ''}`;
      this.updateOverflow();
    }

    updateOverflow() {
      if (!this.currentQuote) return;
      const expanded = this.more.getAttribute('aria-expanded') === 'true';
      this.quote.classList.remove('vv-quote-expanded');
      this.more.hidden = this.quote.scrollHeight <= this.quote.clientHeight + 1;
      this.quote.classList.toggle('vv-quote-expanded', expanded);
    }

    destroy() {
      this.resizeObserver?.disconnect();
      this.events.forEach(unlisten => unlisten());
      this.events.length = 0;
      this.card.remove();
    }
  }

  window.VillagerVisits = VillagerVisits;
})();
