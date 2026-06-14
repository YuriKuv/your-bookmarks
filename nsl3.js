/**
 * Плагин "Избранное+" (Favorites Plus) - РАБОЧАЯ ВЕРСИЯ
 * Версия: 1.0.1
 */

(function() {
    if (typeof Lampa === 'undefined') {
        console.log('Favorites Plus: waiting for Lampa...');
        return;
    }

    // ==================== КОНФИГУРАЦИЯ ====================
    const DEFAULT_SETTINGS = {
        auto_watching_enabled: true,
        auto_completed_enabled: true,
        watching_percent: 5,
        completed_percent: 95,
        abandoned_days: 30,
        hide_native_favorite_button: false,
        log_enabled: true
    };
    
    // ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
    const Utils = {
        cleanHtml(str) {
            if (!str) return '';
            return String(str).replace(/<[^>]*>/g, '').trim();
        },
        
        formatTime(seconds) {
            if (!seconds || seconds < 0) return '0:00';
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            if (hours > 0) {
                return `${hours}:${minutes.toString().padStart(2, '0')}`;
            }
            return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
        },
        
        clone(obj) {
            return JSON.parse(JSON.stringify(obj));
        },
        
        getTmdbId(item) {
            return item?.id || item?.tmdb_id || item?.movie?.id;
        },
        
        getItemTitle(item) {
            return item?.title || item?.name || item?.movie?.title || 'Без названия';
        }
    };
    
    // ==================== ХРАНИЛИЩЕ ====================
    const SmartLists = {
        categories: {
            watching:    { name: 'Смотрю', icon: '👁️', storageKey: 'favplus_watching' },
            favorite:    { name: 'Избранное', icon: '⭐', storageKey: 'favplus_favorite' },
            planned:     { name: 'Буду смотреть', icon: '📋', storageKey: 'favplus_planned' },
            abandoned:   { name: 'Брошено', icon: '❌', storageKey: 'favplus_abandoned' },
            collection:  { name: 'Коллекция', icon: '📦', storageKey: 'favplus_collection' },
            completed:   { name: 'Просмотрено', icon: '✅', storageKey: 'favplus_completed' }
        },
        
        init() {
            for (const cat of Object.values(this.categories)) {
                if (Lampa.Storage.get(cat.storageKey) === undefined) {
                    Lampa.Storage.set(cat.storageKey, []);
                }
            }
        },
        
        addToList(listKey, item) {
            const cat = this.categories[listKey];
            if (!cat) return false;
            
            const items = Lampa.Storage.get(cat.storageKey, []);
            const itemId = Utils.getTmdbId(item);
            const exists = items.some(i => Utils.getTmdbId(i) == itemId);
            
            if (!exists) {
                const itemToAdd = Utils.clone(item);
                itemToAdd._favplus_added = Date.now();
                items.push(itemToAdd);
                Lampa.Storage.set(cat.storageKey, items);
                this._addLog(item, null, listKey);
                return true;
            }
            return false;
        },
        
        removeFromList(listKey, itemId) {
            const cat = this.categories[listKey];
            if (!cat) return false;
            
            let items = Lampa.Storage.get(cat.storageKey, []);
            const removedItem = items.find(i => Utils.getTmdbId(i) == itemId);
            items = items.filter(i => Utils.getTmdbId(i) != itemId);
            Lampa.Storage.set(cat.storageKey, items);
            if (removedItem) this._addLog(removedItem, listKey, null);
            return true;
        },
        
        getItemStatus(itemId) {
            for (const [key, cat] of Object.entries(this.categories)) {
                const items = Lampa.Storage.get(cat.storageKey, []);
                if (items.some(i => Utils.getTmdbId(i) == itemId)) {
                    return { key, ...cat };
                }
            }
            return null;
        },
        
        _addLog(item, from, to) {
            if (!Settings.get('log_enabled')) return;
            const log = Lampa.Storage.get('favplus_log', []);
            log.unshift({
                time: new Date().toLocaleString(),
                title: Utils.getItemTitle(item),
                from: from ? this.categories[from]?.name : null,
                to: to ? this.categories[to]?.name : null
            });
            while (log.length > 50) log.pop();
            Lampa.Storage.set('favplus_log', log);
        }
    };
    
    // ==================== МОДУЛЬ НАСТРОЕК ====================
    const Settings = {
        _settings: Utils.clone(DEFAULT_SETTINGS),
        
        init() {
            const saved = Lampa.Storage.get('favplus_settings', {});
            this._settings = { ...DEFAULT_SETTINGS, ...saved };
        },
        
        get(key, def = null) {
            return this._settings[key] !== undefined ? this._settings[key] : def;
        },
        
        set(key, value) {
            this._settings[key] = value;
            Lampa.Storage.set('favplus_settings', this._settings);
        }
    };
    
    // ==================== UI КОМПОНЕНТЫ ====================
    
    // Стили для кнопок и блоков
    const Styles = `
        <style>
            .favplus-status-block {
                display: flex;
                align-items: center;
                gap: 10px;
                margin-bottom: 15px;
                padding: 10px 15px;
                background: rgba(255,255,255,0.08);
                border-radius: 12px;
                font-size: 14px;
            }
            .favplus-status-icon {
                font-size: 24px;
            }
            .favplus-status-text {
                flex: 1;
            }
            .favplus-status-remove {
                color: #ff4444;
                cursor: pointer;
                padding: 5px 10px;
                border-radius: 6px;
                background: rgba(255,68,68,0.2);
            }
            .favplus-favorite-btn {
                background: rgba(255,255,255,0.1) !important;
                border-radius: 8px !important;
                margin-top: 10px !important;
            }
            .favplus-favorite-btn.active {
                background: rgba(255,215,0,0.3) !important;
            }
        </style>
    `;
    
    // Функция добавления кнопок на карточку
    function addButtonsToCard() {
        // Ищем контейнер с информацией о фильме
        const $infoCard = $('.full-info, .info-card, .card-full');
        if (!$infoCard.length) return false;
        
        // Проверяем, не добавлены ли уже кнопки
        if ($infoCard.find('.favplus-container').length) return true;
        
        // Получаем данные фильма из карточки
        let movie = null;
        
        // Пытаемся получить данные из разных мест
        if (Lampa.Activity.active() && Lampa.Activity.active().movie) {
            movie = Lampa.Activity.active().movie;
        } else if (window.currentMovie) {
            movie = window.currentMovie;
        } else {
            // Парсим из DOM
            const title = $infoCard.find('.full-info__title, .info-card__title, h1').first().text();
            const id = $infoCard.find('[data-id]').attr('data-id') || 
                       window.location.href.match(/card=(\d+)/)?.[1];
            const type = $infoCard.find('[data-type]').attr('data-type') || 'movie';
            
            if (id) {
                movie = { id: parseInt(id), title: title, type: type };
            }
        }
        
        if (!movie || !movie.id) {
            console.log('FavPlus: Cannot get movie data');
            return false;
        }
        
        // Получаем текущий статус фильма
        const currentStatus = SmartLists.getItemStatus(movie.id);
        
        // Создаем блок со статусом
        const $statusBlock = $(`
            <div class="favplus-container">
                <div class="favplus-status-block">
                    <span class="favplus-status-icon">${currentStatus?.icon || '📋'}</span>
                    <span class="favplus-status-text">
                        <strong>Избранное+</strong><br>
                        Статус: ${currentStatus?.name || 'Не добавлен'}
                    </span>
                    ${currentStatus ? `<span class="favplus-status-remove" data-id="${movie.id}" data-list="${currentStatus.key}">Удалить</span>` : ''}
                </div>
                <div class="favplus-buttons" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:15px;"></div>
            </div>
        `);
        
        // Добавляем кнопки для всех списков
        const $buttonsContainer = $statusBlock.find('.favplus-buttons');
        for (const [key, cat] of Object.entries(SmartLists.categories)) {
            const isActive = currentStatus?.key === key;
            $buttonsContainer.append(`
                <div class="button favplus-list-btn selector ${isActive ? 'active' : ''}" 
                     data-list="${key}" 
                     data-icon="${cat.icon}"
                     style="flex:1; text-align:center; padding:8px 0; background:${isActive ? 'rgba(255,215,0,0.3)' : 'rgba(255,255,255,0.1)'}; border-radius:8px;">
                    <div class="button__icon" style="font-size:20px;">${cat.icon}</div>
                    <div class="button__text" style="font-size:12px;">${cat.name}</div>
                </div>
            `);
        }
        
        // Вставляем блок перед кнопками
        const $buttonsWrap = $infoCard.find('.full-info__buttons, .info-card__buttons, .buttons');
        if ($buttonsWrap.length) {
            $buttonsWrap.before($statusBlock);
        } else {
            $infoCard.find('.full-info__about, .info-card__content').append($statusBlock);
        }
        
        // Скрываем родную кнопку если нужно
        if (Settings.get('hide_native_favorite_button')) {
            $infoCard.find('.full-info__favorite, .button--favorite, [data-action="favorite"]').hide();
        }
        
        // Обработчики событий
        $statusBlock.find('.favplus-list-btn').on('hover:enter', function() {
            const listKey = $(this).data('list');
            const icon = $(this).data('icon');
            const current = SmartLists.getItemStatus(movie.id);
            
            if (current?.key === listKey) {
                // Удаляем из списка
                SmartLists.removeFromList(listKey, movie.id);
                Lampa.Noty.show(`🗑️ Удалено из ${SmartLists.categories[listKey].name}`);
                $(this).removeClass('active');
                $(this).css('background', 'rgba(255,255,255,0.1)');
                
                // Обновляем статус-блок
                const newStatus = SmartLists.getItemStatus(movie.id);
                $statusBlock.find('.favplus-status-icon').text(newStatus?.icon || '📋');
                $statusBlock.find('.favplus-status-text').html(`<strong>Избранное+</strong><br>Статус: ${newStatus?.name || 'Не добавлен'}`);
                
                if (!newStatus) {
                    $statusBlock.find('.favplus-status-remove').remove();
                } else {
                    $statusBlock.find('.favplus-status-remove')
                        .attr('data-list', newStatus.key)
                        .show();
                }
            } else {
                // Добавляем в список
                if (current) {
                    SmartLists.removeFromList(current.key, movie.id);
                    $(`.favplus-list-btn[data-list="${current.key}"]`).removeClass('active').css('background', 'rgba(255,255,255,0.1)');
                }
                SmartLists.addToList(listKey, movie);
                Lampa.Noty.show(`${icon} Добавлено в ${SmartLists.categories[listKey].name}`);
                $(this).addClass('active');
                $(this).css('background', 'rgba(255,215,0,0.3)');
                
                // Обновляем статус-блок
                $statusBlock.find('.favplus-status-icon').text(icon);
                $statusBlock.find('.favplus-status-text').html(`<strong>Избранное+</strong><br>Статус: ${SmartLists.categories[listKey].name}`);
                
                if (!$statusBlock.find('.favplus-status-remove').length) {
                    $statusBlock.find('.favplus-status-block').append(`<span class="favplus-status-remove" data-id="${movie.id}" data-list="${listKey}">Удалить</span>`);
                } else {
                    $statusBlock.find('.favplus-status-remove').attr('data-list', listKey).show();
                }
            }
        });
        
        // Обработчик удаления
        $statusBlock.find('.favplus-status-remove').on('hover:enter', function() {
            const listKey = $(this).data('list');
            if (listKey) {
                SmartLists.removeFromList(listKey, movie.id);
                Lampa.Noty.show(`🗑️ Удалено из ${SmartLists.categories[listKey].name}`);
                
                // Обновляем UI
                $(`.favplus-list-btn[data-list="${listKey}"]`).removeClass('active').css('background', 'rgba(255,255,255,0.1)');
                $(this).remove();
                
                $statusBlock.find('.favplus-status-icon').text('📋');
                $statusBlock.find('.favplus-status-text').html(`<strong>Избранное+</strong><br>Статус: Не добавлен`);
            }
        });
        
        return true;
    }
    
    // Функция добавления пункта в меню
    function addMenuButton() {
        if ($('.favplus-menu-item').length) return;
        
        const $menuList = $('.menu__list').eq(0);
        if (!$menuList.length) return false;
        
        const $menuButton = $(`
            <li class="menu__item selector favplus-menu-item">
                <div class="menu__ico">⭐</div>
                <div class="menu__text">Избранное+</div>
            </li>
        `);
        
        $menuButton.on('hover:enter', showMainMenu);
        $menuList.append($menuButton);
        return true;
    }
    
    // Главное меню
    function showMainMenu() {
        const items = [
            { title: '📋 Мои списки', action: 'showLists' },
            { title: '📊 Статистика', action: 'showStats' },
            { title: '📜 История', action: 'showHistory' },
            { title: '⚙️ Настройки', action: 'showSettings' }
        ];
        
        Lampa.Select.show({
            title: 'Избранное+',
            items: items,
            onSelect: (selected) => {
                if (selected.action === 'showLists') showLists();
                if (selected.action === 'showStats') showStats();
                if (selected.action === 'showHistory') showHistory();
                if (selected.action === 'showSettings') showSettings();
            }
        });
    }
    
    // Показать списки
    function showLists() {
        const items = [];
        for (const [key, cat] of Object.entries(SmartLists.categories)) {
            const count = Lampa.Storage.get(cat.storageKey, []).length;
            items.push({ title: `${cat.icon} ${cat.name} (${count})`, listKey: key });
        }
        
        Lampa.Select.show({
            title: 'Мои списки',
            items: items,
            onSelect: (selected) => {
                const cat = SmartLists.categories[selected.listKey];
                const listItems = Lampa.Storage.get(cat.storageKey, []);
                
                if (!listItems.length) {
                    Lampa.Noty.show('Список пуст');
                    return;
                }
                
                const displayItems = listItems.map(item => ({
                    title: Utils.getItemTitle(item),
                    item: item
                }));
                
                Lampa.Select.show({
                    title: cat.name,
                    items: displayItems,
                    virtualScroll: true,
                    onSelect: (selected) => {
                        if (selected.item && Lampa.Activity) {
                            Lampa.Activity.push({
                                component: 'full',
                                title: Utils.getItemTitle(selected.item),
                                movie: selected.item,
                                id: Utils.getTmdbId(selected.item)
                            });
                        }
                    }
                });
            }
        });
    }
    
    // Статистика
    function showStats() {
        let totalItems = 0;
        let stats = {};
        
        for (const [key, cat] of Object.entries(SmartLists.categories)) {
            const items = Lampa.Storage.get(cat.storageKey, []);
            stats[key] = items.length;
            totalItems += items.length;
        }
        
        const text = `📊 Избранное+\n────────────────\n⭐ Избранное: ${stats.favorite || 0}\n👁️ Смотрю: ${stats.watching || 0}\n📋 Планы: ${stats.planned || 0}\n✅ Просмотрено: ${stats.completed || 0}\n❌ Брошено: ${stats.abandoned || 0}\n📦 Коллекция: ${stats.collection || 0}\n────────────────\n📋 Всего: ${totalItems}`;
        
        Lampa.Noty.show(text, 5000);
    }
    
    // История
    function showHistory() {
        const log = Lampa.Storage.get('favplus_log', []);
        if (!log.length) {
            Lampa.Noty.show('История пуста');
            return;
        }
        
        const items = log.map(entry => ({
            title: `${entry.title}\n${entry.from ? `Из: ${entry.from}` : '➕ Добавлено'} → ${entry.to || '🗑️ Удалено'}\n⏰ ${entry.time}`
        }));
        
        Lampa.Select.show({
            title: 'История действий',
            items: items,
            virtualScroll: true
        });
    }
    
    // Настройки
    function showSettings() {
        const items = [
            { title: `${Settings.get('auto_watching_enabled') ? '✅' : '❌'} Авто-Смотрю (${Settings.get('watching_percent')}%)`, action: 'toggle_watching' },
            { title: `${Settings.get('auto_completed_enabled') ? '✅' : '❌'} Авто-Просмотрено (${Settings.get('completed_percent')}%)`, action: 'toggle_completed' },
            { title: `${Settings.get('hide_native_favorite_button') ? '✅' : '❌'} Скрыть штатную кнопку`, action: 'toggle_native' },
            { title: '🗑️ Очистить все данные', action: 'clear' }
        ];
        
        Lampa.Select.show({
            title: '⚙️ Настройки',
            items: items,
            onSelect: (selected) => {
                if (selected.action === 'toggle_watching') {
                    Settings.set('auto_watching_enabled', !Settings.get('auto_watching_enabled'));
                    showSettings();
                }
                if (selected.action === 'toggle_completed') {
                    Settings.set('auto_completed_enabled', !Settings.get('auto_completed_enabled'));
                    showSettings();
                }
                if (selected.action === 'toggle_native') {
                    Settings.set('hide_native_favorite_button', !Settings.get('hide_native_favorite_button'));
                    showSettings();
                }
                if (selected.action === 'clear') {
                    if (confirm('Очистить все данные Избранное+?')) {
                        for (const cat of Object.values(SmartLists.categories)) {
                            Lampa.Storage.set(cat.storageKey, []);
                        }
                        Lampa.Noty.show('✅ Все данные очищены');
                        setTimeout(() => location.reload(), 1500);
                    }
                }
            }
        });
    }
    
    // Следим за открытием карточек
    function watchForCardOpen() {
        // Перехватываем Activity.push
        const originalPush = Lampa.Activity.push;
        Lampa.Activity.push = function(params) {
            const result = originalPush.call(this, params);
            if (params.component === 'full') {
                setTimeout(() => addButtonsToCard(), 300);
                setTimeout(() => addButtonsToCard(), 1000);
            }
            return result;
        };
        
        // Также следим за появлением карточки через MutationObserver
        const observer = new MutationObserver(() => {
            if ($('.full-info, .info-card').length) {
                addButtonsToCard();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
    
    // ==================== ЗАПУСК ====================
    function init() {
        console.log('Favorites Plus: starting...');
        
        // Добавляем стили
        $('head').append(Styles);
        
        // Инициализация
        Settings.init();
        SmartLists.init();
        
        // Добавляем кнопку в меню
        const menuInterval = setInterval(() => {
            if (addMenuButton()) clearInterval(menuInterval);
        }, 1000);
        
        // Следим за карточками
        if (window.appready) {
            watchForCardOpen();
            setTimeout(() => addButtonsToCard(), 2000);
        } else {
            Lampa.Listener.follow('app', (e) => {
                if (e.type === 'ready') {
                    watchForCardOpen();
                    setTimeout(() => addButtonsToCard(), 2000);
                }
            });
        }
        
        console.log('Favorites Plus: ready!');
    }
    
    init();
})();
