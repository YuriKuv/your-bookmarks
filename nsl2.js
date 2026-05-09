/**
 * Избранное+ (NSL) v5.0
 * Полный плагин для Lampa с интеграцией в интерфейс
 */
(function () {
    'use strict';

    if (window.nsl_plugin_loaded) return;
    window.nsl_plugin_loaded = true;

    // ========== КОНФИГУРАЦИЯ ==========
    const PLUGIN_NAME = 'Избранное+';
    const PLUGIN_VERSION = '5.0';
    
    function getProfileId() {
        try {
            const account = Lampa.Storage.get('account', {});
            return String(account.profile?.id || 'default');
        } catch(e) {
            return 'default';
        }
    }

    const PROFILE_ID = getProfileId();
    const PREFIX = (name) => `nsl_${name}_${PROFILE_ID}_v4`;
    
    const STORES = {
        bookmarks: PREFIX('bookmarks'),
        favorites: PREFIX('favorites'),
        timeline: PREFIX('timeline'),
        config: PREFIX('cfg'),
        history: `nsl_history_${PROFILE_ID}_v1`,
        moveLog: `nsl_move_log_${PROFILE_ID}_v1`,
        seriesCheck: `nsl_series_check_${PROFILE_ID}_v1`,
        hashMap: `nsl_hash_map_${PROFILE_ID}`,
        gistCache: `nsl_gist_cache_${PROFILE_ID}`
    };

    const FILE_VIEW_KEY = 'file_view' + (PROFILE_ID !== 'default' ? '_' + PROFILE_ID : '');

    // ========== КАТЕГОРИИ ==========
    const CATEGORIES = [
        { id: 'favorite', name: 'Избранное', icon: '⭐', color: '#FFC107' },
        { id: 'watching', name: 'Смотрю', icon: '👁️', color: '#4CAF50' },
        { id: 'planned', name: 'Буду смотреть', icon: '📋', color: '#FF9800' },
        { id: 'watched', name: 'Просмотрено', icon: '✅', color: '#2196F3' },
        { id: 'abandoned', name: 'Брошено', icon: '❌', color: '#f44336' },
        { id: 'collection', name: 'Коллекция', icon: '📦', color: '#9C27B0' }
    ];

    const CATEGORY_RULES = {
        abandoned: { removeFrom: ['favorite', 'watching', 'planned', 'watched'] },
        watched: { removeFrom: ['favorite', 'watching', 'planned'] },
        watching: { removeFrom: ['planned'] },
        collection: { removeFrom: [] },
        favorite: { removeFrom: [] },
        planned: { removeFrom: [] }
    };

    const STATUS_PRIORITY = { 'watching': 1, 'abandoned': 2, 'watched': 3, 'planned': 4, 'favorite': 5, 'collection': 6 };

    // ========== ИКОНКИ SVG ==========
    const ICONS = {
        star: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
        bookmark: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>',
        save: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M11 5h2v14h-2zM5 11h14v2H5z"/></svg>',
        settings: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>'
    };

    // ========== ХРАНИЛИЩЕ ==========
    function getStore(key, def = []) {
        try { return Lampa.Storage.get(key, def) || def; } catch(e) { return def; }
    }
    
    function setStore(key, value) {
        try { Lampa.Storage.set(key, value, true); } catch(e) {}
    }

    function cfg() {
        return Lampa.Storage.get(STORES.config, {
            enabled: true,
            button_position: 'side',
            gist_token: '',
            gist_id: '',
            sync_on_start: true,
            sync_on_close: false,
            sync_on_add: true,
            sync_on_remove: true,
            sync_auto_interval: true,
            sync_interval_minutes: 60,
            auto_save: true,
            auto_sync: true,
            sync_interval: 30,
            sync_strategy: 'max_time',
            auto_abandoned: false,
            abandoned_days: 30,
            auto_watching: true,
            watching_min_progress: 5,
            watching_max_progress: 95,
            auto_watched: true,
            watched_min_progress: 95,
            auto_remove_watched: false,
            auto_remove_watched_days: 90,
            show_move_notifications: true,
            cleanup_older_days: 0,
            cleanup_completed: false,
            card_display_mode: 'nsl_status',
            nsl_status_position: 'bottom',
            check_new_episodes: true,
            new_episodes_notify: true,
            new_episodes_check_interval: 24,
            hide_lampa_bookmark_button: false
        }) || {};
    }

    function saveCfg(c) { setStore(STORES.config, c); }

    // ========== УТИЛИТЫ ==========
    function notify(text) {
        if (Lampa.Noty) Lampa.Noty.show(text);
    }

    function getTmdbId(card) {
        if (!card) return null;
        if (card.tmdb_id) return String(card.tmdb_id);
        if (card.id && /^\d{6,8}$/.test(String(card.id))) return String(card.id);
        return null;
    }

    function getBaseId(tmdbId) {
        return tmdbId ? String(tmdbId).replace(/[_-].*$/, '') : null;
    }

    function isSeries(card) {
        return !!(card.original_name);
    }

    function cleanCardData(card) {
        const cleaned = {};
        const fields = ['id', 'title', 'name', 'original_title', 'original_name', 
                       'poster_path', 'backdrop_path', 'vote_average', 
                       'release_date', 'first_air_date', 'overview', 'genre_ids',
                       'source', 'animation', 'anime', 'number_of_seasons',
                       'number_of_episodes', 'last_air_date'];
        for (const f of fields) {
            if (card[f] !== undefined) cleaned[f] = card[f];
        }
        return cleaned;
    }

    function formatTime(seconds) {
        if (!seconds || seconds < 0) return '0:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
    }

    function getCategoryName(catId) {
        const cat = CATEGORIES.find(c => c.id === catId);
        return cat ? cat.name : catId;
    }

    // ========== ЗАКЛАДКИ РАЗДЕЛОВ ==========
    function getBookmarks() { return getStore(STORES.bookmarks, []); }
    function saveBookmarks(list) { setStore(STORES.bookmarks, list); updateBookmarksMenu(); }

    function makeKey(activity) {
        const parts = [activity.url || '', activity.component || '', activity.source || ''];
        if (activity.genres) parts.push(String(activity.genres));
        if (activity.params) parts.push(JSON.stringify(activity.params));
        return parts.join('|');
    }

    function saveBookmark() {
        const act = Lampa.Activity.active();
        if (!act) return;
        
        const key = makeKey(act);
        const bookmarks = getBookmarks();
        
        if (bookmarks.find(b => b.key === key)) {
            notify('Этот раздел уже сохранён');
            return;
        }

        const name = act.title || act.name || 'Без названия';
        
        Lampa.Input.edit({
            title: 'Название закладки',
            value: name,
            free: true
        }, (val) => {
            if (!val) return;
            
            bookmarks.push({
                id: Date.now(),
                key: key,
                name: val.trim(),
                url: act.url || '',
                component: act.component || '',
                source: act.source || 'tmdb',
                genres: act.genres,
                params: act.params,
                page: act.page || 1,
                created: Date.now()
            });
            
            saveBookmarks(bookmarks);
            notify('📌 Раздел сохранён');
        });
    }

    function removeBookmark(item) {
        const bookmarks = getBookmarks().filter(b => b.id !== item.id);
        saveBookmarks(bookmarks);
        notify('🗑️ Закладка удалена');
    }

    function openBookmark(item) {
        Lampa.Activity.push({
            url: item.url,
            title: item.name,
            component: item.component,
            source: item.source,
            genres: item.genres,
            params: item.params,
            page: item.page
        });
    }

    function updateBookmarksMenu() {
        // Удаляем старые элементы
        $('.nsl-bookmark-item, .nsl-save-section-btn').remove();
        
        const cfgData = cfg();
        const bookmarks = getBookmarks();
        const menuList = $('.menu__list').first();
        
        if (!menuList.length) return;

        // Добавляем закладки
        bookmarks.forEach(item => {
            const el = $(`
                <li class="menu__item selector nsl-bookmark-item">
                    <div class="menu__ico">${ICONS.bookmark}</div>
                    <div class="menu__text">${item.name}</div>
                </li>
            `);
            
            el.on('hover:enter', (e) => {
                e.stopPropagation();
                openBookmark(item);
            });
            
            el.on('hover:long', (e) => {
                e.stopPropagation();
                Lampa.Select.show({
                    title: `Удалить "${item.name}"?`,
                    items: [
                        { title: '❌ Нет', action: 'cancel' },
                        { title: '✅ Да', action: 'remove' }
                    ],
                    onSelect: (a) => {
                        if (a.action === 'remove') removeBookmark(item);
                    },
                    onBack: () => Lampa.Controller.toggle('content')
                });
            });
            
            menuList.append(el);
        });

        // Добавляем кнопку сохранения
        if (cfgData.button_position === 'side') {
            const saveBtn = $(`
                <li class="menu__item selector nsl-save-section-btn">
                    <div class="menu__ico">${ICONS.save}</div>
                    <div class="menu__text">Сохранить раздел</div>
                </li>
            `);
            
            saveBtn.on('hover:enter', (e) => {
                e.stopPropagation();
                saveBookmark();
            });
            
            menuList.prepend(saveBtn);
        }
    }

    // ========== ИЗБРАННОЕ ==========
    function getFavorites() { return getStore(STORES.favorites, []); }
    function saveFavorites(list) { setStore(STORES.favorites, list); }

    function addToFavorites(card, category) {
        if (!card || !card.id) return false;
        
        const tmdbId = getTmdbId(card) || String(card.id);
        const baseId = getBaseId(tmdbId);
        const mediaType = isSeries(card) ? 'tv' : 'movie';
        const favorites = getFavorites();
        
        // Применяем правила авто-удаления
        const rules = CATEGORY_RULES[category];
        if (rules) {
            for (const catToRemove of rules.removeFrom) {
                const idx = favorites.findIndex(f => 
                    getBaseId(f.tmdb_id) === baseId && f.category === catToRemove
                );
                if (idx >= 0) favorites.splice(idx, 1);
            }
        }
        
        // Проверяем существование
        const exists = favorites.find(f => 
            getBaseId(f.tmdb_id) === baseId && f.category === category
        );
        
        if (!exists) {
            favorites.push({
                id: Date.now(),
                card_id: card.id,
                tmdb_id: tmdbId,
                media_type: mediaType,
                category: category,
                data: cleanCardData(card),
                added: Date.now(),
                updated: Date.now()
            });
            
            const title = card.title || card.name || 'Без названия';
            logMove('add', title, null, category);
        }
        
        saveFavorites(favorites);
        refreshNewEpisodesBadge();
        return true;
    }

    function removeFromFavorites(card, category) {
        const baseId = getBaseId(getTmdbId(card));
        const favorites = getFavorites();
        const idx = favorites.findIndex(f => 
            getBaseId(f.tmdb_id) === baseId && f.category === category
        );
        
        if (idx >= 0) {
            favorites.splice(idx, 1);
            saveFavorites(favorites);
            refreshNewEpisodesBadge();
            return true;
        }
        return false;
    }

    function isInFavorites(card, category) {
        const baseId = getBaseId(getTmdbId(card));
        return getFavorites().some(f => 
            getBaseId(f.tmdb_id) === baseId && f.category === category
        );
    }

    function getFavoritesByCategory(catId) {
        return getFavorites().filter(f => f.category === catId);
    }

    function deleteCompletely(item) {
        const baseId = getBaseId(item.tmdb_id);
        const title = item.data?.title || item.data?.name || 'Без названия';
        
        // Удаляем из избранного
        let favorites = getFavorites().filter(f => getBaseId(f.tmdb_id) !== baseId);
        saveFavorites(favorites);
        
        // Удаляем таймкоды
        const timeline = getTimeline();
        for (const key in timeline) {
            if (getBaseId(timeline[key]?.tmdb_id) === baseId || getBaseId(key) === baseId) {
                delete timeline[key];
            }
        }
        saveTimeline(timeline);
        
        // Удаляем из истории
        const history = getHistory().filter(h => getBaseId(h.tmdb_id) !== baseId);
        saveHistory(history);
        
        logMove('delete', title, item.category, null);
        refreshNewEpisodesBadge();
        notify(`🗑️ "${title}" удалён полностью`);
    }

    // ========== ТАЙМКОДЫ ==========
    function getTimeline() { return getStore(STORES.timeline, {}); }
    function saveTimeline(data) { setStore(STORES.timeline, data); }

    function getMovieKey(card) {
        const tmdbId = getTmdbId(card);
        if (!tmdbId) return null;
        
        if (isSeries(card)) {
            const season = card.season_number || card.season || 1;
            const episode = card.episode_number || card.episode || 1;
            return `${tmdbId}_s${season}_e${episode}`;
        }
        return tmdbId;
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
        
        // Синхронизация с file_view
        writeToFileView(movieKey, time, duration, percent);
        
        // Синхронизация с Lampa Timeline
        if (Lampa.Timeline && typeof Lampa.Timeline.update === 'function') {
            try {
                Lampa.Timeline.update({ 
                    hash: movieKey, 
                    percent, 
                    time, 
                    duration 
                });
            } catch(e) {}
        }
    }

    function writeToFileView(key, time, duration, percent) {
        const record = { 
            time, 
            duration: duration || 0, 
            percent: percent || 0, 
            profile: getProfileId() 
        };
        
        const fv1 = Lampa.Storage.get('file_view', {});
        const fv2 = Lampa.Storage.get(FILE_VIEW_KEY, {});
        
        fv1[key] = record;
        fv2[key] = record;
        
        Lampa.Storage.set('file_view', fv1, true);
        Lampa.Storage.set(FILE_VIEW_KEY, fv2, true);
    }

    function getBestTimelineItem(tmdbId) {
        const timeline = getTimeline();
        const baseId = getBaseId(tmdbId);
        let bestKey = '', bestItem = null, bestPriority = -1, bestTime = 0, bestUpdated = 0;
        const strategy = cfg().sync_strategy;
        
        for (const key in timeline) {
            if (getBaseId(timeline[key]?.tmdb_id) !== baseId) continue;
            
            const item = timeline[key];
            const isEpisode = key.includes('_s') && key.includes('_e');
            let priority = bestPriority;
            
            if (isEpisode) {
                const match = key.match(/_s(\d+)_e(\d+)/);
                if (match) {
                    priority = parseInt(match[1]) * 1000 + parseInt(match[2]);
                }
            } else {
                priority = 0;
            }
            
            let shouldUpdate = false;
            if (priority > bestPriority) {
                shouldUpdate = true;
            } else if (priority === bestPriority) {
                if (strategy === 'max_time') {
                    shouldUpdate = (item.time || 0) > bestTime;
                } else {
                    shouldUpdate = (item.updated || 0) > bestUpdated;
                }
            }
            
            if (shouldUpdate) {
                bestPriority = priority;
                bestTime = item.time || 0;
                bestUpdated = item.updated || 0;
                bestItem = item;
                bestKey = key;
            }
        }
        
        return { key: bestKey, item: bestItem };
    }

    // ========== ИСТОРИЯ ==========
    function getHistory() { return getStore(STORES.history, []); }
    function saveHistory(list) { 
        if (list.length > 50) list = list.slice(-50);
        setStore(STORES.history, list); 
    }

    function addToHistory(card) {
        if (!card || !card.id) return;
        
        const history = getHistory();
        const idx = history.findIndex(h => h.tmdb_id === getTmdbId(card));
        if (idx >= 0) history.splice(idx, 1);
        
        history.unshift({
            id: Date.now(),
            tmdb_id: getTmdbId(card),
            media_type: isSeries(card) ? 'tv' : 'movie',
            data: cleanCardData(card),
            time: Date.now()
        });
        
        if (history.length > 50) history.length = 50;
        saveHistory(history);
    }

    // ========== ЛОГ ПЕРЕМЕЩЕНИЙ ==========
    function getMoveLog() { return getStore(STORES.moveLog, []); }
    
    function logMove(action, title, from, to) {
        const log = getMoveLog();
        log.push({
            time: Date.now(),
            action,
            title,
            from: from || 'none',
            to: to || 'none'
        });
        if (log.length > 50) log.length = 50;
        setStore(STORES.moveLog, log);
        
        if (cfg().show_move_notifications && from) {
            const messages = {
                add: `⭐ "${title}" → ${getCategoryName(to)}`,
                move: `📦 "${title}" → ${getCategoryName(to)}`,
                delete: `🗑️ "${title}" удалён`
            };
            if (messages[action]) notify(messages[action]);
        }
    }

    // ========== ОТОБРАЖЕНИЕ НА КАРТОЧКАХ ==========
    function getCardStyles() {
        const c = cfg();
        if (c.card_display_mode === 'nsl_status') {
            return `
                .card .card-watched, .card-watched__item, .card .icon--history { display: none !important; }
                .nsl-card-status {
                    position: absolute;
                    left: 0.8em;
                    right: 0.8em;
                    z-index: 5;
                    display: flex;
                    align-items: flex-start;
                    gap: 0.4em;
                    padding: 0.5em 0.8em;
                    background: rgba(0,0,0,0.75);
                    backdrop-filter: blur(4px);
                    -webkit-backdrop-filter: blur(4px);
                    border-radius: 0.5em;
                    pointer-events: none;
                    font-size: 0.7em;
                    line-height: 1.5;
                }
                .nsl-card-status__icon { flex-shrink: 0; font-size: 1.2em; }
                .nsl-card-status__text {
                    color: #fff;
                    font-weight: 500;
                    text-align: left;
                    flex: 1;
                    min-width: 0;
                    display: flex;
                    flex-direction: column;
                }
                .nsl-card-status--top { top: 0.5em; }
                .nsl-card-status--center { top: 50%; transform: translateY(-50%); }
                .nsl-card-status--bottom { bottom: 2.5em; }
            `;
        }
        return '.nsl-card-status { display: none !important; }';
    }

    function updateCardStyles() {
        let styleEl = document.getElementById('nsl-card-styles');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'nsl-card-styles';
            document.head.appendChild(styleEl);
        }
        styleEl.textContent = getCardStyles();
    }

    function updateCardStatus(cardElement, cardData) {
        if (!cardElement || !cardData || cfg().card_display_mode !== 'nsl_status') {
            const existing = cardElement.querySelector('.nsl-card-status');
            if (existing) existing.remove();
            return;
        }
        
        const tmdbId = getTmdbId(cardData);
        if (!tmdbId) return;
        
        const baseId = getBaseId(tmdbId);
        const favorites = getFavorites();
        const favItems = favorites.filter(f => getBaseId(f.tmdb_id) === baseId);
        
        if (!favItems.length) {
            const existing = cardElement.querySelector('.nsl-card-status');
            if (existing) existing.remove();
            return;
        }
        
        // Определяем главную категорию
        let mainCat = null;
        let bestPriority = 999;
        for (const item of favItems) {
            const priority = STATUS_PRIORITY[item.category] || 999;
            if (priority < bestPriority) {
                bestPriority = priority;
                mainCat = item.category;
            }
        }
        
        // Если только collection и что-то ещё - показываем другое
        if (mainCat === 'collection' && favItems.length > 1) {
            for (const item of favItems) {
                if (item.category !== 'collection') {
                    mainCat = item.category;
                    break;
                }
            }
        }
        
        const catInfo = CATEGORIES.find(c => c.id === mainCat);
        if (!catInfo) return;
        
        // Получаем информацию о таймкодах
        const bestTimeline = getBestTimelineItem(tmdbId);
        let statusText = catInfo.name;
        let extraInfo = '';
        
        if (bestTimeline.item && bestTimeline.item.time > 0) {
            const match = bestTimeline.key.match(/_s(\d+)_e(\d+)/);
            if (match) {
                statusText = `С${match[1]}E${match[2]}`;
                extraInfo = `${Math.round(bestTimeline.item.percent)}%`;
            } else if (bestTimeline.item.percent > 0) {
                extraInfo = `${Math.round(bestTimeline.item.percent)}%`;
            }
        }
        
        const position = cfg().nsl_status_position || 'bottom';
        const html = `
            <span class="nsl-card-status__icon">${catInfo.icon}</span>
            <span class="nsl-card-status__text">
                <span>${statusText}</span>
                ${extraInfo ? `<span>${extraInfo}</span>` : ''}
            </span>
        `;
        
        let existing = cardElement.querySelector('.nsl-card-status');
        if (existing) {
            existing.innerHTML = html;
        } else {
            const div = document.createElement('div');
            div.className = `nsl-card-status nsl-card-status--${position}`;
            div.innerHTML = html;
            const viewEl = cardElement.querySelector('.card__view');
            if (viewEl) viewEl.appendChild(div);
        }
    }

    function refreshAllCards() {
        document.querySelectorAll('.card').forEach(card => {
            const data = card.card_data || card._data;
            if (data) updateCardStatus(card, data);
        });
    }

    // ========== НОВЫЕ СЕРИИ ==========
    function getSeriesCheck() { return getStore(STORES.seriesCheck, {}); }
    function saveSeriesCheck(data) { setStore(STORES.seriesCheck, data); }

    function getNewEpisodesCount() {
        if (!cfg().check_new_episodes) return 0;
        let count = 0;
        const sc = getSeriesCheck();
        for (const key in sc) {
            if (sc[key].has_new) count++;
        }
        return count;
    }

    function refreshNewEpisodesBadge() {
        const badgeEl = $('.nsl-favorites-item .menu__text');
        if (!badgeEl.length) return;
        
        badgeEl.find('.nsl-badge').remove();
        const count = getNewEpisodesCount();
        
        if (count > 0) {
            badgeEl.append(
                `<span class="nsl-badge" style="background:#f44336;color:#fff;border-radius:50%;padding:0 0.3em;font-size:0.8em;margin-left:0.5em;">🔔${count}</span>`
            );
        }
    }

    // ========== МЕНЮ ПЛАГИНА ==========
    function addFavoritesToMenu() {
        const menuList = $('.menu__list').eq(0);
        if (!menuList.length || $('.nsl-favorites-item').length) return;
        
        const newCount = getNewEpisodesCount();
        const badge = newCount > 0 
            ? ` <span class="nsl-badge" style="background:#f44336;color:#fff;border-radius:50%;padding:0 0.3em;font-size:0.8em;">🔔${newCount}</span>` 
            : '';
        
        const el = $(`
            <li class="menu__item selector nsl-favorites-item">
                <div class="menu__ico">${ICONS.star}</div>
                <div class="menu__text">Избранное+${badge}</div>
            </li>
        `);
        
        el.on('hover:enter', (e) => {
            e.stopPropagation();
            showMainMenu();
            Lampa.Controller.toggle('content');
        });
        
        menuList.append(el);
    }

    function addSettingsToMenu() {
        const menuList = $('.menu__list').last();
        if (!menuList.length || $('.nsl-settings-item').length) return;
        
        const el = $(`
            <li class="menu__item selector nsl-settings-item">
                <div class="menu__ico">${ICONS.settings}</div>
                <div class="menu__text">${PLUGIN_NAME}</div>
            </li>
        `);
        
        el.on('hover:enter', (e) => {
            e.stopPropagation();
            showMainMenu();
        });
        
        menuList.append(el);
    }

    function showMainMenu() {
        const c = cfg();
        const favorites = getFavorites();
        const bookmarks = getBookmarks();
        const timeline = getTimeline();
        const newCount = getNewEpisodesCount();
        
        const items = [
            {
                title: `📌 Закладки разделов (${bookmarks.length})`,
                onSelect: () => showBookmarksMenu()
            },
            {
                title: `⭐ Избранное (${favorites.length})${newCount > 0 ? ` 🔔${newCount}` : ''}`,
                onSelect: () => showFavoritesMenu()
            },
            {
                title: `⏱️ Таймкоды (${Object.keys(timeline).length})`,
                onSelect: () => showTimelineMenu()
            },
            { title: '──────────', separator: true },
            {
                title: '☁️ GitHub Gist',
                subtitle: c.gist_id ? 'Настроен' : 'Не настроен',
                onSelect: () => showGistMenu()
            },
            { title: '──────────', separator: true },
            {
                title: `🎨 Отображение: ${c.card_display_mode === 'nsl_status' ? 'Избранное+' : c.card_display_mode === 'lampa_default' ? 'Стандарт' : 'Выкл'}`,
                onSelect: () => toggleCardDisplay()
            },
            {
                title: `📍 Позиция статуса: ${c.nsl_status_position === 'top' ? 'Сверху' : c.nsl_status_position === 'center' ? 'По центру' : 'Снизу'}`,
                onSelect: () => toggleStatusPosition()
            },
            { title: '──────────', separator: true },
            {
                title: `🔔 Новые серии: ${c.check_new_episodes ? 'Вкл' : 'Выкл'}`,
                onSelect: () => {
                    c.check_new_episodes = !c.check_new_episodes;
                    saveCfg(c);
                    notify(`Проверка новых серий: ${c.check_new_episodes ? 'Вкл' : 'Выкл'}`);
                    showMainMenu();
                }
            },
            {
                title: `👁 Скрыть кнопку: ${c.hide_lampa_bookmark_button ? 'Да' : 'Нет'}`,
                onSelect: () => {
                    c.hide_lampa_bookmark_button = !c.hide_lampa_bookmark_button;
                    saveCfg(c);
                    applyHideLampaElements();
                    showMainMenu();
                }
            },
            { title: '──────────', separator: true },
            {
                title: '🧹 Очистить дубликаты',
                onSelect: () => {
                    const removed = cleanupDuplicates();
                    notify(removed ? '🧹 Дубликаты очищены' : '✅ Дубликатов нет');
                    showMainMenu();
                }
            },
            {
                title: '📋 Лог перемещений',
                onSelect: () => showMoveLog()
            },
            { title: '❌ Закрыть', onSelect: () => Lampa.Controller.toggle('content') }
        ];
        
        Lampa.Select.show({
            title: PLUGIN_NAME,
            items: items,
            onBack: () => Lampa.Controller.toggle('content')
        });
    }

    function showBookmarksMenu() {
        const bookmarks = getBookmarks();
        const items = bookmarks.map(bm => ({
            title: bm.name,
            onSelect: () => openBookmark(bm),
            onLong: () => {
                Lampa.Select.show({
                    title: `Удалить "${bm.name}"?`,
                    items: [
                        { title: '✅ Да', action: 'remove' },
                        { title: '❌ Нет', action: 'cancel' }
                    ],
                    onSelect: (a) => {
                        if (a.action === 'remove') {
                            removeBookmark(bm);
                            Lampa.Select.close();
                            setTimeout(() => showBookmarksMenu(), 100);
                        }
                    },
                    onBack: () => Lampa.Controller.toggle('content')
                });
            }
        }));
        
        if (items.length === 0) {
            items.push({ title: 'Нет сохранённых разделов', disabled: true });
        }
        
        items.push(
            { title: '──────────', separator: true },
            { title: '📌 Сохранить текущий раздел', onSelect: () => { saveBookmark(); setTimeout(() => showBookmarksMenu(), 500); } },
            { title: '🗑️ Очистить все', onSelect: () => {
                saveBookmarks([]);
                notify('Все закладки удалены');
                showBookmarksMenu();
            }},
            { title: '◀ Назад', onSelect: () => showMainMenu() }
        );
        
        Lampa.Select.show({
            title: '📌 Закладки разделов',
            items: items,
            onBack: () => showMainMenu()
        });
    }

    function showFavoritesMenu() {
        const items = CATEGORIES.map(cat => ({
            title: `${cat.icon} ${cat.name} (${getFavoritesByCategory(cat.id).length})`,
            onSelect: () => showCategoryItems(cat.id)
        }));
        
        const newCount = getNewEpisodesCount();
        if (newCount > 0) {
            items.push(
                { title: '──────────', separator: true },
                { title: `🔔 Новые серии (${newCount})`, onSelect: () => showNewEpisodes() }
            );
        }
        
        items.push(
            { title: '──────────', separator: true },
            { title: '◀ Назад', onSelect: () => showMainMenu() }
        );
        
        Lampa.Select.show({
            title: '⭐ Избранное',
            items: items,
            onBack: () => showMainMenu()
        });
    }

    function showCategoryItems(catId) {
        const items = getFavoritesByCategory(catId);
        const catName = getCategoryName(catId);
        
        if (!items.length) {
            notify(`В категории "${catName}" ничего нет`);
            showFavoritesMenu();
            return;
        }
        
        const menuItems = items.map(item => ({
            title: item.data?.title || item.data?.name || 'Без названия',
            subtitle: isSeries(item.data) ? 'Сериал' : 'Фильм',
            item: item,
            onSelect: () => {
                Lampa.Activity.push({
                    url: '',
                    component: 'full',
                    source: 'tmdb',
                    card: item.data,
                    method: isSeries(item.data) ? 'tv' : 'movie',
                    id: getBaseId(item.tmdb_id),
                    title: item.data?.title || item.data?.name
                });
            },
            onLong: () => showItemActions(item, catId)
        }));
        
        menuItems.push(
            { title: '──────────', separator: true },
            { title: '◀ Назад', onSelect: () => showFavoritesMenu() }
        );
        
        Lampa.Select.show({
            title: `${catName} (${items.length})`,
            items: menuItems,
            onBack: () => showFavoritesMenu()
        });
    }

    function showItemActions(item, currentCat) {
        const moveItems = CATEGORIES
            .filter(c => c.id !== currentCat)
            .map(cat => ({
                title: `${cat.icon} ${cat.name}`,
                category: cat.id,
                onSelect: () => {
                    const favorites = getFavorites();
                    const baseId = getBaseId(item.tmdb_id);
                    const target = favorites.find(f => 
                        getBaseId(f.tmdb_id) === baseId && f.category === currentCat
                    );
                    
                    if (target) {
                        target.category = cat.id;
                        target.updated = Date.now();
                        
                        // Применяем правила
                        const rules = CATEGORY_RULES[cat.id];
                        if (rules) {
                            for (const catToRemove of rules.removeFrom) {
                                const idx = favorites.findIndex(f => 
                                    getBaseId(f.tmdb_id) === baseId && f.category === catToRemove
                                );
                                if (idx >= 0) favorites.splice(idx, 1);
                            }
                        }
                        
                        saveFavorites(favorites);
                        notify(`📦 "${target.data?.title}" → ${cat.name}`);
                        refreshNewEpisodesBadge();
                    }
                    
                    Lampa.Select.close();
                    setTimeout(() => showCategoryItems(currentCat), 100);
                }
            }));
        
        const actions = [
            ...moveItems,
            { title: '──────────', separator: true },
            {
                title: '🗑️ Удалить из категории',
                onSelect: () => {
                    removeFromFavorites(item.data, currentCat);
                    notify(`Удалено из "${getCategoryName(currentCat)}"`);
                    Lampa.Select.close();
                    setTimeout(() => showCategoryItems(currentCat), 100);
                }
            },
            {
                title: '💥 Полностью удалить',
                onSelect: () => {
                    Lampa.Select.show({
                        title: 'Удалить полностью?',
                        items: [
                            { title: '✅ Да, удалить всё', action: 'confirm' },
                            { title: '❌ Отмена', action: 'cancel' }
                        ],
                        onSelect: (a) => {
                            if (a.action === 'confirm') {
                                deleteCompletely(item);
                                Lampa.Select.close();
                                setTimeout(() => showCategoryItems(currentCat), 100);
                            }
                        },
                        onBack: () => Lampa.Controller.toggle('content')
                    });
                }
            }
        ];
        
        Lampa.Select.show({
            title: item.data?.title || 'Действия',
            items: actions,
            onBack: () => Lampa.Controller.toggle('content')
        });
    }

    function showToolsMenu() {
        const items = [
            { title: '▶ Продолжить просмотр', onSelect: () => continueWatching() },
            { title: '🎲 Случайный фильм', onSelect: () => randomMovie() },
            { title: '📊 Статистика', onSelect: () => showStats() },
            { title: '🕐 История просмотров', onSelect: () => showHistory() },
            { title: '──────────', separator: true },
            { title: '◀ Назад', onSelect: () => showMainMenu() }
        ];
        
        Lampa.Select.show({
            title: '🔧 Инструменты',
            items: items,
            onBack: () => showMainMenu()
        });
    }

    function toggleCardDisplay() {
        const c = cfg();
        const modes = ['none', 'nsl_status', 'lampa_default'];
        const names = ['Выкл', 'Избранное+', 'Стандарт Lampa'];
        const idx = modes.indexOf(c.card_display_mode);
        c.card_display_mode = modes[(idx + 1) % 3];
        saveCfg(c);
        updateCardStyles();
        refreshAllCards();
        notify(`Отображение: ${names[(idx + 1) % 3]}`);
        showMainMenu();
    }

    function toggleStatusPosition() {
        const c = cfg();
        const positions = ['top', 'center', 'bottom'];
        const names = ['Сверху', 'По центру', 'Снизу'];
        const idx = positions.indexOf(c.nsl_status_position);
        c.nsl_status_position = positions[(idx + 1) % 3];
        saveCfg(c);
        updateCardStyles();
        refreshAllCards();
        notify(`Позиция: ${names[(idx + 1) % 3]}`);
        showMainMenu();
    }

    function showGistMenu() {
        const c = cfg();
        const items = [
            { title: `🔑 Токен: ${c.gist_token ? '✓ Установлен' : '❌ Не задан'}`, onSelect: () => {
                Lampa.Input.edit({
                    title: 'GitHub Token',
                    value: c.gist_token || '',
                    free: true
                }, (val) => {
                    if (val !== null) {
                        c.gist_token = val;
                        saveCfg(c);
                        notify(val ? 'Токен сохранён' : 'Токен очищен');
                    }
                    showGistMenu();
                });
            }},
            { title: `📄 Gist ID: ${c.gist_id ? c.gist_id.substring(0, 8) + '...' : '❌ Не задан'}`, onSelect: () => {
                Lampa.Input.edit({
                    title: 'Gist ID',
                    value: c.gist_id || '',
                    free: true
                }, (val) => {
                    if (val !== null) {
                        c.gist_id = val;
                        saveCfg(c);
                        notify(val ? 'Gist ID сохранён' : 'Gist ID очищен');
                    }
                    showGistMenu();
                });
            }},
            { title: '──────────', separator: true },
            { title: '📤 Отправить на Gist', onSelect: () => {
                syncToGist('favorites');
                syncToGist('timeline');
                syncToGist('bookmarks');
                notify('📤 Отправлено');
                showGistMenu();
            }},
            { title: '📥 Загрузить с Gist', onSelect: () => {
                syncFromGist(true);
                setTimeout(() => showGistMenu(), 1500);
            }},
            { title: '──────────', separator: true },
            { title: '💾 Экспорт в файл', onSelect: () => exportToFile() },
            { title: '📂 Импорт из файла', onSelect: () => importFromFile() },
            { title: '──────────', separator: true },
            { title: '◀ Назад', onSelect: () => showMainMenu() }
        ];
        
        Lampa.Select.show({
            title: '☁️ GitHub Gist',
            items: items,
            onBack: () => showMainMenu()
        });
    }

    function showTimelineMenu() {
        const timeline = getTimeline();
        const items = [];
        
        for (const [key, value] of Object.entries(timeline)) {
            items.push({
                title: key,
                subtitle: `${Math.round(value.percent || 0)}% (${formatTime(value.time || 0)})`,
                onLong: () => {
                    delete timeline[key];
                    saveTimeline(timeline);
                    notify('Таймкод удалён');
                    Lampa.Select.close();
                    setTimeout(() => showTimelineMenu(), 100);
                }
            });
        }
        
        if (items.length === 0) {
            items.push({ title: 'Нет таймкодов', disabled: true });
        }
        
        items.push(
            { title: '──────────', separator: true },
            { title: '🗑️ Очистить все', onSelect: () => {
                saveTimeline({});
                notify('Таймкоды очищены');
                showTimelineMenu();
            }},
            { title: '◀ Назад', onSelect: () => showMainMenu() }
        );
        
        Lampa.Select.show({
            title: '⏱️ Таймкоды',
            items: items,
            onBack: () => showMainMenu()
        });
    }

    function showNewEpisodes() {
        const sc = getSeriesCheck();
        const favs = getFavorites();
        const newItems = [];
        
        for (const key in sc) {
            if (sc[key].has_new) {
                const item = favs.find(f => getBaseId(f.tmdb_id) === key);
                if (item) {
                    newItems.push({
                        ...item,
                        newSeasons: sc[key].new_seasons,
                        oldSeasons: sc[key].old_seasons
                    });
                }
            }
        }
        
        if (!newItems.length) {
            notify('Нет новых серий');
            showFavoritesMenu();
            return;
        }
        
        const menuItems = newItems.map(item => ({
            title: `${item.data?.title || 'Без названия'} +${item.newSeasons - item.oldSeasons} сезон`,
            onSelect: () => {
                Lampa.Activity.push({
                    url: '',
                    component: 'full',
                    source: 'tmdb',
                    card: item.data,
                    method: 'tv',
                    id: getBaseId(item.tmdb_id),
                    title: item.data?.title
                });
            }
        }));
        
        menuItems.push(
            { title: '──────────', separator: true },
            { title: '✅ Отметить просмотренными', onSelect: () => {
                for (const key in sc) {
                    sc[key].has_new = false;
                }
                saveSeriesCheck(sc);
                refreshNewEpisodesBadge();
                notify('Отмечено');
                showFavoritesMenu();
            }},
            { title: '◀ Назад', onSelect: () => showFavoritesMenu() }
        );
        
        Lampa.Select.show({
            title: '🔔 Новые серии',
            items: menuItems,
            onBack: () => showFavoritesMenu()
        });
    }

    function showHistory() {
        const history = getHistory();
        
        if (!history.length) {
            notify('История пуста');
            return;
        }
        
        const items = history.map(h => ({
            title: h.data?.title || h.data?.name || 'Без названия',
            subtitle: new Date(h.time).toLocaleString(),
            onSelect: () => {
                Lampa.Activity.push({
                    url: '',
                    component: 'full',
                    source: 'tmdb',
                    card: h.data,
                    method: h.media_type === 'tv' ? 'tv' : 'movie',
                    id: getBaseId(h.tmdb_id),
                    title: h.data?.title
                });
            }
        }));
        
        items.push(
            { title: '──────────', separator: true },
            { title: '🗑️ Очистить историю', onSelect: () => {
                saveHistory([]);
                notify('История очищена');
                showHistory();
            }},
            { title: '◀ Назад', onSelect: () => showMainMenu() }
        );
        
        Lampa.Select.show({
            title: '🕐 История просмотров',
            items: items,
            onBack: () => showMainMenu()
        });
    }

    function showStats() {
        const timeline = getTimeline();
        const favorites = getFavorites();
        
        let totalTime = 0;
        let movieCount = 0;
        let episodeCount = 0;
        
        for (const key in timeline) {
            if (timeline[key].time > 0) {
                totalTime += timeline[key].time;
                if (key.includes('_s')) episodeCount++;
                else movieCount++;
            }
        }
        
        const hours = Math.floor(totalTime / 3600);
        const minutes = Math.floor((totalTime % 3600) / 60);
        
        const items = [
            { title: `⏱️ Общее время: ${hours}ч ${minutes}м`, disabled: true },
            { title: `🎬 Фильмов: ${movieCount}`, disabled: true },
            { title: `📺 Эпизодов: ${episodeCount}`, disabled: true },
            { title: `⭐ В избранном: ${favorites.length}`, disabled: true },
            { title: `📊 Таймкодов: ${Object.keys(timeline).length}`, disabled: true },
            { title: '──────────', separator: true },
            { title: '◀ Назад', onSelect: () => showMainMenu() }
        ];
        
        Lampa.Select.show({
            title: '📊 Статистика',
            items: items,
            onBack: () => showMainMenu()
        });
    }

    function showMoveLog() {
        const log = getMoveLog().slice(-30).reverse();
        
        if (!log.length) {
            notify('Лог пуст');
            showMainMenu();
            return;
        }
        
        const items = log.map(entry => ({
            title: `${entry.action}: ${entry.title}`,
            subtitle: `${entry.from} → ${entry.to} | ${new Date(entry.time).toLocaleString()}`
        }));
        
        items.push(
            { title: '──────────', separator: true },
            { title: '🗑️ Очистить лог', onSelect: () => {
                setStore(STORES.moveLog, []);
                notify('Лог очищен');
                showMainMenu();
            }},
            { title: '◀ Назад', onSelect: () => showMainMenu() }
        );
        
        Lampa.Select.show({
            title: '📋 Лог перемещений',
            items: items,
            onBack: () => showMainMenu()
        });
    }

    function continueWatching() {
        const timeline = getTimeline();
        const favorites = getFavorites();
        let bestItem = null;
        let bestTime = 0;
        
        favorites.filter(f => f.category === 'watching').forEach(f => {
            const baseId = getBaseId(f.tmdb_id);
            for (const key in timeline) {
                if (getBaseId(timeline[key]?.tmdb_id) === baseId) {
                    const t = timeline[key];
                    if ((t.updated || 0) > bestTime && (t.percent || 0) >= 5) {
                        bestTime = t.updated || 0;
                        bestItem = f;
                    }
                }
            }
        });
        
        if (!bestItem) {
            notify('Нет фильмов для продолжения');
            return;
        }
        
        Lampa.Activity.push({
            url: '',
            component: 'full',
            source: 'tmdb',
            card: bestItem.data,
            method: isSeries(bestItem.data) ? 'tv' : 'movie',
            id: getBaseId(bestItem.tmdb_id),
            title: bestItem.data?.title
        });
        
        notify(`▶ ${bestItem.data?.title || 'Без названия'}`);
    }

    function randomMovie() {
        const pool = getFavorites().filter(f => 
            f.category === 'planned' || f.category === 'favorite'
        );
        
        if (!pool.length) {
            notify('Нет фильмов в "Буду смотреть" или "Избранном"');
            return;
        }
        
        const random = pool[Math.floor(Math.random() * pool.length)];
        Lampa.Activity.push({
            url: '',
            component: 'full',
            source: 'tmdb',
            card: random.data,
            method: isSeries(random.data) ? 'tv' : 'movie',
            id: getBaseId(random.tmdb_id),
            title: random.data?.title
        });
    }

    function cleanupDuplicates() {
        const favorites = getFavorites();
        const seen = new Map();
        let changed = false;
        
        for (const item of favorites) {
            const baseId = getBaseId(item.tmdb_id);
            const key = `${baseId}_${item.category}`;
            
            if (seen.has(key)) {
                const existing = seen.get(key);
                if ((item.updated || 0) > (existing.updated || 0)) {
                    // Текущий новее - удаляем старый
                    seen.set(key, item);
                }
                changed = true;
            } else {
                seen.set(key, item);
            }
        }
        
        if (changed) {
            const unique = Array.from(seen.values());
            saveFavorites(unique);
            logMove('cleanup', 'Система', null, null);
        }
        
        return changed;
    }

    function exportToFile() {
        const data = {
            version: 5,
            profile_id: PROFILE_ID,
            updated: new Date().toISOString(),
            bookmarks: getBookmarks(),
            favorites: getFavorites(),
            timeline: getTimeline(),
            history: getHistory()
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `nsl_backup_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        notify('💾 Экспортировано');
    }

    function importFromFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.style.display = 'none';
        document.body.appendChild(input);
        
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) {
                document.body.removeChild(input);
                return;
            }
            
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target.result);
                    if (data.bookmarks) saveBookmarks(data.bookmarks);
                    if (data.favorites) saveFavorites(data.favorites);
                    if (data.timeline) saveTimeline(data.timeline);
                    if (data.history) saveHistory(data.history);
                    
                    cleanupDuplicates();
                    updateBookmarksMenu();
                    refreshNewEpisodesBadge();
                    notify('📥 Импортировано');
                } catch(e) {
                    notify('❌ Ошибка чтения файла');
                }
                document.body.removeChild(input);
            };
            reader.readAsText(file);
        };
        
        input.click();
    }

    // ========== GIST СИНХРОНИЗАЦИЯ ==========
    function syncToGist(type) {
        const c = cfg();
        if (!c.gist_token || !c.gist_id) return;
        
        let fileName, data;
        
        if (type === 'favorites') {
            fileName = 'nsl_favorites.json';
            data = {
                version: 5,
                profile_id: PROFILE_ID,
                updated: new Date().toISOString(),
                bookmarks: getBookmarks(),
                favorites: getFavorites()
            };
        } else if (type === 'timeline') {
            fileName = 'nsl_timeline.json';
            data = {
                version: 5,
                profile_id: PROFILE_ID,
                updated: new Date().toISOString(),
                timeline: getTimeline()
            };
        } else if (type === 'bookmarks') {
            fileName = 'nsl_bookmarks.json';
            data = {
                version: 5,
                profile_id: PROFILE_ID,
                updated: new Date().toISOString(),
                bookmarks: getBookmarks()
            };
        } else {
            return;
        }
        
        $.ajax({
            url: `https://api.github.com/gists/${c.gist_id}`,
            method: 'PATCH',
            headers: {
                'Authorization': `token ${c.gist_token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            data: JSON.stringify({
                files: {
                    [fileName]: { content: JSON.stringify(data) }
                }
            }),
            success: () => {
                setStore(STORES.gistCache + '_last_sync', Date.now());
            },
            error: (xhr) => {
                console.log('[NSL] Gist sync error:', xhr.status);
            },
            timeout: 15000
        });
    }

    function syncFromGist(showNotify) {
        const c = cfg();
        if (!c.gist_token || !c.gist_id) {
            if (showNotify) notify('⚠️ GitHub Gist не настроен');
            return;
        }
        
        $.ajax({
            url: `https://api.github.com/gists/${c.gist_id}`,
            method: 'GET',
            headers: {
                'Authorization': `token ${c.gist_token}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            timeout: 20000,
            success: (data) => {
                try {
                    let changed = false;
                    
                    const favContent = data.files?.['nsl_favorites.json']?.content;
                    if (favContent) {
                        const favData = JSON.parse(favContent);
                        if (favData.favorites) { saveFavorites(favData.favorites); changed = true; }
                        if (favData.bookmarks) { saveBookmarks(favData.bookmarks); changed = true; }
                    }
                    
                    const timeContent = data.files?.['nsl_timeline.json']?.content;
                    if (timeContent) {
                        const timeData = JSON.parse(timeContent);
                        if (timeData.timeline) { saveTimeline(timeData.timeline); changed = true; }
                    }
                    
                    setStore(STORES.gistCache + '_last_sync', Date.now());
                    
                    if (changed) {
                        cleanupDuplicates();
                        updateBookmarksMenu();
                        refreshNewEpisodesBadge();
                        refreshAllCards();
                    }
                    
                    if (showNotify) notify(changed ? '📥 Данные загружены' : '✅ Актуально');
                } catch(e) {
                    console.error('[NSL] Parse error:', e);
                    if (showNotify) notify('❌ Ошибка чтения данных');
                }
            },
            error: () => {
                if (showNotify) notify('❌ Ошибка загрузки');
            }
        });
    }

    // ========== ОБРАБОТЧИК КАРТОЧКИ ==========
    function addFullCardHandler() {
        Lampa.Listener.follow('full', function(e) {
            if (e.type !== 'complite') return;
            
            setTimeout(() => {
                try {
                    const movie = e.data.movie || e.data.card;
                    if (!movie?.id || !e.object?.activity) return;
                    
                    const render = e.object.activity.render();
                    const container = render.find('.full-start-new__buttons, .full-start__buttons').first();
                    
                    if (!container.length || container.find('.nsl-fav-btn').length) return;
                    
                    // Добавляем кнопку "В избранное"
                    const isFav = getFavorites().some(f => 
                        getBaseId(f.tmdb_id) === getBaseId(getTmdbId(movie))
                    );
                    
                    const btn = $(`
                        <div class="full-start__button selector nsl-fav-btn">
                            <svg viewBox="0 0 24 24" width="20" height="20">
                                <path fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                            </svg>
                            <span>В избранное</span>
                        </div>
                    `);
                    
                    btn.on('hover:enter', () => {
                        const items = CATEGORIES.map(cat => ({
                            title: cat.name,
                            checkbox: true,
                            checked: isInFavorites(movie, cat.id),
                            category: cat.id
                        }));
                        
                        Lampa.Select.show({
                            title: 'Добавить в избранное',
                            items: items,
                            onCheck: (item) => {
                                if (item.checked) {
                                    addToFavorites(movie, item.category);
                                } else {
                                    removeFromFavorites(movie, item.category);
                                }
                                refreshAllCards();
                            },
                            onBack: () => Lampa.Controller.toggle('content')
                        });
                    });
                    
                    container.prepend(btn);
                    
                    // Скрываем штатную кнопку закладок
                    if (cfg().hide_lampa_bookmark_button) {
                        container.find('.button--book').addClass('nsl-hidden-lampa-button');
                    }
                    
                } catch(err) {
                    console.error('[NSL] Error in full handler:', err);
                }
            }, 500);
        });
    }

    function applyHideLampaElements() {
        if (cfg().hide_lampa_bookmark_button) {
            $('<style>.nsl-hidden-lampa-button{display:none!important}</style>').appendTo('head');
        } else {
            $('.nsl-hidden-lampa-button').removeClass('nsl-hidden-lampa-button');
        }
    }

    // ========== СИНХРОНИЗАЦИЯ FILE_VIEW ==========
    function syncFromFileView() {
        const fv1 = Lampa.Storage.get('file_view', {});
        const fv2 = Lampa.Storage.get(FILE_VIEW_KEY, {});
        const fileView = Object.assign({}, fv1, fv2);
        
        const timeline = getTimeline();
        let changed = false;
        
        for (const key in fileView) {
            const fvItem = fileView[key];
            if (!fvItem || !fvItem.time || fvItem.time <= 0) continue;
            
            let nslKey = key;
            
            // Проверяем формат ключа
            if (key.includes('_s') && key.includes('_e')) {
                nslKey = key;
            } else if (/^\d{6,8}$/.test(key)) {
                nslKey = key;
            } else {
                // Пытаемся найти соответствие
                const favorites = getFavorites();
                for (const fav of favorites) {
                    const cd = fav.data || {};
                    const baseId = getBaseId(fav.tmdb_id);
                    
                    if (cd.original_name) {
                        for (let s = 1; s <= 30; s++) {
                            for (let e = 1; e <= 50; e++) {
                                const hash = Lampa.Utils.hash([s, s > 10 ? ':' : '', e, cd.original_name].join(''));
                                if (String(hash) === String(key)) {
                                    nslKey = `${baseId}_s${s}_e${e}`;
                                    break;
                                }
                            }
                            if (nslKey !== key) break;
                        }
                    } else {
                        const name = cd.original_title || cd.title || '';
                        if (name && String(Lampa.Utils.hash(name)) === String(key)) {
                            nslKey = baseId;
                            break;
                        }
                    }
                    
                    if (nslKey !== key) break;
                }
            }
            
            if (!nslKey) continue;
            
            const existing = timeline[nslKey];
            if (!existing || fvItem.time > (existing.time || 0)) {
                timeline[nslKey] = {
                    time: fvItem.time,
                    duration: fvItem.duration || 0,
                    percent: fvItem.percent || 0,
                    updated: fvItem.updated || Date.now(),
                    tmdb_id: getBaseId(nslKey)
                };
                changed = true;
            }
        }
        
        if (changed) {
            saveTimeline(timeline);
            refreshAllCards();
        }
    }

    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    function init() {
        if (!cfg().enabled) return;
        
        console.log(`[NSL] Init v${PLUGIN_VERSION} profile: ${PROFILE_ID}`);
        
        // Стили
        $('<style>')
            .text('.nsl-hidden-lampa-button{display:none!important}')
            .appendTo('head');
        
        updateCardStyles();
        
        // Меню и интерфейс
        setTimeout(() => {
            addFavoritesToMenu();
            addSettingsToMenu();
            updateBookmarksMenu();
            applyHideLampaElements();
        }, 1000);
        
        // Обработчики
        addFullCardHandler();
        
        // Синхронизация при старте
        if (cfg().sync_on_start) {
            setTimeout(() => syncFromGist(false), 5000);
        }
        
        // Синхронизация file_view
        setTimeout(() => {
            syncFromFileView();
            cleanupDuplicates();
            refreshAllCards();
        }, 3000);
        
        // Отслеживание плеера
        let playerInterval = null;
        let wasPlaying = false;
        
        playerInterval = setInterval(() => {
            const isPlaying = Lampa.Player.opened();
            
            if (!isPlaying && wasPlaying) {
                // Плеер закрылся - сохраняем прогресс
                const pd = Lampa.Player.playdata();
                if (pd?.timeline && pd.timeline.time > 0) {
                    const movie = Lampa.Activity.active()?.movie;
                    if (movie) {
                        const key = getMovieKey(movie);
                        const tmdbId = getTmdbId(movie);
                        if (key && tmdbId) {
                            saveProgress(
                                key,
                                pd.timeline.time,
                                pd.timeline.percent,
                                pd.timeline.duration,
                                tmdbId
                            );
                        }
                    }
                }
                syncFromFileView();
            }
            
            wasPlaying = isPlaying;
        }, 5000);
        
        // Отслеживание таймлайна
        Lampa.Listener.follow('state:changed', (e) => {
            if (e.target === 'timeline' && e.reason === 'update') {
                setTimeout(() => syncFromFileView(), 1000);
            }
        });
        
        // Сохранение при закрытии
        window.addEventListener('beforeunload', () => {
            if (cfg().sync_on_close) {
                syncToGist('favorites');
                syncToGist('timeline');
            }
        });
        
        // History API
        Lampa.Listener.follow('full', (e) => {
            if (e.type === 'complite' && e.data?.movie) {
                addToHistory(e.data.movie);
            }
        });
        
        console.log('[NSL] Init complete');
        notify(`${PLUGIN_NAME} v${PLUGIN_VERSION} загружен`);
    }

    // ========== ЗАПУСК ==========
    if (window.appready) {
        init();
    } else {
        Lampa.Listener.follow('app', (e) => {
            if (e.type === 'ready') init();
        });
    }
    
})();
