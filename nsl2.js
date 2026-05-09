/**
 * Избранное+ (NSL) v4.0
 * Плагин для Lampa
 */
(function() {
    'use strict';

    // ========== КОНФИГУРАЦИЯ ==========
    const PLUGIN_NAME = 'Избранное+';
    const PLUGIN_ICON = `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`;
    
    const CATEGORIES = ['favorite', 'watching', 'planned', 'watched', 'abandoned', 'collection'];
    const CATEGORY_RULES = {
        abandoned: ['favorite', 'watching', 'planned', 'watched'],
        watched: ['favorite', 'watching', 'planned'],
        watching: ['planned', 'favorite'],
        collection: [],
        favorite: [],
        planned: []
    };
    const STATUS_PRIORITY = ['watching', 'abandoned', 'watched', 'planned', 'favorite', 'collection'];

    // ========== УТИЛИТЫ ==========
    function getProfileId() {
        try {
            return Lampa.Storage.get('account', {}).profile?.id || 'default';
        } catch(e) {
            return 'default';
        }
    }

    function storageKey(name) {
        return `nsl_${name}_${getProfileId()}_v4`;
    }

    function configKey() {
        return storageKey('cfg');
    }

    function getConfig() {
        const def = {
            enabled: true,
            button_position: 'side',
            gist_token: '',
            gist_id: '',
            sync_on_start: true,
            sync_on_close: true,
            sync_on_add: true,
            sync_on_remove: true,
            sync_auto_interval: false,
            sync_interval_minutes: 30,
            auto_save: true,
            auto_sync: true,
            sync_interval: 10,
            sync_strategy: 'max_time',
            auto_abandoned: false,
            abandoned_days: 30,
            auto_watching: true,
            watching_min_progress: 5,
            watching_max_progress: 95,
            auto_watched: true,
            watched_min_progress: 95,
            auto_remove_watched: false,
            auto_remove_watched_days: 7,
            card_display_mode: 'nsl_status',
            nsl_status_position: 'center',
            show_move_notifications: true,
            cleanup_older_days: 0,
            cleanup_completed: false,
            check_new_episodes: true,
            new_episodes_notify: true,
            new_episodes_check_interval: 6,
            hide_lampa_bookmark_button: false
        };
        
        try {
            const saved = Lampa.Storage.get(configKey(), {});
            return Object.assign({}, def, saved);
        } catch(e) {
            return def;
        }
    }

    function saveConfig(cfg) {
        Lampa.Storage.set(configKey(), cfg);
    }

    function getFavorites() {
        try {
            return Lampa.Storage.get(storageKey('favorites'), []);
        } catch(e) {
            return [];
        }
    }

    function saveFavorites(data) {
        Lampa.Storage.set(storageKey('favorites'), data);
    }

    function getBookmarks() {
        try {
            return Lampa.Storage.get(storageKey('bookmarks'), []);
        } catch(e) {
            return [];
        }
    }

    function saveBookmarks(data) {
        Lampa.Storage.set(storageKey('bookmarks'), data);
    }

    function getTimeline() {
        try {
            return Lampa.Storage.get(storageKey('timeline'), {});
        } catch(e) {
            return {};
        }
    }

    function saveTimeline(data) {
        Lampa.Storage.set(storageKey('timeline'), data);
    }

    function getHistory() {
        try {
            return Lampa.Storage.get(storageKey('history'), []);
        } catch(e) {
            return [];
        }
    }

    function saveHistory(data) {
        Lampa.Storage.set(storageKey('history'), data);
    }

    function makeKey(activity) {
        const parts = [
            activity.component || '',
            activity.source || '',
            activity.url || '',
            activity.genres || '',
            JSON.stringify(activity.params || {}),
            activity.filter || '',
            activity.sort || ''
        ];
        return parts.join('|');
    }

    function isSeries(card) {
        return !!card.original_name;
    }

    function getTmdbId(card) {
        return card.id || card.tmdb_id || 0;
    }

    function getMediaType(card) {
        return isSeries(card) ? 'tv' : 'movie';
    }

    function getStatusPriority(categories) {
        for (const cat of STATUS_PRIORITY) {
            if (categories.includes(cat)) return cat;
        }
        return null;
    }

    function notify(text) {
        if (Lampa.Noty) Lampa.Noty.show(text);
    }

    // ========== ЗАКЛАДКИ РАЗДЕЛОВ ==========
    function addBookmark() {
        const activity = Lampa.Activity.active();
        if (!activity) return;

        const key = makeKey(activity);
        const bookmarks = getBookmarks();

        if (bookmarks.find(b => b.key === key)) {
            notify('Раздел уже сохранён');
            return;
        }

        bookmarks.push({
            id: Date.now(),
            key: key,
            name: activity.title || 'Без названия',
            url: activity.url || '',
            component: activity.component || '',
            source: activity.source || '',
            params: activity.params || {},
            genres: activity.genres || '',
            page: activity.page || 1,
            created: Date.now()
        });

        saveBookmarks(bookmarks);
        updateBookmarksMenu();
        notify('Раздел сохранён');
    }

    function updateBookmarksMenu() {
        const cfg = getConfig();
        const bookmarks = getBookmarks();
        
        // Удаляем старые элементы закладок
        $('.nsl-bookmark-item').remove();

        if (cfg.button_position === 'side') {
            // Добавляем в боковое меню
            const menuList = $('.menu__list').first();
            
            if (cfg.enabled && bookmarks.length > 0) {
                bookmarks.forEach(bm => {
                    const item = $(`
                        <li class="menu__item selector nsl-bookmark-item" data-nsl-key="${bm.key}">
                            <div class="menu__ico">
                                <svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z"/></svg>
                            </div>
                            <div class="menu__text">${bm.name}</div>
                        </li>
                    `);

                    item.on('hover:enter', () => {
                        Lampa.Activity.push({
                            url: bm.url,
                            component: bm.component,
                            source: bm.source,
                            params: bm.params,
                            genres: bm.genres,
                            page: bm.page,
                            title: bm.name
                        });
                    });

                    item.on('hover:long', () => {
                        const bookmarks = getBookmarks();
                        const idx = bookmarks.findIndex(b => b.key === bm.key);
                        if (idx >= 0) {
                            bookmarks.splice(idx, 1);
                            saveBookmarks(bookmarks);
                            updateBookmarksMenu();
                            notify('Закладка удалена');
                        }
                    });

                    menuList.prepend(item);
                });
            }

            // Кнопка "Сохранить раздел"
            const saveBtn = $(`
                <li class="menu__item selector nsl-bookmark-item nsl-save-btn">
                    <div class="menu__ico">
                        <svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>
                    </div>
                    <div class="menu__text">Сохранить раздел</div>
                </li>
            `);

            saveBtn.on('hover:enter', addBookmark);
            menuList.prepend(saveBtn);
        }
    }

    // ========== ИЗБРАННОЕ ==========
    function addToFavorite(card, categories) {
        const favorites = getFavorites();
        const tmdbId = getTmdbId(card);
        const mediaType = getMediaType(card);
        const now = Date.now();

        let entry = favorites.find(f => f.card_id === card.id && f.media_type === mediaType);

        if (!entry) {
            entry = {
                id: now,
                card_id: card.id,
                tmdb_id: tmdbId,
                media_type: mediaType,
                category: [],
                data: cleanCardData(card),
                added: now,
                updated: now
            };
            favorites.push(entry);
        }

        // Применяем категории
        for (const cat of categories) {
            if (!entry.category.includes(cat)) {
                entry.category.push(cat);
            }
        }

        // Применяем правила авто-удаления
        for (const cat of categories) {
            const rules = CATEGORY_RULES[cat];
            if (rules) {
                entry.category = entry.category.filter(c => !rules.includes(c));
            }
        }

        entry.updated = now;
        saveFavorites(favorites);
        refreshCardUI();

        if (getConfig().show_move_notifications) {
            notify(`Добавлено: ${card.title || card.name}`);
        }
    }

    function removeFromFavorite(card, categories) {
        const favorites = getFavorites();
        const mediaType = getMediaType(card);
        const entry = favorites.find(f => f.card_id === card.id && f.media_type === mediaType);

        if (entry) {
            if (categories) {
                entry.category = entry.category.filter(c => !categories.includes(c));
                if (entry.category.length === 0) {
                    const idx = favorites.indexOf(entry);
                    favorites.splice(idx, 1);
                }
            } else {
                const idx = favorites.indexOf(entry);
                favorites.splice(idx, 1);
            }

            entry.updated = Date.now();
            saveFavorites(favorites);
            refreshCardUI();
        }
    }

    function cleanCardData(card) {
        return {
            id: card.id,
            title: card.title || card.name || '',
            original_name: card.original_name || '',
            original_title: card.original_title || '',
            poster_path: card.poster_path || '',
            backdrop_path: card.backdrop_path || '',
            release_date: card.release_date || card.first_air_date || '',
            vote_average: card.vote_average || 0,
            overview: card.overview || ''
        };
    }

    // ========== ТАЙМКОДЫ ==========
    function getMovieKey(card) {
        if (isSeries(card)) {
            const season = card.season_number || card.season || 1;
            const episode = card.episode_number || card.episode || 1;
            return `${getTmdbId(card)}_s${season}_e${episode}`;
        }
        return `${getTmdbId(card)}`;
    }

    function saveProgress(movieKey, time, percent, duration, tmdbId) {
        const timeline = getTimeline();
        timeline[movieKey] = {
            time: time,
            percent: percent,
            duration: duration,
            updated: Date.now(),
            tmdb_id: tmdbId
        };
        saveTimeline(timeline);

        // Синхронизация со штатным хранилищем
        const hash = movieKey; // Используем ключ как хеш
        if (Lampa.Timeline) {
            Lampa.Timeline.update({
                hash: hash,
                time: time,
                percent: percent,
                duration: duration
            });
        }

        // Авто-перемещение
        syncTimelineWithCategories(movieKey, percent, tmdbId);
    }

    function getBestTimelineItem(tmdbId) {
        const timeline = getTimeline();
        const strategy = getConfig().sync_strategy;
        let bestKey = null;
        let bestValue = null;

        for (const [key, value] of Object.entries(timeline)) {
            if (value.tmdb_id === tmdbId) {
                if (!bestKey) {
                    bestKey = key;
                    bestValue = value;
                } else if (strategy === 'max_time') {
                    if (value.time > bestValue.time) {
                        bestKey = key;
                        bestValue = value;
                    }
                } else if (strategy === 'last_watch') {
                    if (value.updated > bestValue.updated) {
                        bestKey = key;
                        bestValue = value;
                    }
                }
            }
        }

        return bestKey ? { key: bestKey, ...bestValue } : null;
    }

    // ========== АВТОМАТИЧЕСКОЕ ПЕРЕМЕЩЕНИЕ ==========
    function syncTimelineWithCategories(movieKey, percent, tmdbId) {
        const cfg = getConfig();
        const favorites = getFavorites();
        const entry = favorites.find(f => f.tmdb_id === tmdbId);

        if (!entry) return;

        const isMovie = movieKey.indexOf('_s') === -1;

        // Авто в "Смотрю"
        if (cfg.auto_watching) {
            if (percent >= cfg.watching_min_progress && percent <= cfg.watching_max_progress) {
                if (!entry.category.includes('watching')) {
                    entry.category.push('watching');
                    entry.category = entry.category.filter(c => !CATEGORY_RULES.watching.includes(c));
                    entry.updated = Date.now();
                    logMove('auto_watching', entry.data.title, '→', 'Смотрю');
                }
            }
        }

        // Авто в "Просмотрено"
        if (cfg.auto_watched && isMovie) {
            if (percent >= cfg.watched_min_progress) {
                if (!entry.category.includes('watched')) {
                    entry.category.push('watched');
                    entry.category = entry.category.filter(c => !CATEGORY_RULES.watched.includes(c));
                    entry.updated = Date.now();
                    logMove('auto_watched', entry.data.title, '→', 'Просмотрено');
                }
            }
        }

        saveFavorites(favorites);
    }

    // ========== ОТОБРАЖЕНИЕ НА КАРТОЧКАХ ==========
    function getCardStyles() {
        const cfg = getConfig();
        let css = '';

        if (cfg.card_display_mode === 'nsl_status') {
            css += `
                .card__nsl-status {
                    position: absolute;
                    z-index: 10;
                    background: rgba(0,0,0,0.8);
                    color: #fff;
                    font-size: 12px;
                    padding: 2px 6px;
                    border-radius: 4px;
                    white-space: nowrap;
                    max-width: 90%;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .card__nsl-status.pos-top { top: 4px; left: 4px; }
                .card__nsl-status.pos-center { top: 50%; left: 50%; transform: translate(-50%, -50%); }
                .card__nsl-status.pos-bottom { bottom: 4px; left: 4px; }
                .card__nsl-status.cat-watching { background: rgba(33,150,243,0.9); }
                .card__nsl-status.cat-planned { background: rgba(156,39,176,0.9); }
                .card__nsl-status.cat-watched { background: rgba(76,175,80,0.9); }
                .card__nsl-status.cat-abandoned { background: rgba(158,158,158,0.9); }
                .card__nsl-status.cat-favorite { background: rgba(255,152,0,0.9); }
                .card__nsl-status.cat-collection { background: rgba(0,188,212,0.9); }
            `;
        }

        return css;
    }

    function updateCardStyles() {
        let styleEl = $('#nsl-card-styles');
        if (!styleEl.length) {
            styleEl = $('<style id="nsl-card-styles">').appendTo('head');
        }
        styleEl.text(getCardStyles());
    }

    function updateCardStatusElement(cardElement, card) {
        const cfg = getConfig();
        if (cfg.card_display_mode !== 'nsl_status') return;

        const favorites = getFavorites();
        const entry = favorites.find(f => f.card_id === card.id);

        // Удаляем старый статус
        cardElement.find('.card__nsl-status').remove();

        if (entry && entry.category.length > 0) {
            const mainCat = getStatusPriority(entry.category);
            const timeline = getBestTimelineItem(getTmdbId(card));
            
            let text = mainCat ? catLabel(mainCat) : '';
            if (timeline && timeline.percent > 0) {
                text += ` ${Math.round(timeline.percent)}%`;
                if (isSeries(card) && timeline.key.indexOf('_s') >= 0) {
                    const match = timeline.key.match(/_s(\d+)_e(\d+)/);
                    if (match) {
                        text = `S${match[1]}E${match[2]} ${text}`;
                    }
                }
            }

            const posClass = `pos-${cfg.nsl_status_position}`;
            const catClass = mainCat ? `cat-${mainCat}` : '';
            
            $(`<div class="card__nsl-status ${posClass} ${catClass}">${text}</div>`)
                .appendTo(cardElement.find('.card__view'));
        }
    }

    function catLabel(cat) {
        const labels = {
            favorite: '⭐',
            watching: '👁',
            planned: '📅',
            watched: '✅',
            abandoned: '🚫',
            collection: '📦'
        };
        return labels[cat] || cat;
    }

    function refreshCardUI() {
        updateCardStyles();
        // Обновляем все видимые карточки
        $('.card').each((i, el) => {
            const cardData = el.card_data;
            if (cardData) {
                updateCardStatusElement($(el), cardData);
            }
        });
    }

    // ========== ИСТОРИЯ ПРОСМОТРОВ ==========
    function addToHistory(card) {
        const history = getHistory();
        const now = Date.now();

        // Удаляем дубликат если есть
        const idx = history.findIndex(h => h.tmdb_id === getTmdbId(card));
        if (idx >= 0) {
            history.splice(idx, 1);
        }

        history.unshift({
            id: now,
            tmdb_id: getTmdbId(card),
            media_type: getMediaType(card),
            data: cleanCardData(card),
            time: now
        });

        // Ограничиваем 50 записями
        if (history.length > 50) {
            history.length = 50;
        }

        saveHistory(history);
    }

    // ========== ЛОГ ПЕРЕМЕЩЕНИЙ ==========
    function logMove(action, title, from, to) {
        try {
            const key = storageKey('move_log');
            let log = Lampa.Storage.get(key, []);
            log.unshift({
                time: Date.now(),
                action,
                title,
                from,
                to
            });
            if (log.length > 50) log.length = 50;
            Lampa.Storage.set(key, log);
        } catch(e) {}
    }

    // ========== МЕНЮ ПЛАГИНА ==========
    function createPluginMenu() {
        const cfg = getConfig();
        const favorites = getFavorites();
        const bookmarks = getBookmarks();
        const timeline = getTimeline();

        // Пункт в главном меню
        const menuBtn = $(`
            <li class="menu__item selector nsl-menu-btn">
                <div class="menu__ico">${PLUGIN_ICON}</div>
                <div class="menu__text">${PLUGIN_NAME}</div>
            </li>
        `);

        menuBtn.on('hover:enter', () => {
            showPluginSubmenu();
            Lampa.Controller.toggle('content');
        });

        $('.menu__list').first().append(menuBtn);
    }

    function showPluginSubmenu() {
        const cfg = getConfig();
        const favorites = getFavorites();
        const bookmarks = getBookmarks();
        
        const items = [];

        // Закладки разделов
        items.push({
            title: `📌 Закладки разделов (${bookmarks.length})`,
            onSelect: () => showBookmarksList()
        });

        // Избранное
        items.push({
            title: `⭐ Избранное (${favorites.length})`,
            onSelect: () => showFavoritesList()
        });

        // Таймкоды
        const timeline = getTimeline();
        items.push({
            title: `⏱️ Таймкоды (${Object.keys(timeline).length})`,
            onSelect: () => showTimelineList()
        });

        // Настройки
        items.push({
            title: '⚙️ Настройки',
            separator: true,
            onSelect: () => showSettings()
        });

        // Инструменты
        items.push({
            title: '🛠 Инструменты',
            separator: true,
            onSelect: () => showTools()
        });

        Lampa.Select.show({
            title: PLUGIN_NAME,
            items: items,
            onBack: () => {
                Lampa.Controller.toggle('menu');
            }
        });
    }

    function showBookmarksList() {
        const bookmarks = getBookmarks();
        const items = bookmarks.map(bm => ({
            title: bm.name,
            subtitle: bm.component || '',
            onSelect: () => {
                Lampa.Activity.push({
                    url: bm.url,
                    component: bm.component,
                    source: bm.source,
                    params: bm.params,
                    genres: bm.genres,
                    page: bm.page,
                    title: bm.name
                });
            },
            onLong: () => {
                const list = getBookmarks();
                const idx = list.findIndex(b => b.id === bm.id);
                if (idx >= 0) {
                    list.splice(idx, 1);
                    saveBookmarks(list);
                    updateBookmarksMenu();
                    notify('Закладка удалена');
                    Lampa.Select.close();
                }
            }
        }));

        if (items.length === 0) {
            items.push({ title: 'Нет сохранённых разделов', disabled: true });
        }

        items.push({
            title: '🗑️ Очистить все',
            separator: true,
            onSelect: () => {
                saveBookmarks([]);
                updateBookmarksMenu();
                notify('Все закладки удалены');
                Lampa.Select.close();
            }
        });

        Lampa.Select.show({
            title: '📌 Закладки разделов',
            items: items,
            onBack: () => showPluginSubmenu()
        });
    }

    function showFavoritesList() {
        const favorites = getFavorites();
        const items = [];

        // Группируем по категориям
        for (const cat of CATEGORIES) {
            const catItems = favorites.filter(f => f.category.includes(cat));
            if (catItems.length > 0) {
                items.push({ title: catLabel(cat) + ' ' + catName(cat), disabled: true, separator: true });
                catItems.forEach(entry => {
                    items.push({
                        title: entry.data.title || entry.data.original_title || 'Без названия',
                        subtitle: entry.media_type === 'tv' ? 'Сериал' : 'Фильм',
                        onSelect: () => {
                            Lampa.Activity.push({
                                url: '',
                                component: 'full',
                                source: 'tmdb',
                                card: entry.data,
                                method: entry.media_type === 'tv' ? 'tv' : 'movie',
                                id: entry.tmdb_id,
                                title: entry.data.title
                            });
                        },
                        onLong: () => {
                            showFavoriteActions(entry);
                        }
                    });
                });
            }
        }

        if (items.length === 0) {
            items.push({ title: 'Список пуст', disabled: true });
        }

        Lampa.Select.show({
            title: '⭐ Избранное',
            items: items,
            onBack: () => showPluginSubmenu()
        });
    }

    function catName(cat) {
        const names = {
            favorite: 'Избранное',
            watching: 'Смотрю',
            planned: 'Буду смотреть',
            watched: 'Просмотрено',
            abandoned: 'Брошено',
            collection: 'Коллекция'
        };
        return names[cat] || cat;
    }

    function showFavoriteActions(entry) {
        const items = CATEGORIES.map(cat => ({
            title: catName(cat),
            checkbox: true,
            checked: entry.category.includes(cat),
            cat: cat
        }));

        items.push({
            title: '🗑️ Удалить из избранного',
            separator: true,
            delete: true
        });

        Lampa.Select.show({
            title: entry.data.title,
            items: items,
            onCheck: (a) => {
                const favorites = getFavorites();
                const fav = favorites.find(f => f.id === entry.id);
                if (fav) {
                    if (a.checked) {
                        if (!fav.category.includes(a.cat)) {
                            fav.category.push(a.cat);
                        }
                    } else {
                        fav.category = fav.category.filter(c => c !== a.cat);
                    }
                    if (fav.category.length === 0) {
                        const idx = favorites.indexOf(fav);
                        favorites.splice(idx, 1);
                    }
                    fav.updated = Date.now();
                    saveFavorites(favorites);
                    refreshCardUI();
                }
            },
            onSelect: (a) => {
                if (a.delete) {
                    removeFromFavorite(entry.data);
                    notify('Удалено из избранного');
                    Lampa.Select.close();
                    setTimeout(() => showFavoritesList(), 100);
                }
            },
            onBack: () => showFavoritesList()
        });
    }

    function showTimelineList() {
        const timeline = getTimeline();
        const items = [];

        for (const [key, value] of Object.entries(timeline)) {
            const timeStr = `${Math.round(value.percent)}% (${formatTime(value.time)})`;
            items.push({
                title: key,
                subtitle: timeStr,
                onLong: () => {
                    delete timeline[key];
                    saveTimeline(timeline);
                    notify('Таймкод удалён');
                    Lampa.Select.close();
                }
            });
        }

        if (items.length === 0) {
            items.push({ title: 'Нет таймкодов', disabled: true });
        }

        items.push({
            title: '🗑️ Очистить всё',
            separator: true,
            onSelect: () => {
                saveTimeline({});
                notify('Таймкоды очищены');
                Lampa.Select.close();
            }
        });

        Lampa.Select.show({
            title: '⏱️ Таймкоды',
            items: items,
            onBack: () => showPluginSubmenu()
        });
    }

    function showSettings() {
        const cfg = getConfig();
        const items = [
            {
                title: '🎨 Отображение',
                subtitle: cfg.card_display_mode === 'nsl_status' ? 'Избранное+' : cfg.card_display_mode === 'lampa_default' ? 'Стандарт Lampa' : 'Выкл',
                onSelect: () => {
                    const modes = ['none', 'nsl_status', 'lampa_default'];
                    const idx = modes.indexOf(cfg.card_display_mode);
                    cfg.card_display_mode = modes[(idx + 1) % modes.length];
                    saveConfig(cfg);
                    refreshCardUI();
                    notify('Режим: ' + cfg.card_display_mode);
                    Lampa.Select.close();
                    setTimeout(() => showSettings(), 100);
                }
            },
            {
                title: '📌 Кнопка сохранения',
                subtitle: cfg.button_position === 'side' ? 'Боковое меню' : 'Верхняя панель',
                onSelect: () => {
                    cfg.button_position = cfg.button_position === 'side' ? 'top' : 'side';
                    saveConfig(cfg);
                    updateBookmarksMenu();
                    notify('Позиция: ' + cfg.button_position);
                    Lampa.Select.close();
                    setTimeout(() => showSettings(), 100);
                }
            },
            {
                title: '👁️ Авто в Смотрю',
                checkbox: true,
                checked: cfg.auto_watching,
                onCheck: (a) => {
                    cfg.auto_watching = a.checked;
                    saveConfig(cfg);
                }
            },
            {
                title: '✅ Авто в Просмотрено',
                checkbox: true,
                checked: cfg.auto_watched,
                onCheck: (a) => {
                    cfg.auto_watched = a.checked;
                    saveConfig(cfg);
                }
            },
            {
                title: '📊 Порог Просмотрено',
                subtitle: cfg.watched_min_progress + '%',
                onSelect: () => {
                    Lampa.Select.close();
                    // Упрощённый ввод
                    const newVal = prompt('Введите процент (0-100):', cfg.watched_min_progress);
                    if (newVal !== null && !isNaN(newVal)) {
                        cfg.watched_min_progress = Math.min(100, Math.max(0, parseInt(newVal)));
                        saveConfig(cfg);
                    }
                    setTimeout(() => showSettings(), 100);
                }
            },
            {
                title: '🔄 Синхронизация Gist',
                subtitle: cfg.gist_id ? 'Настроено' : 'Не настроено',
                onSelect: () => {
                    const token = prompt('GitHub токен:', cfg.gist_token);
                    if (token) {
                        cfg.gist_token = token;
                        const gistId = prompt('Gist ID:', cfg.gist_id);
                        if (gistId) {
                            cfg.gist_id = gistId;
                            saveConfig(cfg);
                            notify('Gist настроен');
                        }
                    }
                    setTimeout(() => showSettings(), 100);
                }
            }
        ];

        Lampa.Select.show({
            title: '⚙️ Настройки',
            items: items,
            onBack: () => showPluginSubmenu()
        });
    }

    function showTools() {
        const items = [
            {
                title: '📊 Статистика',
                onSelect: () => showStats()
            },
            {
                title: '🕐 История просмотров',
                onSelect: () => showHistoryList()
            },
            {
                title: '🧹 Очистить дубликаты',
                onSelect: () => {
                    const favorites = getFavorites();
                    const seen = new Set();
                    const unique = favorites.filter(f => {
                        const key = `${f.card_id}_${f.media_type}`;
                        if (seen.has(key)) return false;
                        seen.add(key);
                        return true;
                    });
                    saveFavorites(unique);
                    notify(`Удалено дубликатов: ${favorites.length - уникальных.length}`);
                    Lampa.Select.close();
                }
            }
        ];

        Lampa.Select.show({
            title: '🛠 Инструменты',
            items: items,
            onBack: () => showPluginSubmenu()
        });
    }

    function showStats() {
        const favorites = getFavorites();
        const timeline = getTimeline();
        let totalTime = 0;
        let watchedCount = 0;

        for (const [key, value] of Object.entries(timeline)) {
            totalTime += value.time || 0;
        }

        favorites.forEach(f => {
            if (f.category.includes('watched')) watchedCount++;
        });

        const hours = Math.floor(totalTime / 3600);
        const minutes = Math.floor((totalTime % 3600) / 60);

        const items = [
            { title: `Общее время: ${hours}ч ${minutes}м`, disabled: true },
            { title: `Просмотрено: ${watchedCount}`, disabled: true },
            { title: `В избранном: ${favorites.length}`, disabled: true },
            { title: `Таймкодов: ${Object.keys(timeline).length}`, disabled: true }
        ];

        Lampa.Select.show({
            title: '📊 Статистика',
            items: items,
            onBack: () => showTools()
        });
    }

    function showHistoryList() {
        const history = getHistory();
        const items = history.map(h => ({
            title: h.data.title || 'Без названия',
            subtitle: new Date(h.time).toLocaleString(),
            onSelect: () => {
                Lampa.Activity.push({
                    url: '',
                    component: 'full',
                    source: 'tmdb',
                    card: h.data,
                    method: h.media_type === 'tv' ? 'tv' : 'movie',
                    id: h.tmdb_id,
                    title: h.data.title
                });
            }
        }));

        if (items.length === 0) {
            items.push({ title: 'История пуста', disabled: true });
        }

        items.push({
            title: '🗑️ Очистить историю',
            separator: true,
            onSelect: () => {
                saveHistory([]);
                notify('История очищена');
                Lampa.Select.close();
            }
        });

        Lampa.Select.show({
            title: '🕐 История просмотров',
            items: items,
            onBack: () => showTools()
        });
    }

    function formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
        return `${m}:${pad(s)}`;
    }

    function pad(n) {
        return n < 10 ? '0' + n : n;
    }

    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    function init() {
        console.log('NSL', 'init plugin');

        // Создаём меню
        createPluginMenu();

        // Обновляем закладки
        updateBookmarksMenu();

        // Обновляем стили карточек
        updateCardStyles();

        // Обработчик открытия карточки
        Lampa.Listener.follow('full', (e) => {
            if (e.type === 'complite' && e.data.movie) {
                const card = e.data.movie;
                addToHistory(card);

                // Добавляем кнопку "В избранное"
                setTimeout(() => {
                    addFavoriteButton(e.object.activity.render(), card);
                }, 100);
            }
        });

        // Отслеживаем прогресс плеера
        if (Lampa.Player) {
            Lampa.Player.listener.follow('destroy', () => {
                const data = Lampa.Player.playdata();
                if (data && data.timeline && data.card) {
                    const key = getMovieKey(data.card);
                    saveProgress(
                        key,
                        data.timeline.time || 0,
                        data.timeline.percent || 0,
                        data.timeline.duration || 0,
                        getTmdbId(data.card)
                    );
                }
            });
        }

        // Отслеживаем изменения таймлайна
        Lampa.Listener.follow('state:changed', (e) => {
            if (e.target === 'timeline' && e.reason === 'update') {
                // Синхронизируем с NSL
                const timeline = getTimeline();
                const hash = e.data.hash;
                if (timeline[hash]) {
                    timeline[hash].percent = e.data.road.percent;
                    timeline[hash].time = e.data.road.time;
                    timeline[hash].duration = e.data.road.duration;
                    timeline[hash].updated = Date.now();
                    saveTimeline(timeline);
                }
            }
        });

        refreshCardUI();
        notify(`${PLUGIN_NAME} загружен`);
    }

    function addFavoriteButton(html, card) {
        // Проверяем, не скрыта ли кнопка
        if (getConfig().hide_lampa_bookmark_button) {
            html.find('.button--book').addClass('hide');
        }

        // Убираем старую кнопку если есть
        html.find('.nsl-fav-btn').remove();

        const btn = $(`
            <div class="full-start__button selector nsl-fav-btn">
                <svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                <span>В избранное</span>
            </div>
        `);

        btn.on('hover:enter', () => {
            showFavCategoriesMenu(card);
        });

        html.find('.full-start-new__buttons').append(btn);
    }

    function showFavCategoriesMenu(card) {
        const favorites = getFavorites();
        const mediaType = getMediaType(card);
        const entry = favorites.find(f => f.card_id === card.id && f.media_type === mediaType);

        const items = CATEGORIES.map(cat => ({
            title: catName(cat),
            checkbox: true,
            checked: entry ? entry.category.includes(cat) : false,
            cat: cat
        }));

        Lampa.Select.show({
            title: 'Избранное+',
            items: items,
            onCheck: (a) => {
                if (a.checked) {
                    addToFavorite(card, [a.cat]);
                } else {
                    removeFromFavorite(card, [a.cat]);
                }
                refreshCardUI();
            },
            onBack: () => {
                Lampa.Controller.toggle('content');
            }
        });
    }

    // ========== ЗАПУСК ==========
    if (window.Lampa) {
        Lampa.Listener.follow('app', (e) => {
            if (e.type === 'ready') {
                init();
            }
        });
    }
})();
