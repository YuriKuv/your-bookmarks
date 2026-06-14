/**
 * Плагин "Избранное+" (Favorites Plus) - ФИНАЛЬНАЯ ВЕРСИЯ
 * Для Lampa 3.2.0
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
        hide_native_favorite_button: false,
        log_enabled: true
    };
    
    // ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
    const Utils = {
        cleanHtml(str) {
            if (!str) return '';
            return String(str).replace(/<[^>]*>/g, '').trim();
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
                const itemToAdd = JSON.parse(JSON.stringify(item));
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
        
        getAllStats() {
            const stats = {};
            for (const [key, cat] of Object.entries(this.categories)) {
                stats[key] = Lampa.Storage.get(cat.storageKey, []).length;
            }
            return stats;
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
        _settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
        
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
    
    // ==================== ДОБАВЛЕНИЕ КНОПОК НА КАРТОЧКУ ====================
    function addButtonsToCard() {
        // Ищем контейнер карточки (новая структура full-start-new)
        const $cardContainer = $('.full-start-new');
        if (!$cardContainer.length) return false;
        
        // Проверяем, не добавлены ли уже кнопки
        if ($cardContainer.find('.favplus-panel').length) return true;
        
        // Получаем данные фильма
        const movie = Lampa.Activity.active()?.card;
        if (!movie || !movie.id) {
            console.log('FavPlus: Cannot get movie data');
            return false;
        }
        
        // Получаем текущий статус
        const currentStatus = SmartLists.getItemStatus(movie.id);
        const stats = SmartLists.getAllStats();
        
        // Создаем панель с кнопками
        const panelHtml = `
            <div class="favplus-panel" style="
                background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                border-radius: 12px;
                padding: 12px 15px;
                margin: 15px 0 0 0;
                border: 1px solid rgba(255,255,255,0.1);
            ">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 20px;">⭐</span>
                        <span style="font-weight: bold; font-size: 14px;">Избранное+</span>
                        <span style="font-size: 12px; opacity: 0.7;">(всего: ${Object.values(stats).reduce((a,b) => a+b, 0)})</span>
                    </div>
                    <div class="favplus-current-status" style="
                        background: ${currentStatus ? 'rgba(76,175,80,0.2)' : 'rgba(255,255,255,0.1)'};
                        padding: 4px 10px;
                        border-radius: 20px;
                        font-size: 12px;
                    ">
                        ${currentStatus ? `${currentStatus.icon} ${currentStatus.name}` : '📋 Не добавлен'}
                    </div>
                </div>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    ${Object.entries(SmartLists.categories).map(([key, cat]) => `
                        <button class="favplus-btn" data-list="${key}" style="
                            flex: 1;
                            min-width: 70px;
                            background: ${currentStatus?.key === key ? 'rgba(76,175,80,0.3)' : 'rgba(255,255,255,0.1)'};
                            border: ${currentStatus?.key === key ? '1px solid #4CAF50' : '1px solid transparent'};
                            border-radius: 8px;
                            padding: 8px 5px;
                            color: white;
                            cursor: pointer;
                            transition: all 0.2s;
                            font-size: 12px;
                        ">
                            <div style="font-size: 18px; margin-bottom: 3px;">${cat.icon}</div>
                            <div>${cat.name}</div>
                            <div style="font-size: 10px; opacity: 0.6; margin-top: 2px;">${stats[key] || 0}</div>
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
        
        // Вставляем панель после кнопок
        const $buttonsContainer = $cardContainer.find('.full-start-new__buttons');
        if ($buttonsContainer.length) {
            $buttonsContainer.after(panelHtml);
        } else {
            $cardContainer.find('.full-start-new__right').append(panelHtml);
        }
        
        // Добавляем обработчики
        $('.favplus-btn').off('click').on('click', function() {
            const listKey = $(this).data('list');
            const current = SmartLists.getItemStatus(movie.id);
            
            if (current?.key === listKey) {
                // Удаляем из списка
                SmartLists.removeFromList(listKey, movie.id);
                Lampa.Noty.show(`🗑️ Удалено из ${SmartLists.categories[listKey].name}`);
            } else {
                // Добавляем в список
                if (current) {
                    SmartLists.removeFromList(current.key, movie.id);
                }
                SmartLists.addToList(listKey, movie);
                Lampa.Noty.show(`${SmartLists.categories[listKey].icon} Добавлено в ${SmartLists.categories[listKey].name}`);
            }
            
            // Обновляем UI
            const newStatus = SmartLists.getItemStatus(movie.id);
            $('.favplus-current-status').html(newStatus ? `${newStatus.icon} ${newStatus.name}` : '📋 Не добавлен');
            
            // Обновляем стили кнопок
            $('.favplus-btn').each(function() {
                const btnList = $(this).data('list');
                if (newStatus?.key === btnList) {
                    $(this).css('background', 'rgba(76,175,80,0.3)');
                    $(this).css('border', '1px solid #4CAF50');
                } else {
                    $(this).css('background', 'rgba(255,255,255,0.1)');
                    $(this).css('border', '1px solid transparent');
                }
            });
            
            // Обновляем статистику в шапке
            const newStats = SmartLists.getAllStats();
            const total = Object.values(newStats).reduce((a,b) => a+b, 0);
            $('.favplus-panel [style*="Избранное+"]').parent().find('span:last-child').text(`(всего: ${total})`);
            
            // Обновляем счетчики на кнопках
            Object.keys(newStats).forEach(key => {
                $(`.favplus-btn[data-list="${key}"] div:last-child`).text(newStats[key] || 0);
            });
        });
        
        return true;
    }
    
    // ==================== ДОБАВЛЕНИЕ ПУНКТА В МЕНЮ ====================
    function addMenuButton() {
        if ($('.favplus-menu-item').length) return true;
        
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
    
    // ==================== ГЛАВНОЕ МЕНЮ ====================
    function showMainMenu() {
        const stats = SmartLists.getAllStats();
        const total = Object.values(stats).reduce((a,b) => a+b, 0);
        
        const items = [
            { title: `📊 Статистика (всего: ${total})`, action: 'stats' },
            { title: `⭐ Избранное (${stats.favorite || 0})`, action: 'favorite' },
            { title: `👁️ Смотрю (${stats.watching || 0})`, action: 'watching' },
            { title: `📋 Планы (${stats.planned || 0})`, action: 'planned' },
            { title: `✅ Просмотрено (${stats.completed || 0})`, action: 'completed' },
            { title: `❌ Брошено (${stats.abandoned || 0})`, action: 'abandoned' },
            { title: `📦 Коллекция (${stats.collection || 0})`, action: 'collection' },
            { title: `📜 История действий`, action: 'history' },
            { title: `⚙️ Настройки`, action: 'settings' }
        ];
        
        Lampa.Select.show({
            title: '⭐ Избранное+',
            items: items,
            onSelect: (selected) => {
                if (selected.action === 'stats') showStats();
                else if (selected.action === 'history') showHistory();
                else if (selected.action === 'settings') showSettings();
                else if (SmartLists.categories[selected.action]) {
                    showList(selected.action);
                }
            }
        });
    }
    
    function showStats() {
        const stats = SmartLists.getAllStats();
        const total = Object.values(stats).reduce((a,b) => a+b, 0);
        
        const text = `⭐ ИЗБРАННОЕ+\n────────────────\n⭐ Избранное: ${stats.favorite || 0}\n👁️ Смотрю: ${stats.watching || 0}\n📋 Планы: ${stats.planned || 0}\n✅ Просмотрено: ${stats.completed || 0}\n❌ Брошено: ${stats.abandoned || 0}\n📦 Коллекция: ${stats.collection || 0}\n────────────────\n📋 Всего: ${total}`;
        
        Lampa.Noty.show(text, 5000);
    }
    
    function showList(listKey) {
        const cat = SmartLists.categories[listKey];
        const items = Lampa.Storage.get(cat.storageKey, []);
        
        if (!items.length) {
            Lampa.Noty.show(`📭 Список "${cat.name}" пуст`);
            return;
        }
        
        const displayItems = items.map(item => ({
            title: Utils.getItemTitle(item),
            item: item
        }));
        
        Lampa.Select.show({
            title: `${cat.icon} ${cat.name} (${items.length})`,
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
    
    function showHistory() {
        const log = Lampa.Storage.get('favplus_log', []);
        if (!log.length) {
            Lampa.Noty.show('История пуста');
            return;
        }
        
        const items = log.slice(0, 30).map(entry => ({
            title: `${entry.title}\n${entry.from ? `📤 Из: ${entry.from}` : '➕ Добавлено'} → ${entry.to ? `📥 В: ${entry.to}` : '🗑️ Удалено'}\n⏰ ${entry.time}`
        }));
        
        Lampa.Select.show({
            title: '📜 История действий',
            items: items,
            virtualScroll: true
        });
    }
    
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
                } else if (selected.action === 'toggle_completed') {
                    Settings.set('auto_completed_enabled', !Settings.get('auto_completed_enabled'));
                    showSettings();
                } else if (selected.action === 'toggle_native') {
                    Settings.set('hide_native_favorite_button', !Settings.get('hide_native_favorite_button'));
                    if (Settings.get('hide_native_favorite_button')) {
                        $('.full-start__button.button--book').hide();
                    } else {
                        $('.full-start__button.button--book').show();
                    }
                    showSettings();
                } else if (selected.action === 'clear') {
                    if (confirm('Очистить все данные Избранное+?')) {
                        for (const cat of Object.values(SmartLists.categories)) {
                            Lampa.Storage.set(cat.storageKey, []);
                        }
                        Lampa.Storage.set('favplus_log', []);
                        Lampa.Noty.show('✅ Все данные очищены');
                        setTimeout(() => location.reload(), 1500);
                    }
                }
            }
        });
    }
    
    // ==================== СЛЕЖЕНИЕ ЗА ОТКРЫТИЕМ КАРТОЧЕК ====================
    function watchForCardOpen() {
        // Перехватываем открытие карточки
        const originalPush = Lampa.Activity.push;
        Lampa.Activity.push = function(params) {
            const result = originalPush.call(this, params);
            if (params.component === 'full') {
                // Даем время на рендер
                setTimeout(() => addButtonsToCard(), 200);
                setTimeout(() => addButtonsToCard(), 500);
                setTimeout(() => addButtonsToCard(), 1000);
            }
            return result;
        };
        
        // Следим за DOM изменениями
        const observer = new MutationObserver(() => {
            if ($('.full-start-new').length && !$('.favplus-panel').length) {
                addButtonsToCard();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        
        // Если карточка уже открыта
        if (Lampa.Activity.active()?.component === 'full') {
            setTimeout(() => addButtonsToCard(), 500);
        }
    }
    
    // ==================== ЗАПУСК ====================
    function init() {
        console.log('Favorites Plus v1.0 starting...');
        
        Settings.init();
        SmartLists.init();
        
        // Добавляем кнопку в меню
        let menuAttempts = 0;
        const menuInterval = setInterval(() => {
            if (addMenuButton() || menuAttempts > 20) clearInterval(menuInterval);
            menuAttempts++;
        }, 500);
        
        // Следим за карточками
        if (window.appready) {
            watchForCardOpen();
        } else {
            Lampa.Listener.follow('app', (e) => {
                if (e.type === 'ready') {
                    watchForCardOpen();
                }
            });
        }
        
        // Скрываем родную кнопку если нужно
        if (Settings.get('hide_native_favorite_button')) {
            setTimeout(() => {
                $('.full-start__button.button--book').hide();
            }, 1000);
        }
        
        console.log('Favorites Plus ready!');
    }
    
    init();
})();
