// plugins/smart_collections_plus.js
(function(){
    // Ждём полной загрузки Lampa
    if(typeof Lampa === 'undefined') {
        document.addEventListener('lampa:ready', init);
        return;
    }
    init();

    function init() {
        // Константы
        const STORAGE_KEY = 'smart_collections_plus';
        const TIMESTAMP_KEY = 'smart_timestamps';
        
        // ==================== 1. ОСНОВНОЕ ХРАНИЛИЩЕ ====================
        const Core = {
            categories: ['fav', 'watching', 'planned', 'watched', 'dropped', 'collection'],
            priority: ['watching', 'planned', 'fav', 'watched', 'dropped', 'collection'],
            data: null,
            
            load() {
                const saved = Lampa.Storage.get(STORAGE_KEY, null);
                if(saved && saved.data) {
                    this.data = saved.data;
                } else {
                    this.reset();
                }
            },
            
            reset() {
                this.data = {};
                this.categories.forEach(cat => this.data[cat] = []);
                this.save();
            },
            
            save() {
                Lampa.Storage.set(STORAGE_KEY, { data: this.data });
                Lampa.Listener.send('smart_collections_update');
            },
            
            add(category, item) {
                if(!this.data[category]) return false;
                if(this.data[category].find(i => i.id === item.id)) return false;
                
                // Приоритетные правила
                if(category === 'watched') {
                    this.remove('watching', item);
                    this.remove('planned', item);
                } else if(category === 'watching') {
                    this.remove('planned', item);
                } else if(category === 'dropped') {
                    this.categories.forEach(cat => {
                        if(cat !== 'collection') this.remove(cat, item);
                    });
                    this.add('collection', item);
                    this.save();
                    return true;
                }
                
                this.data[category].push({ 
                    id: item.id, 
                    title: item.title || item.name,
                    added: Date.now(),
                    poster: item.poster_path ? Lampa.Api.img(item.poster_path, 'w200') : null
                });
                this.save();
                
                Lampa.Noty.show(`Добавлено в "${this.getCategoryName(category)}"`, { time: 1500 });
                return true;
            },
            
            remove(category, item) {
                if(!this.data[category]) return false;
                const index = this.data[category].findIndex(i => i.id === item.id);
                if(index === -1) return false;
                this.data[category].splice(index, 1);
                this.save();
                return true;
            },
            
            toggle(category, item) {
                if(this.is(category, item)) {
                    this.remove(category, item);
                    Lampa.Noty.show(`Удалено из "${this.getCategoryName(category)}"`, { time: 1500 });
                } else {
                    this.add(category, item);
                }
            },
            
            is(category, item) {
                return this.data[category] && this.data[category].some(i => i.id === item.id);
            },
            
            getStatus(item) {
                for(const cat of this.priority) {
                    if(this.is(cat, item)) return cat;
                }
                return null;
            },
            
            getCategoryName(cat) {
                const names = {
                    fav: '⭐ Избранное',
                    watching: '👁️ Смотрю',
                    planned: '📋 Планы',
                    watched: '✅ Просмотрено',
                    dropped: '❌ Брошено',
                    collection: '📦 Коллекция'
                };
                return names[cat] || cat;
            },
            
            clearAll(item) {
                this.categories.forEach(cat => this.remove(cat, item));
                // Очистка таймкодов
                const tvKey = `${item.id}_tv`;
                const movieKey = `${item.id}_movie`;
                Lampa.Storage.remove(TIMESTAMP_KEY, movieKey);
                Lampa.Storage.remove(TIMESTAMP_KEY, tvKey);
                Lampa.Noty.show('Данные очищены', { time: 1500 });
            }
        };
        
        // ==================== 2. ТАЙМКОДЫ ====================
        const TimeKeeper = {
            load() {
                this.data = Lampa.Storage.get(TIMESTAMP_KEY, {});
            },
            
            save() {
                Lampa.Storage.set(TIMESTAMP_KEY, this.data);
            },
            
            set(id, type, progress, duration, season = null, episode = null) {
                const key = type === 'tv' ? `${id}_tv_s${season}_e${episode}` : `${id}_movie`;
                const percent = duration > 0 ? Math.round((progress / duration) * 100) : 0;
                
                this.data[key] = {
                    id, type, progress, duration, percent,
                    season, episode,
                    updated: Date.now()
                };
                this.save();
                
                // Автоматические правила
                AutoRules.check(id, type, percent, season, episode);
            },
            
            get(id, type, season = null, episode = null) {
                if(type === 'tv' && season && episode) {
                    const key = `${id}_tv_s${season}_e${episode}`;
                    return this.data[key] || null;
                }
                const key = `${id}_movie`;
                return this.data[key] || null;
            },
            
            getLastForMovie(id) {
                const key = `${id}_movie`;
                return this.data[key] || null;
            },
            
            getLastForTv(id) {
                let last = null;
                for(const key in this.data) {
                    if(key.startsWith(`${id}_tv`)) {
                        if(!last || this.data[key].updated > last.updated) last = this.data[key];
                    }
                }
                return last;
            }
        };
        
        // ==================== 3. АВТОМАТИЧЕСКИЕ ПРАВИЛА ====================
        const AutoRules = {
            enabled: {
                autoWatching: true,
                autoWatched: true
            },
            thresholds: {
                watchingPercent: 5,
                watchedPercent: 95
            },
            
            check(id, type, percent, season, episode) {
                const item = { id: id, title: String(id) };
                
                if(type === 'movie') {
                    if(this.enabled.autoWatched && percent >= this.thresholds.watchedPercent) {
                        if(!Core.is('watched', item)) {
                            Core.add('watched', item);
                        }
                    } else if(this.enabled.autoWatching && percent >= this.thresholds.watchingPercent) {
                        if(!Core.is('watched', item) && !Core.is('watching', item)) {
                            Core.add('watching', item);
                        }
                    }
                }
            }
        };
        
        // ==================== 4. СОХРАНЕНИЕ РАЗДЕЛОВ ====================
        const BookmarkSection = {
            storageKey: 'smart_section_bookmarks',
            
            saveCurrent() {
                const activity = Lampa.Activity.active();
                if(!activity || !activity.params) return;
                
                const bookmark = {
                    title: activity.params.title || 'Раздел',
                    url: window.location.href,
                    component: activity.params.component,
                    params: JSON.parse(JSON.stringify(activity.params)),
                    created: Date.now()
                };
                
                let bookmarks = Lampa.Storage.get(this.storageKey, []);
                bookmarks.unshift(bookmark);
                if(bookmarks.length > 20) bookmarks = bookmarks.slice(0, 20);
                Lampa.Storage.set(this.storageKey, bookmarks);
                
                Lampa.Noty.show('Раздел сохранён', { time: 1500 });
                this.updateMenu();
            },
            
            updateMenu() {
                const bookmarks = Lampa.Storage.get(this.storageKey, []);
                const menuContainer = document.querySelector('.menu__list');
                if(!menuContainer) return;
                
                // Удаляем старые закладки
                document.querySelectorAll('.menu__item[data-smart-bookmark]').forEach(el => el.remove());
                
                if(bookmarks.length === 0) return;
                
                // Добавляем разделитель
                let separator = menuContainer.querySelector('.smart-bookmark-separator');
                if(!separator) {
                    separator = document.createElement('li');
                    separator.className = 'menu__item menu__item--separator smart-bookmark-separator';
                    separator.innerHTML = '<span class="menu__name">📌 Закладки</span>';
                    menuContainer.appendChild(separator);
                }
                
                // Добавляем закладки
                bookmarks.forEach((bookmark, index) => {
                    const item = document.createElement('li');
                    item.className = 'menu__item selector';
                    item.setAttribute('data-smart-bookmark', index);
                    item.innerHTML = `<span class="menu__name">🔖 ${bookmark.title.length > 25 ? bookmark.title.slice(0,25)+'…' : bookmark.title}</span>`;
                    
                    item.onclick = () => {
                        Lampa.Activity.push(bookmark.params);
                    };
                    
                    // Долгое нажатие для удаления
                    item.addEventListener('contextmenu', (e) => {
                        e.preventDefault();
                        let bookmarks = Lampa.Storage.get(this.storageKey, []);
                        bookmarks.splice(index, 1);
                        Lampa.Storage.set(this.storageKey, bookmarks);
                        this.updateMenu();
                        Lampa.Noty.show('Закладка удалена', { time: 1000 });
                    });
                    
                    menuContainer.appendChild(item);
                });
            },
            
            addToMenu() {
                const menu = document.querySelector('.menu__list');
                if(!menu) return;
                
                // Добавляем кнопку "Сохранить раздел" в шапку или в меню
                const headMenu = document.querySelector('.head__menu');
                if(headMenu) {
                    let saveBtn = headMenu.querySelector('.smart-save-section');
                    if(!saveBtn) {
                        saveBtn = document.createElement('div');
                        saveBtn.className = 'head__item selector smart-save-section';
                        saveBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M17,3H5C3.89,3 3,3.9 3,5V19C3,20.1 3.89,21 5,21H19C20.1,21 21,20.1 21,19V7L17,3M19,19H5V5H16.17L19,7.83V19M12,12C10.34,12 9,13.34 9,15C9,16.66 10.34,18 12,18C13.66,18 15,16.66 15,15C15,13.34 13.66,12 12,12M6,6H14V10H6V6Z"/></svg>';
                        saveBtn.onclick = () => this.saveCurrent();
                        headMenu.appendChild(saveBtn);
                    }
                }
            }
        };
        
        // ==================== 5. UI: БЛОК НА СТРАНИЦЕ ФИЛЬМА ====================
        class FullStatusBlock {
            constructor(object) {
                this.object = object;
                this.card = object.card;
                this.html = null;
            }
            
            create() {
                const status = Core.getStatus(this.card);
                const statusName = status ? Core.getCategoryName(status) : 'Не указан';
                const progress = TimeKeeper.getLastForMovie(this.card.id);
                
                this.html = $(`
                    <div class="smart-status-block" style="margin: 15px 20px; padding: 12px; background: rgba(255,255,255,0.08); border-radius: 12px;">
                        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
                            <div>
                                <span style="opacity: 0.7;">📌 Статус:</span>
                                <span style="font-weight: bold; margin-left: 8px;">${statusName}</span>
                            </div>
                            ${progress ? `<div>🎬 Прогресс: <span class="smart-progress-value">${progress.percent}</span>%</div>` : ''}
                        </div>
                        <div style="margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap;">
                            <button class="smart-status-btn selector" data-cat="fav">⭐</button>
                            <button class="smart-status-btn selector" data-cat="watching">👁️</button>
                            <button class="smart-status-btn selector" data-cat="planned">📋</button>
                            <button class="smart-status-btn selector" data-cat="watched">✅</button>
                            <button class="smart-status-btn selector" data-cat="dropped">❌</button>
                            <button class="smart-status-btn selector" data-cat="collection">📦</button>
                            <button class="smart-status-btn selector" data-cat="clear">🗑️</button>
                        </div>
                    </div>
                `);
                
                this.html.find('.smart-status-btn').on('hover:enter', (e) => {
                    const cat = $(e.currentTarget).data('cat');
                    if(cat === 'clear') {
                        this.showClearConfirm();
                    } else {
                        Core.toggle(cat, this.card);
                        this.updateStatus();
                    }
                });
                
                return this.html;
            }
            
            updateStatus() {
                const status = Core.getStatus(this.card);
                const statusName = status ? Core.getCategoryName(status) : 'Не указан';
                this.html.find('div:first-child span:last-child').text(statusName);
                
                const progress = TimeKeeper.getLastForMovie(this.card.id);
                const progressSpan = this.html.find('.smart-progress-value');
                if(progressSpan.length && progress) {
                    progressSpan.text(progress.percent);
                }
            }
            
            showClearConfirm() {
                Lampa.Modal.open({
                    title: 'Подтверждение',
                    html: '<div class="about">Удалить из ВСЕХ категорий и очистить прогресс?</div>',
                    buttons: [
                        { name: 'Отмена', onSelect: () => Lampa.Modal.close() },
                        { name: 'Удалить', onSelect: () => {
                            Core.clearAll(this.card);
                            this.updateStatus();
                            Lampa.Modal.close();
                        }}
                    ]
                });
            }
            
            render() {
                return this.html;
            }
        }
        
        // ==================== 6. UI: МЕНЮ "ИЗБРАННОЕ+" ====================
        const SideMenu = {
            addButton() {
                // Ждём появления меню
                const checkInterval = setInterval(() => {
                    const menu = document.querySelector('.menu__list');
                    if(!menu) return;
                    clearInterval(checkInterval);
                    
                    const button = document.createElement('li');
                    button.className = 'menu__item selector';
                    button.setAttribute('data-action', 'smart_collections');
                    button.innerHTML = `
                        <svg class="menu__icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 2L15 8.5L22 9.5L17 14L18.5 21L12 17.5L5.5 21L7 14L2 9.5L9 8.5L12 2Z" fill="currentColor"/>
                        </svg>
                        <span class="menu__name">Избранное+</span>
                    `;
                    
                    button.onclick = () => this.openMenu();
                    menu.appendChild(button);
                }, 500);
            },
            
            openMenu() {
                const categories = [
                    { cat: 'fav', name: '⭐ Избранное' },
                    { cat: 'watching', name: '👁️ Смотрю' },
                    { cat: 'planned', name: '📋 Планы' },
                    { cat: 'watched', name: '✅ Просмотрено' },
                    { cat: 'dropped', name: '❌ Брошено' },
                    { cat: 'collection', name: '📦 Коллекция' }
                ];
                
                const items = categories.map(c => ({
                    title: c.name,
                    onSelect: () => this.showCategory(c.cat, c.name)
                }));
                
                items.push({ separator: true });
                items.push({ title: '🎲 Случайный фильм', onSelect: () => this.randomMovie() });
                items.push({ title: '⚙️ Настройки', onSelect: () => this.showSettings() });
                
                Lampa.Select.show({
                    title: 'Избранное+',
                    items: items,
                    onBack: () => Lampa.Controller.toggle('content')
                });
            },
            
            showCategory(cat, title) {
                const items = Core.data[cat];
                if(!items.length) {
                    Lampa.Noty.show(`В "${title}" ничего нет`, { time: 2000 });
                    return;
                }
                
                const selectItems = items.map(item => ({
                    title: item.title,
                    poster: item.poster,
                    onSelect: () => {
                        Lampa.Activity.push({
                            component: 'full',
                            id: item.id,
                            method: 'movie',
                            card: { id: item.id, title: item.title }
                        });
                    },
                    onLong: () => {
                        Core.remove(cat, { id: item.id, title: item.title });
                        this.showCategory(cat, title);
                    }
                }));
                
                Lampa.Select.show({
                    title: title,
                    items: selectItems,
                    onBack: () => this.openMenu()
                });
            },
            
            randomMovie() {
                const all = [...(Core.data.planned || []), ...(Core.data.fav || [])];
                if(!all.length) {
                    Lampa.Noty.show('Нет фильмов в "Планах" или "Избранном"', { time: 2000 });
                    return;
                }
                const random = all[Math.floor(Math.random() * all.length)];
                Lampa.Activity.push({
                    component: 'full',
                    id: random.id,
                    method: 'movie',
                    card: { id: random.id, title: random.title }
                });
            },
            
            showSettings() {
                const items = [
                    { title: '🤖 Авто-«Смотрю»', type: 'trigger', key: 'autoWatching', value: AutoRules.enabled.autoWatching },
                    { title: '✅ Авто-«Просмотрено»', type: 'trigger', key: 'autoWatched', value: AutoRules.enabled.autoWatched },
                    { separator: true },
                    { title: `📊 Порог «Смотрю»: ${AutoRules.thresholds.watchingPercent}%`, type: 'slider', key: 'watchingPercent' },
                    { title: `🏁 Порог «Просмотрено»: ${AutoRules.thresholds.watchedPercent}%`, type: 'slider', key: 'watchedPercent' }
                ];
                
                const selectItems = items.map(item => {
                    if(item.type === 'trigger') {
                        return {
                            title: item.title,
                            checkbox: true,
                            checked: item.value,
                            onSelect: () => {
                                AutoRules.enabled[item.key] = !AutoRules.enabled[item.key];
                                Lampa.Storage.set('smart_autorulex', AutoRules.enabled);
                                this.showSettings();
                            }
                        };
                    } else if(item.type === 'slider') {
                        return {
                            title: item.title,
                            onSelect: () => {
                                Lampa.Prompt.show({
                                    title: item.title,
                                    value: AutoRules.thresholds[item.key],
                                    type: 'number',
                                    onEnter: (val) => {
                                        AutoRules.thresholds[item.key] = parseInt(val) || 5;
                                        Lampa.Storage.set('smart_thresholds', AutoRules.thresholds);
                                        this.showSettings();
                                    }
                                });
                            }
                        };
                    }
                    return item;
                });
                
                Lampa.Select.show({
                    title: '⚙️ Настройки',
                    items: selectItems,
                    onBack: () => this.openMenu()
                });
            }
        };
        
        // ==================== 7. СЛУЖБА ТАЙМКОДОВ ====================
        const TimestampService = {
            init() {
                // Слушаем внутренний плеер
                Lampa.Listener.follow('player:timeupdate', (data) => {
                    if(data && data.time && data.duration && data.card) {
                        const percent = (data.time / data.duration) * 100;
                        TimeKeeper.set(data.card.id, 'movie', data.time, data.duration);
                    }
                });
                
                // Слушаем закрытие плеера для сохранения финального прогресса
                Lampa.Listener.follow('player:close', (data) => {
                    if(data && data.time && data.duration && data.card) {
                        TimeKeeper.set(data.card.id, 'movie', data.time, data.duration);
                    }
                });
            }
        };
        
        // ==================== 8. ЗАГРУЗКА СОХРАНЁННЫХ НАСТРОЕК ====================
        const savedRules = Lampa.Storage.get('smart_autorulex', null);
        if(savedRules) AutoRules.enabled = { ...AutoRules.enabled, ...savedRules };
        
        const savedThresholds = Lampa.Storage.get('smart_thresholds', null);
        if(savedThresholds) AutoRules.thresholds = { ...AutoRules.thresholds, ...savedThresholds };
        
        // Инициализация
        Core.load();
        TimeKeeper.load();
        TimestampService.init();
        SideMenu.addButton();
        BookmarkSection.addToMenu();
        BookmarkSection.updateMenu();
        
        // Добавляем блок статуса на страницу фильма
        Lampa.Listener.follow('full:complite', (data) => {
            if(data && data.object && data.object.card) {
                setTimeout(() => {
                    const statusBlock = new FullStatusBlock({ card: data.object.card });
                    const html = statusBlock.create();
                    if(html && data.object.html) {
                        data.object.html.find('.scroll__body').prepend(html);
                    }
                }, 500);
            }
        });
        
        // Загрузка настроек прогресс-бара
        const progressSettings = Lampa.Storage.get('smart_progress_settings', { enabled: true, position: 'bottom' });
        
        // Добавление прогресс-бара на карточки
        Lampa.Listener.follow('card:create', (card) => {
            if(!progressSettings.enabled || !card.element || !card.data) return;
            
            setTimeout(() => {
                const progress = TimeKeeper.getLastForMovie(card.data.id);
                if(!progress || progress.percent < 1) return;
                
                const poster = card.element.querySelector('.card__img, .card__poster, .card__image');
                if(!poster) return;
                
                const overlay = document.createElement('div');
                overlay.className = `smart-progress-overlay smart-progress-${progressSettings.position}`;
                overlay.style.cssText = 'position: absolute; left: 0; right: 0; background: rgba(0,0,0,0.7); font-size: 11px; padding: 2px 6px; text-align: center; z-index: 10;';
                if(progressSettings.position === 'bottom') overlay.style.bottom = '0';
                else if(progressSettings.position === 'top') overlay.style.top = '0';
                else overlay.style.top = '50%';
                
                overlay.innerHTML = `${Math.round(progress.percent)}%`;
                poster.style.position = 'relative';
                poster.appendChild(overlay);
            }, 100);
        });
        
        // Сохранение настроек при закрытии
        window.addEventListener('beforeunload', () => {
            Lampa.Storage.set('smart_autorulex', AutoRules.enabled);
            Lampa.Storage.set('smart_thresholds', AutoRules.thresholds);
        });
        
        console.log('✅ Smart Collections+ загружен');
    }
})();
