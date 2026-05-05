(function () {
    'use strict';

    if (window.nsl_sync_init) return;
    window.nsl_sync_init = true;

    // ======================
    // 0. ОПРЕДЕЛЕНИЕ ПЛАТФОРМЫ И ПРОФИЛЯ
    // ======================
    
    const isAndroid = navigator.userAgent.toLowerCase().indexOf('android') > -1 || 
                      (typeof window.AndroidJS !== 'undefined');
    
    function getProfileId() {
        try {
            const account = Lampa.Storage.get('account', {});
            const profile = account.profile || {};
            return String(profile.id || 'default');
        } catch (e) {
            return 'default';
        }
    }

    const PROFILE_ID = getProfileId();
    const STORE_BOOKMARKS = `nsl_bookmarks_${PROFILE_ID}_v4`;
    const STORE_FAVORITES = `nsl_favorites_${PROFILE_ID}_v4`;
    const STORE_TIMELINE = `nsl_timeline_${PROFILE_ID}_v4`;
    const STORE_MOVE_LOG = `nsl_move_log_${PROFILE_ID}_v1`;
    const STORE_SERIES_CHECK = `nsl_series_check_${PROFILE_ID}_v1`;
    const STORE_HISTORY = `nsl_history_${PROFILE_ID}_v1`;
    const CFG = `nsl_cfg_${PROFILE_ID}_v5`;
    const GIST_CACHE = `nsl_gist_cache_${PROFILE_ID}`;

    window.NSL = {};

    const FAVORITE_CATEGORIES = [
        { id: 'favorite', name: 'Избранное', icon: '⭐' },
        { id: 'watching', name: 'Смотрю', icon: '👁️' },
        { id: 'planned', name: 'Буду смотреть', icon: '📋' },
        { id: 'watched', name: 'Просмотрено', icon: '✅' },
        { id: 'abandoned', name: 'Брошено', icon: '❌' },
        { id: 'collection', name: 'Коллекция', icon: '📦' }
    ];

    const MEDIA_TYPES = {
        movie: { name: 'Фильмы', icon: '🎬' },
        tv: { name: 'Сериалы', icon: '📺' },
        cartoon: { name: 'Мультфильмы', icon: '🐭' },
        cartoon_series: { name: 'Мультсериалы', icon: '🐭' },
        anime: { name: 'Аниме', icon: '🐭' }
    };

    const STATUS_PRIORITY = {
        'watching': 1,
        'abandoned': 2,
        'watched': 3,
        'planned': 4,
        'favorite': 5,
        'collection': 6
    };

    const CATEGORY_RULES = {
        abandoned: { removeFrom: ['favorite', 'watching', 'planned', 'watched'] },
        watched: { removeFrom: ['favorite', 'watching', 'planned'] },
        watching: { removeFrom: ['planned'] },
        collection: { removeFrom: [] },
        favorite: { removeFrom: [] },
        planned: { removeFrom: [] }
    };

    let cardDisplayPatched = false;
    let favoriteButtonTimer = null;
    let seriesCheckTimer = null;
    let gistSyncing = false;
    let gistSyncingFav = false;
    let gistSyncingTime = false;
    let gistSyncingBook = false;
    let gistSyncingHis = false;
    let syncingFromGist = false;

    function cfg() {
        return Lampa.Storage.get(CFG, {
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
            auto_backup: true,
            auto_backup_interval: 24,
            sync_interval: 30,
            sync_strategy: 'max_time',
            auto_abandoned: false,
            card_display_mode: 'nsl_status',
            nsl_status_position: 'bottom',
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
            check_new_episodes: true,
            new_episodes_notify: true,
            new_episodes_check_interval: 24,
            hide_lampa_bookmark_button: false
        }) || {};
    }

    function saveCfg(c) { Lampa.Storage.set(CFG, c, true); }

    function getBookmarks() { return Lampa.Storage.get(STORE_BOOKMARKS, []) || []; }
    function saveBookmarks(l) { Lampa.Storage.set(STORE_BOOKMARKS, l, true); renderBookmarks(); }
    
    function getFavorites() { return Lampa.Storage.get(STORE_FAVORITES, []) || []; }
    function saveFavorites(l) { 
        Lampa.Storage.set(STORE_FAVORITES, l, true);
        if (!syncingFromGist) {
            setTimeout(() => Lampa.Listener.send('state:changed', { target: 'nsl_favorites', reason: 'update' }), 100);
        }
    }
    
    function getTimeline() { return Lampa.Storage.get(STORE_TIMELINE, {}) || {}; }
    function saveTimeline(t) { Lampa.Storage.set(STORE_TIMELINE, t, true); }
    
    function getMoveLog() { return Lampa.Storage.get(STORE_MOVE_LOG, []) || []; }
    function saveMoveLog(l) { 
        if (l.length > 50) l = l.slice(-50);
        Lampa.Storage.set(STORE_MOVE_LOG, l, true); 
    }

    function getSeriesCheck() { return Lampa.Storage.get(STORE_SERIES_CHECK, {}) || {}; }
    function saveSeriesCheck(s) { Lampa.Storage.set(STORE_SERIES_CHECK, s, true); }

    function getHistory() { return Lampa.Storage.get(STORE_HISTORY, []) || []; }
    function saveHistory(h) { 
        if (h.length > 50) h = h.slice(-50);
        Lampa.Storage.set(STORE_HISTORY, h, true); 
    }

    function notify(text) { 
        if (Lampa.Noty) Lampa.Noty.show(text);
    }

    function logMove(action, title, fromCategory, toCategory) {
        const c = cfg();
        if (!c.show_move_notifications && fromCategory) return;
        
        const logEntry = {
            time: Date.now(),
            action: action,
            title: title,
            from: fromCategory || 'none',
            to: toCategory || 'none'
        };
        
        const log = getMoveLog();
        log.push(logEntry);
        saveMoveLog(log);
        
        if (c.show_move_notifications) {
            const catNames = {};
            FAVORITE_CATEGORIES.forEach(c => catNames[c.id] = c.name);
            
            if (action === 'move') notify(`📦 "${title}" → ${catNames[toCategory]}`);
            else if (action === 'auto_watching') notify(`👁️ "${title}" → Смотрю`);
            else if (action === 'auto_watched') notify(`✅ "${title}" → Просмотрено`);
            else if (action === 'auto_abandoned') notify(`❌ "${title}" → Брошено`);
            else if (action === 'return_abandoned') notify(`🔄 "${title}" возвращён в Смотрю`);
            else if (action === 'return_watched') notify(`🔄 "${title}" возвращён в Смотрю (повторный просмотр)`);
        }
    }

    function formatTime(seconds) {
        if (!seconds || seconds < 0) return '0:00';
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        if (hours > 0) return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }

    function extractTmdbId(item) {
        if (!item) return null;
        if (item.tmdb_id) return String(item.tmdb_id);
        if (item.id && /^\d{6,8}$/.test(String(item.id))) return String(item.id);
        if (item.movie_id && /^\d{6,8}$/.test(String(item.movie_id))) return String(item.movie_id);
        return null;
    }

    function getMediaType(item) {
        if (!item) return 'movie';
        if (item.original_name) {
            if (item.anime) return 'anime';
            if (item.animation) return 'cartoon_series';
            return 'tv';
        }
        if (item.animation) return 'cartoon';
        return 'movie';
    }

    function cleanCardData(card) {
        const cleaned = {};
        const allowedFields = ['id', 'title', 'name', 'original_title', 'original_name', 
            'poster_path', 'backdrop_path', 'vote_average', 'release_date', 'first_air_date',
            'overview', 'genre_ids', 'source', 'animation', 'anime', 'kp_rating', 'rating',
            'number_of_seasons', 'number_of_episodes', 'last_air_date'];
        for (const field of allowedFields) {
            if (card[field] !== undefined) cleaned[field] = card[field];
        }
        return cleaned;
    }

    // ======================
    // ЗАКЛАДКИ РАЗДЕЛОВ
    // ======================
    
    const ICON_FLAG = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M6 2v20l6-4 6 4V2z"/></svg>';
    const ICON_ADD = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M11 5h2v14h-2zM5 11h14v2H5z"/></svg>';

    function makeKey(a) {
        return [a.url || '', a.component || '', a.source || '', a.id || '', a.job || '',
            JSON.stringify(a.genres || ''), JSON.stringify(a.params || '')].join('|');
    }

    function bookmarkExists(act) {
        return getBookmarks().some(i => i.key === makeKey(act));
    }

    function isAllowedForBookmark() {
        const act = Lampa.Activity.active();
        if (!act) return false;
        if (act.component === 'actor' || act.component === 'person') return true;
        if (!act.url) return false;
        if (['movie', 'tv', 'anime', 'catalog'].includes(act.url)) return false;
        if (act.params || act.genres || act.sort || act.filter) return true;
        return act.url.indexOf('discover') !== -1 && act.url.indexOf('?') !== -1;
    }

    function normalizeBookmark(a) {
        return {
            id: Date.now(),
            key: makeKey(a),
            name: a.title || a.name || 'Закладка',
            url: a.url,
            component: a.component || 'category_full',
            source: a.source || 'tmdb',
            id_person: a.id,
            job: a.job,
            genres: a.genres,
            params: a.params,
            page: a.page || 1,
            created: Date.now()
        };
    }

    function saveBookmark() {
        const act = Lampa.Activity.active();
        if (!isAllowedForBookmark()) { notify('Здесь нельзя создать закладку'); return; }
        if (bookmarkExists(act)) { notify('Уже есть'); return; }
    
        Lampa.Input.edit({
            title: 'Название',
            value: act.title || act.name || 'Закладка',
            free: true
        }, (val) => {
            if (!val) {
                if (isAndroid) Lampa.Controller.toggle('content');
                return;
            }
            const l = getBookmarks();
            l.push({ ...normalizeBookmark(act), name: val.trim() });
            saveBookmarks(l);
            const c = cfg();
            if (c.sync_on_add && c.gist_token && c.gist_id) syncToGist('bookmarks', false);
            notify('Сохранено');
            if (isAndroid) Lampa.Controller.toggle('content');
        }, () => {
            if (isAndroid) Lampa.Controller.toggle('content');
        });
    }

    function removeBookmark(item) {
        const l = getBookmarks().filter(i => i.id !== item.id);
        saveBookmarks(l);
        notify('Удалено');
        const c = cfg();
        if (c.sync_on_remove && c.gist_token && c.gist_id) syncToGist('bookmarks', false);
    }

    function openBookmark(item) {
        Lampa.Activity.push({
            url: item.url, title: item.name, component: item.component,
            source: item.source, id: item.id_person, job: item.job,
            genres: item.genres, params: item.params, page: item.page
        });
    }

    function renderBookmarks() {
        $('.nsl-bookmark-item').remove();
        const menuList = $('.menu__list').first();
        if (!menuList.length) return;
        getBookmarks().forEach(item => {
            const el = $(`<li class="menu__item selector nsl-bookmark-item"><div class="menu__ico">${ICON_FLAG}</div><div class="menu__text" style="line-height:1.1;padding-top:0.3em;padding-bottom:0.3em;">${item.name}</div></li>`);
            el.on('hover:enter', (e) => { e.stopPropagation(); openBookmark(item); });
            el.on('hover:long', (e) => {
                e.stopPropagation();
                Lampa.Select.show({
                    title: `Удалить "${item.name}"?`,
                    items: [{ title: 'Нет', action: 'cancel' }, { title: 'Да', action: 'remove' }],
                    onSelect: (a) => { if (a.action === 'remove') removeBookmark(item); },
                    onBack: () => Lampa.Controller.toggle('content')
                });
            });
            menuList.append(el);
        });
    }

    function addBookmarkButton() {
        if ($('[data-nsl-save]').length) return;
        const c = cfg();
        if (c.button_position === 'side') {
            const menuList = $('.menu__list').eq(1);
            if (menuList.length) {
                const btn = $(`<li class="menu__item selector" data-nsl-save><div class="menu__ico">${ICON_ADD}</div><div class="menu__text">Сохранить раздел</div></li>`);
                btn.on('hover:enter', (e) => { e.stopPropagation(); saveBookmark(); });
                menuList.prepend(btn);
            }
        } else if (c.button_position === 'top') {
            const head = $('.head__actions, .head__buttons').first();
            if (head.length) {
                const btn = $(`<div class="head__action selector" data-nsl-save><div class="head__action-ico">${ICON_ADD}</div></div>`);
                btn.on('hover:enter', (e) => { e.stopPropagation(); saveBookmark(); });
                head.prepend(btn);
            }
        }
    }

    // ======================
    // ИЗБРАННОЕ
    // ======================

    function getBaseTmdbId(tmdbId) {
        if (!tmdbId) return null;
        return String(tmdbId).replace(/[_-].*$/, '');
    }

    function applyCategoryRules(tmdbId, newCategory, favorites) {
        const rules = CATEGORY_RULES[newCategory];
        if (!rules || !rules.removeFrom.length) return false;
        const baseId = getBaseTmdbId(tmdbId);
        let changed = false;
        for (const catToRemove of rules.removeFrom) {
            const index = favorites.findIndex(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === catToRemove);
            if (index >= 0) { favorites.splice(index, 1); changed = true; }
        }
        return changed;
    }

    let tmdbSeriesDataCache = {};
    
    function addToFavorites(card, category) {
        if (!card || !card.id) return false;
        const tmdbId = extractTmdbId(card);
        const mediaType = getMediaType(card);
        const favorites = getFavorites();
        const baseId = getBaseTmdbId(tmdbId);
        const inCollection = favorites.find(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === 'collection');
        applyCategoryRules(tmdbId, category, favorites);
        const existingIndex = favorites.findIndex(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === category);
        const cardData = cleanCardData(card);
        const needSeriesData = (mediaType === 'tv' || cardData.original_name) && !cardData.number_of_seasons;
        
        const saveItem = (finalCardData) => {
            const favoriteItem = {
                id: Date.now(), card_id: card.id, tmdb_id: tmdbId,
                media_type: mediaType, category: category,
                data: finalCardData, added: Date.now(), updated: Date.now()
            };
            const title = finalCardData.title || finalCardData.name || 'Без названия';
            if (existingIndex >= 0) favorites[existingIndex] = favoriteItem;
            else { favorites.push(favoriteItem); logMove('add', title, null, category); }
            if (inCollection && category !== 'collection') {
                if (!favorites.some(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === 'collection'))
                    favorites.push(inCollection);
            }
            saveFavorites(favorites);
            checkAutoAbandoned();
            refreshNewEpisodesBadge();
            const c = cfg();
            if (c.sync_on_add && c.gist_token && c.gist_id) syncToGist('favorites', false);
        };
        
        if (needSeriesData && typeof Lampa.TMDB !== 'undefined' && Lampa.TMDB.api) {
            // Проверяем кеш
            if (tmdbSeriesDataCache[baseId] && Date.now() - tmdbSeriesDataCache[baseId].time < 60 * 60 * 1000) {
                const cachedData = tmdbSeriesDataCache[baseId].data;
                cardData.number_of_seasons = cachedData.number_of_seasons || 0;
                cardData.number_of_episodes = cachedData.number_of_episodes || 0;
                cardData.last_air_date = cachedData.last_air_date || '';
                saveItem(cardData);
                return true;
            }
            
            const url = Lampa.TMDB.api('tv/' + baseId + '?api_key=' + Lampa.TMDB.key());
            $.ajax({
                url, method: 'GET', timeout: 5000,
                success: (data) => {
                    cardData.number_of_seasons = data.number_of_seasons || 0;
                    cardData.number_of_episodes = data.number_of_episodes || 0;
                    cardData.last_air_date = data.last_air_date || '';
                    
                    // Сохраняем в кеш
                    tmdbSeriesDataCache[baseId] = {
                        time: Date.now(),
                        data: {
                            number_of_seasons: cardData.number_of_seasons,
                            number_of_episodes: cardData.number_of_episodes,
                            last_air_date: cardData.last_air_date
                        }
                    };
                    
                    saveItem(cardData);
                },
                error: () => saveItem(cardData)
            });
        } else saveItem(cardData);
        return true;
    }
    
    function removeFromFavorites(card, category) {
        const tmdbId = extractTmdbId(card);
        const favorites = getFavorites();
        const baseId = getBaseTmdbId(tmdbId);
        const index = favorites.findIndex(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === category);
        if (index >= 0) {
            favorites.splice(index, 1);
            saveFavorites(favorites);
            refreshNewEpisodesBadge();
            const c = cfg();
            if (c.sync_on_remove && c.gist_token && c.gist_id) syncToGist('favorites', false);
            return true;
        }
        return false;
    }
    
    function toggleFavorite(card, category) {
        return isInFavorites(card, category) ? removeFromFavorites(card, category) : addToFavorites(card, category);
    }
    
    function isInFavorites(card, category) {
        const tmdbId = extractTmdbId(card);
        const baseId = getBaseTmdbId(tmdbId);
        return getFavorites().some(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === category);
    }
    
    function getFavoritesByCategory(category) { return getFavorites().filter(f => f.category === category); }
    
    function deleteCompletely(item) {
        const baseId = getBaseTmdbId(item.tmdb_id);
        const title = item.data?.title || item.data?.name || 'Без названия';
        
        // Удаляем из избранного
        let favorites = getFavorites();
        favorites = favorites.filter(f => getBaseTmdbId(f.tmdb_id) !== baseId);
        saveFavorites(favorites);
        
        // Удаляем таймкоды из нашего хранилища
        const timeline = getTimeline();
        for (const key in timeline) {
            const recTmdbId = timeline[key]?.tmdb_id || '';
            if (getBaseTmdbId(recTmdbId) === baseId || getBaseTmdbId(key) === baseId) {
                delete timeline[key];
            }
        }
        saveTimeline(timeline);
        
        // Удаляем из истории
        let history = getHistory();
        history = history.filter(h => getBaseTmdbId(h.tmdb_id) !== baseId && h.id != baseId);
        saveHistory(history);
        
        // Удаляем из штатного file_view Lampa
        const fileView = Lampa.Storage.get('file_view', {});
        for (const key in fileView) {
            if (String(key).includes(baseId)) {
                delete fileView[key];
            }
        }
        Lampa.Storage.set('file_view', fileView, true);
        
        // Удаляем из штатного избранного Lampa
        const fav = Lampa.Storage.get('favorite', {});
        if (fav.history) {
            fav.history = fav.history.filter(id => String(id) !== baseId);
            Lampa.Storage.set('favorite', fav, true);
        }
        
        // Удаляем таймкоды из IndexedDB (кеш timetable)
        if (typeof Lampa !== 'undefined' && Lampa.Cache && typeof Lampa.Cache.rewriteData === 'function') {
            Lampa.Cache.rewriteData('timetable', baseId, null).then(() => {
                console.log('[NSL] Timetable cache cleared for', baseId);
            }).catch(() => {
                // Игнорируем ошибки очистки кеша
            });
        }
        
        notify(`🗑️ "${title}" удалён полностью`);
        logMove('delete', title, item.category, null);
        refreshNewEpisodesBadge();
        
        const c = cfg();
        if (c.sync_on_remove && c.gist_token && c.gist_id) {
            syncToGist('favorites', false);
            syncToGist('timeline', false);
            syncToGist('history', false);
        }
    }
        
    let autoAbandonedRunning = false;
    
    function checkAutoAbandoned() {
        if (autoAbandonedRunning) return;
        
        const c = cfg();
        if (!c.auto_abandoned) return;
        
        autoAbandonedRunning = true;
        
        try {
            const now = Date.now();
            const abandonedAfter = c.abandoned_days * 24 * 60 * 60 * 1000;
            const favorites = getFavorites();
            let changed = false;
            
            for (const item of favorites.filter(f => f.category === 'watching')) {
                const lastUpdate = item.updated || item.added;
                if (lastUpdate > 0 && (now - lastUpdate) > abandonedAfter) {
                    const oldCategory = item.category;
                    const title = item.data?.title || item.data?.name || 'Без названия';
                    item.category = 'abandoned';
                    item.updated = now;
                    applyCategoryRules(item.tmdb_id, 'abandoned', favorites);
                    logMove('auto_abandoned', title, oldCategory, 'abandoned');
                    changed = true;
                }
            }
            
            if (changed) {
                saveFavorites(favorites);
                if (c.gist_token && c.gist_id) syncToGist('favorites', false);
            }
        } finally {
            autoAbandonedRunning = false;
        }
    }

    function checkAutoRemoveWatched() {
        const c = cfg();
        if (!c.auto_remove_watched) return;
        const now = Date.now();
        const removeAfter = c.auto_remove_watched_days * 24 * 60 * 60 * 1000;
        const timeline = getTimeline();
        let favorites = getFavorites();
        let changed = false;
        const toRemove = favorites.filter(f => {
            if (f.category !== 'watched') return false;
            const lastUpdate = f.updated || f.added;
            return lastUpdate > 0 && (now - lastUpdate) > removeAfter;
        });
        if (toRemove.length === 0) return;
        toRemove.forEach(item => {
            const baseId = getBaseTmdbId(item.tmdb_id);
            const title = item.data?.title || item.data?.name || 'Без названия';
            favorites = favorites.filter(f => getBaseTmdbId(f.tmdb_id) !== baseId || f.category !== 'watched');
            for (const key in timeline) {
                if (getBaseTmdbId(timeline[key]?.tmdb_id) === baseId) delete timeline[key];
            }
            logMove('auto_remove_watched', title, 'watched', null);
            changed = true;
        });
        if (changed) {
            saveFavorites(favorites);
            saveTimeline(timeline);
            refreshNewEpisodesBadge();
            notify(`🧹 Авто-удалено просмотренных: ${toRemove.length}`);
            if (c.gist_token && c.gist_id) { syncToGist('favorites', false); syncToGist('timeline', false); }
        }
    }

    function checkUnfinishedWatching() {
        const c = cfg();
        if (!c.auto_watching) return;
        
        const now = Date.now();
        const remindAfter = 7 * 24 * 60 * 60 * 1000;
        const timeline = getTimeline();
        const favorites = getFavorites();
        
        const unfinished = favorites.filter(f => {
            if (f.category !== 'watching') return false;
            const lastUpdate = f.updated || f.added;
            if (now - lastUpdate < remindAfter) return false;
            
            const baseId = getBaseTmdbId(f.tmdb_id);
            let maxPercent = 0;
            for (const key in timeline) {
                if (getBaseTmdbId(timeline[key]?.tmdb_id) === baseId) {
                    maxPercent = Math.max(maxPercent, timeline[key].percent || 0);
                }
            }
            return maxPercent >= 20 && maxPercent <= 80;
        });
        
        if (unfinished.length > 0) {
            const titles = unfinished.slice(0, 3).map(f => {
                const p = getProgressPercent(f.tmdb_id);
                return `"${f.data?.title || f.data?.name || 'Без названия'}" (${p}%)`;
            }).join(', ');
            
            notify(`🎬 Не доcмотрено: ${titles}`);
        }
    }
    
    function getProgressPercent(tmdbId) {
        const timeline = getTimeline();
        const baseId = getBaseTmdbId(tmdbId);
        let maxPercent = 0;
        for (const key in timeline) {
            if (getBaseTmdbId(timeline[key]?.tmdb_id) === baseId) {
                maxPercent = Math.max(maxPercent, timeline[key].percent || 0);
            }
        }
        return maxPercent;
    }
    
    let returnedToWatchingMap = {};
    let syncTimelineRunning = false;
    let syncTimelineTimer = null;

    function returnToWatching(tmdbId) {
        const favorites = getFavorites();
        const baseId = getBaseTmdbId(tmdbId);
        const item = favorites.find(f => getBaseTmdbId(f.tmdb_id) === baseId && (f.category === 'abandoned' || f.category === 'watched'));
        if (item) {
            const oldCategory = item.category;
            const title = item.data?.title || item.data?.name || 'Без названия';
            item.category = 'watching'; item.updated = Date.now();
            applyCategoryRules(tmdbId, 'watching', favorites);
            const action = oldCategory === 'abandoned' ? 'return_abandoned' : 'return_watched';
            logMove(action, title, oldCategory, 'watching');
            saveFavorites(favorites);
            returnedToWatchingMap[baseId] = true;
            const c = cfg();
            if (c.gist_token && c.gist_id) syncToGist('favorites', false);
            return true;
        }
        return false;
    }

    function mergeTimeline(localTimeline, remoteTimeline, strategy) {
        const merged = { ...localTimeline };
        let changes = 0;
        for (const key in remoteTimeline) {
            const remoteRec = remoteTimeline[key];
            const localRec = merged[key];
            if (!remoteRec.updated) remoteRec.updated = remoteRec.saved_at || 0;
            if (!localRec) { merged[key] = remoteRec; changes++; }
            else {
                if (!localRec.updated) localRec.updated = localRec.saved_at || 0;
                const remoteUpdated = remoteRec.updated || 0;
                const localUpdated = localRec.updated || 0;
                const remoteTime = remoteRec.time || 0;
                const localTime = localRec.time || 0;
                let shouldUpdate = false;
                if (strategy === 'max_time') { if (remoteTime > localTime) shouldUpdate = true; }
                else { if (remoteUpdated > localUpdated) shouldUpdate = true; else if (remoteUpdated === localUpdated && remoteTime > localTime) shouldUpdate = true; }
                if (shouldUpdate) { merged[key] = remoteRec; changes++; }
            }
        }
        return { merged, changes };
    }
    
    function getAllSyncData() {
        return {
            version: 5,
            profile_id: PROFILE_ID,
            updated: new Date().toISOString(),
            bookmarks: getBookmarks(),
            favorites: getFavorites(),
            timeline: getTimeline()
        };
    }
    
    function cleanupDuplicateCategories() {
        const favorites = getFavorites();
        const tmdbMap = new Map();
        let changed = false;
        
        for (const item of favorites) {
            const baseId = getBaseTmdbId(item.tmdb_id);
            if (!tmdbMap.has(baseId)) tmdbMap.set(baseId, []);
            tmdbMap.get(baseId).push(item);
        }
        
        for (const [baseId, items] of tmdbMap) {
            if (items.length <= 1) continue;
            const categories = items.map(i => i.category);
            let keepCategories = [...categories];
            if (categories.includes('abandoned')) keepCategories = keepCategories.filter(c => c === 'abandoned' || c === 'collection');
            else if (categories.includes('watched')) keepCategories = keepCategories.filter(c => c === 'watched' || c === 'collection');
            else if (categories.includes('watching')) keepCategories = keepCategories.filter(c => c === 'watching' || c === 'collection');
            else if (categories.includes('planned') && categories.includes('favorite')) keepCategories = ['planned', 'collection'];
            
            const uniqueKeep = [...new Set(keepCategories)];
            for (const item of items) {
                if (!uniqueKeep.includes(item.category)) {
                    const index = favorites.findIndex(f => f.id === item.id);
                    if (index >= 0) { favorites.splice(index, 1); changed = true; }
                }
            }
            for (const cat of uniqueKeep) {
                const catItems = items.filter(i => i.category === cat);
                if (catItems.length > 1) {
                    catItems.sort((a, b) => (b.updated || 0) - (a.updated || 0));
                    for (let i = 1; i < catItems.length; i++) {
                        const index = favorites.findIndex(f => f.id === catItems[i].id);
                        if (index >= 0) { favorites.splice(index, 1); changed = true; }
                    }
                }
            }
        }
        
        if (changed) {
            saveFavorites(favorites);
            logMove('cleanup', 'Система', null, null);
        }
        return changed;
    }

    function isLastEpisodeOfLastSeason(baseId, season, episode, callback) {
        let resolved = false;
        
        // Пробуем получить эпизоды из кэша IndexedDB
        if (typeof Lampa !== 'undefined' && Lampa.Cache && typeof Lampa.Cache.getData === 'function') {
            Lampa.Cache.getData('timetable', baseId).then(data => {
                if (resolved) return;
                
                if (data && data.episodes && data.episodes.length) {
                    resolved = true;
                    const episodes = data.episodes;
                    let maxSeason = 0;
                    let lastEpNum = 0;
                    
                    episodes.forEach(ep => {
                        if (ep.season_number > maxSeason) {
                            maxSeason = ep.season_number;
                            lastEpNum = 0;
                        }
                        if (ep.season_number === maxSeason && ep.episode_number > lastEpNum) {
                            lastEpNum = ep.episode_number;
                        }
                    });
                    
                    callback(season >= maxSeason && episode >= lastEpNum);
                } else {
                    // IndexedDB ответил, но данных нет — пробуем fallback
                    resolved = true;
                    fallbackCheck();
                }
            }).catch(() => {
                if (!resolved) {
                    resolved = true;
                    fallbackCheck();
                }
            });
            
            // Таймаут: если IndexedDB не ответил за 3 секунды — используем fallback
            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    fallbackCheck();
                }
            }, 3000);
        } else {
            resolved = true;
            fallbackCheck();
        }
        
        function fallbackCheck() {
            const timetableData = Lampa.TimeTable?.all() || [];
            const showData = timetableData.find(d => d.id == baseId);
            
            if (showData && showData.next) {
                callback(season >= showData.next.season_number && episode >= showData.next.episode_number);
            } else {
                const seriesCheck = getSeriesCheck();
                const checkData = seriesCheck[baseId];
                if (checkData && checkData.last_season_number > 0) {
                    callback(season >= checkData.last_season_number);
                } else {
                    // НЕТ ДАННЫХ — считаем что НЕ последняя серия
                    callback(false);
                }
            }
        }
    }

    function getCardDataFromActivity(tmdbId) {
        try {
            const movie = Lampa.Activity.active()?.movie;
            if (movie && extractTmdbId(movie) === tmdbId) {
                return cleanCardData(movie);
            }
        } catch(e) {}
        
        const favorites = getFavorites();
        const existing = favorites.find(f => getBaseTmdbId(f.tmdb_id) === getBaseTmdbId(tmdbId));
        if (existing?.data) return existing.data;
        
        return { id: tmdbId, title: 'ID: ' + getBaseTmdbId(tmdbId) };
    }

    function syncTimelineWithCategories() {
        const c = cfg();
        if (!c.auto_watching && !c.auto_watched) return;
        
        // Защита от повторных вызовов — сбрасываем таймер
        if (syncTimelineTimer) {
            clearTimeout(syncTimelineTimer);
            syncTimelineTimer = null;
        }
        
        const timeline = getTimeline();
        const favorites = getFavorites();
        let changed = false;
        
        // Собираем все ID сериалов, которые нужно проверить
        const seriesToCheck = [];
        
        for (const [key, item] of Object.entries(timeline)) {
            const tmdbId = item.tmdb_id;
            if (!tmdbId) continue;
            const baseId = getBaseTmdbId(tmdbId);
            const percent = item.percent || 0;
            
            const isAbandoned = favorites.some(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === 'abandoned');
            if (isAbandoned) continue;
            
            if (returnedToWatchingMap[baseId]) continue;
            
            const existingWatching = favorites.find(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === 'watching');
            const existingWatched = favorites.find(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === 'watched');
            const existingPlanned = favorites.find(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === 'planned');
            const existingFavorite = favorites.find(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === 'favorite');
            const existingAny = existingWatching || existingWatched || existingPlanned || existingFavorite;
            const cardData = existingAny?.data || { id: tmdbId, title: 'ID: ' + baseId };
            const title = cardData.title || cardData.name || 'ID: ' + baseId;
            const isSeries = key.includes('_s') || key.includes('_e');
            const mediaType = isSeries ? 'tv' : 'movie';
            
            // ФИЛЬМЫ — обрабатываем сразу
            if (!isSeries) {
                if (c.auto_watched && !existingWatched && percent >= c.watched_min_progress) {
                    if (existingWatching) {
                        existingWatching.category = 'watched'; existingWatching.updated = Date.now();
                        applyCategoryRules(tmdbId, 'watched', favorites);
                        logMove('auto_watched', title, 'watching', 'watched'); changed = true;
                    } else if (existingPlanned) {
                        existingPlanned.category = 'watched'; existingPlanned.updated = Date.now();
                        applyCategoryRules(tmdbId, 'watched', favorites);
                        logMove('auto_watched', title, 'planned', 'watched'); changed = true;
                    } else if (!existingWatched) {
                        favorites.push({ id: Date.now(), card_id: baseId, tmdb_id: baseId, media_type: mediaType, category: 'watched', data: cardData, added: Date.now(), updated: Date.now() });
                        logMove('auto_watched', title, null, 'watched'); changed = true;
                    }
                }
                
                if (c.auto_watching && !existingWatching && !existingWatched && percent >= c.watching_min_progress && percent <= c.watching_max_progress) {
                    if (existingPlanned) {
                        existingPlanned.category = 'watching'; existingPlanned.updated = Date.now();
                        applyCategoryRules(tmdbId, 'watching', favorites);
                        logMove('auto_watching', title, 'planned', 'watching'); changed = true;
                    } else if (existingFavorite) {
                        existingFavorite.category = 'watching'; existingFavorite.updated = Date.now();
                        applyCategoryRules(tmdbId, 'watching', favorites);
                        logMove('auto_watching', title, 'favorite', 'watching'); changed = true;
                    } else {
                        favorites.push({ id: Date.now(), card_id: baseId, tmdb_id: baseId, media_type: mediaType, category: 'watching', data: cardData, added: Date.now(), updated: Date.now() });
                        logMove('auto_watching', title, null, 'watching'); changed = true;
                    }
                }
                continue;
            }
            
            // СЕРИАЛЫ — авто в Смотрю (можно сразу)
            if (c.auto_watching && !existingWatching && !existingWatched && percent >= c.watching_min_progress && percent <= c.watching_max_progress) {
                if (existingPlanned) {
                    existingPlanned.category = 'watching'; existingPlanned.updated = Date.now();
                    applyCategoryRules(tmdbId, 'watching', favorites);
                    logMove('auto_watching', title, 'planned', 'watching'); changed = true;
                } else if (existingFavorite) {
                    existingFavorite.category = 'watching'; existingFavorite.updated = Date.now();
                    applyCategoryRules(tmdbId, 'watching', favorites);
                    logMove('auto_watching', title, 'favorite', 'watching'); changed = true;
                } else {
                    favorites.push({ id: Date.now(), card_id: baseId, tmdb_id: baseId, media_type: mediaType, category: 'watching', data: cardData, added: Date.now(), updated: Date.now() });
                    logMove('auto_watching', title, null, 'watching'); changed = true;
                }
            }
            
            // СЕРИАЛЫ — авто в Просмотрено: добавляем в очередь
            if (c.auto_watched && !existingWatched && existingWatching && percent >= c.watched_min_progress) {
                const match = key.match(/_s(\d+)_e(\d+)/);
                if (match) {
                    // Проверяем, нет ли уже такого же baseId в очереди с большим эпизодом
                    const existingCheck = seriesToCheck.find(s => s.baseId === baseId);
                    const newSeason = parseInt(match[1]);
                    const newEpisode = parseInt(match[2]);
                    
                    if (existingCheck) {
                        if (newSeason > existingCheck.season || 
                            (newSeason === existingCheck.season && newEpisode > existingCheck.episode)) {
                            existingCheck.season = newSeason;
                            existingCheck.episode = newEpisode;
                            existingCheck.percent = percent;
                        }
                    } else {
                        seriesToCheck.push({
                            baseId,
                            tmdbId,
                            season: newSeason,
                            episode: newEpisode,
                            percent,
                            title
                        });
                    }
                }
            }
        }
        
        // Сохраняем изменения от авто-в-смотрю и фильмов
        if (changed) {
            saveFavorites(favorites);
            refreshNewEpisodesBadge();
        }
        
        // Отложенная проверка сериалов — ждём загрузки TimeTable
        if (seriesToCheck.length > 0) {
            syncTimelineTimer = setTimeout(() => {
                syncTimelineTimer = null;
                const currentFavorites = getFavorites();
                let changedLater = false;
                
                const tableData = Lampa.TimeTable?.all() || [];
                
                seriesToCheck.forEach(item => {
                    // Перепроверяем, не изменился ли статус
                    const watchingItem = currentFavorites.find(f => 
                        getBaseTmdbId(f.tmdb_id) === item.baseId && f.category === 'watching'
                    );
                    if (!watchingItem) return;
                    
                    const showData = tableData.find(d => d.id == item.baseId);
                    
                    let isLastEpisode = false;
                    
                    if (showData && showData.season > 0 && showData.episodes && showData.episodes.length > 0) {
                        // Текущий сезон === последний сезон?
                        if (item.season === showData.season) {
                            let lastEpNum = 0;
                            showData.episodes.forEach(ep => {
                                if (ep.episode_number > lastEpNum) lastEpNum = ep.episode_number;
                            });
                            if (item.episode >= lastEpNum) {
                                isLastEpisode = true;
                            }
                        }
                    } else {
                        // Fallback: проверяем через seriesCheck
                        const seriesCheck = getSeriesCheck();
                        const checkData = seriesCheck[item.baseId];
                        if (checkData && checkData.seasons_count > 0) {
                            // Серия считается последней только если:
                            // 1. Текущий сезон === последний сезон (seasons_count)
                            // 2. Текущий эпизод >= общее количество эпизодов в сезоне (total_episodes)
                            if (item.season === checkData.seasons_count && checkData.total_episodes > 0) {
                                isLastEpisode = (item.episode >= checkData.total_episodes);
                            }
                        }
                    }
                    
                    if (isLastEpisode && item.percent >= cfg().watched_min_progress) {
                        const fav = currentFavorites.find(f => 
                            getBaseTmdbId(f.tmdb_id) === item.baseId && f.category === 'watching'
                        );
                        if (fav) {
                            const oldCategory = fav.category;
                            fav.category = 'watched';
                            fav.updated = Date.now();
                            applyCategoryRules(item.tmdbId, 'watched', currentFavorites);
                            logMove('auto_watched', item.title, oldCategory, 'watched');
                            changedLater = true;
                        }
                    }
                });
                
                if (changedLater) {
                    saveFavorites(currentFavorites);
                    refreshNewEpisodesBadge();
                }
            }, 5000);
        }
    }
    
    function clearAllFavorites() {
        Lampa.Select.show({
            title: '⚠️ Очистить всё избранное?',
            items: [
                { title: '✅ Да, очистить всё', action: 'clear' },
                { title: '❌ Отмена', action: 'cancel' }
            ],
            onSelect: (opt) => { 
                if (opt.action === 'clear') { 
                    saveFavorites([]); 
                    notify('🗑️ Избранное очищено'); 
                    logMove('clear_all', 'Все фильмы', null, null);
                    refreshNewEpisodesBadge();
                    const c = cfg();
                    if (c.sync_on_remove && c.gist_token && c.gist_id) syncToGist('favorites', false);
                } 
            },
            onBack: () => Lampa.Controller.toggle('content')
        });
    }

    // ======================
    // ТАЙМКОДЫ
    // ======================
    
    let playerInterval = null;
    let currentMovieTime = 0;
    let currentMovieKey = null;
    let lastSavedProgress = 0;
    let videoDuration = 0;
    
    function getCurrentMovieKey() {
        try {
            const activity = Lampa.Activity.active();
            if (!activity || !activity.movie) return null;
            const movie = activity.movie;
            const tmdbId = extractTmdbId(movie);
            if (!tmdbId) return null;
            
            // 1. Из playdata (сторонние источники могут передавать)
            const playerData = Lampa.Player.playdata();
            if (playerData?.season || playerData?.episode) {
                return `${tmdbId}_s${playerData.season || 1}_e${playerData.episode || 1}`;
            }
            
            // 2. Из Playlist Lampa (название текущего элемента плейлиста)
            try {
                if (typeof Lampa.Playlist !== 'undefined' && typeof Lampa.Playlist.get === 'function') {
                    const playlist = Lampa.Playlist.get();
                    if (playlist && playlist.length) {
                        // Ищем активный элемент плейлиста
                        const current = playlist.find(p => p.active || p.current) || playlist[0];
                        if (current) {
                            // Парсим из URL или title
                            const urlMatch = (current.url || '').match(/[Ss](\d+)[Ee](\d+)/);
                            if (urlMatch) {
                                return `${tmdbId}_s${urlMatch[1]}_e${urlMatch[2]}`;
                            }
                            const titleMatch = (current.title || '').match(/[Ss](\d+)[Ee](\d+)/);
                            if (titleMatch) {
                                return `${tmdbId}_s${titleMatch[1]}_e${titleMatch[2]}`;
                            }
                        }
                    }
                }
            } catch(e) {}
            
            // 3. Из video.src
            const video = document.querySelector('video');
            if (video && video.src) {
                const match = video.src.match(/[Ss](\d+)[Ee](\d+)/);
                if (match) {
                    return `${tmdbId}_s${match[1]}_e${match[2]}`;
                }
            }
            
            // 4. Для фильмов — просто tmdbId
            if (!movie.original_name) {
                return String(tmdbId);
            }
            
            // 5. Для сериалов без информации — не сохраняем
            return null;
        } catch (e) { return null; }
    }
    
    function getCurrentPlayerTime() {
        try {
            // 1. Штатный плеер Lampa
            if (Lampa.Player.opened()) {
                const playerData = Lampa.Player.playdata();
                if (playerData?.timeline?.time !== undefined) return playerData.timeline.time;
            }
            
            // 2. Video элемент (для сторонних плееров в WebView/оверлее)
            const video = document.querySelector('video');
            if (video && !isNaN(video.currentTime) && video.currentTime > 0) {
                return video.currentTime;
            }
            
            // 3. Для Android: получаем время через AndroidJS (если плеер поддерживает)
            if (typeof AndroidJS !== 'undefined' && typeof AndroidJS.getPlayerTime === 'function') {
                const time = AndroidJS.getPlayerTime();
                if (time > 0) return time;
            }
        } catch (e) {}
        return null;
    }
    
    function getVideoDuration() {
        try {
            // 1. Штатный плеер
            const playerData = Lampa.Player.playdata();
            if (playerData?.timeline?.duration && playerData.timeline.duration > 0) return playerData.timeline.duration;
            
            // 2. Video элемент
            const video = document.querySelector('video');
            if (video && video.duration && !isNaN(video.duration) && video.duration > 0 && video.duration < 36000) {
                return video.duration;
            }
            
            // 3. Android плеер
            if (typeof AndroidJS !== 'undefined' && typeof AndroidJS.getPlayerDuration === 'function') {
                const duration = AndroidJS.getPlayerDuration();
                if (duration > 0) return duration;
            }
        } catch (e) {}
        return 0;
    }
    
    function isExternalPlayerActive() {
        // Проверяем, активно ли стороннее приложение-плеер
        if (typeof AndroidJS !== 'undefined') {
            try {
                // AndroidJS может сообщать, активно ли внешнее приложение
                if (typeof AndroidJS.isExternalPlayerActive === 'function') {
                    return AndroidJS.isExternalPlayerActive();
                }
                
                // Fallback: проверяем, открыт ли Intent с видео
                if (typeof AndroidJS.getPlayerTime === 'function') {
                    const time = AndroidJS.getPlayerTime();
                    return time >= 0; // Если метод существует и возвращает число — плеер активен
                }
            } catch(e) {}
        }
        
        // Проверяем video элемент как fallback
        const video = document.querySelector('video');
        return video && !video.paused && video.currentTime > 0;
    }
    
    function saveProgress(timeInSeconds, force) {
        const c = cfg();
        if (!c.auto_save && !force) return false;
        
        let movieKey = getCurrentMovieKey();
        
        // Для внешних плееров, если ключ не определён — используем сохранённый
        if (!movieKey && currentMovieKey) {
            movieKey = currentMovieKey;
        }
        
        if (!movieKey) return false;
        
        const currentTime = Math.floor(timeInSeconds);
        const timeline = getTimeline();
        const savedTime = timeline[movieKey]?.time || 0;
        
        if (force || Math.abs(currentTime - savedTime) >= 10) {
            let duration = getVideoDuration();
            if (!duration && timeline[movieKey]?.duration) duration = timeline[movieKey].duration;
            const percent = duration > 0 ? Math.round((currentTime / duration) * 100) : 0;
            const tmdbId = extractTmdbId(Lampa.Activity.active()?.movie) || 
                           timeline[movieKey]?.tmdb_id || 
                           getBaseTmdbId(movieKey);
            
            timeline[movieKey] = { 
                time: currentTime, 
                percent, 
                duration, 
                updated: Date.now(), 
                tmdb_id: tmdbId 
            };
            saveTimeline(timeline);
            lastSavedProgress = currentTime;
            currentMovieTime = currentTime;

            
            // Сохраняем маппинг хеша для будущих синхронизаций
            try {
                if (Lampa.Timeline && typeof Lampa.Timeline.view === 'function') {
                    const tlData = Lampa.Timeline.view(0); // не используем, просто проверяем доступность
                    // Ищем хеш в file_view по нашему ключу
                    const fileName = 'file_view' + (PROFILE_ID !== 'default' ? '_' + PROFILE_ID : '');
                    const fileView = Lampa.Storage.get(fileName, {});
                    // Находим хеш, который соответствует нашему movieKey
                    const hashMap = Lampa.Storage.get('nsl_hash_map_' + PROFILE_ID, {});
                    // Если маппинга ещё нет, попробуем найти через перебор
                    if (!Object.values(hashMap).includes(movieKey)) {
                        const activity = Lampa.Activity.active();
                        const movie = activity?.movie;
                        if (movie && movie.original_name) {
                            const match = movieKey.match(/_s(\d+)_e(\d+)/);
                            if (match) {
                                const rawKey = [match[1], parseInt(match[1]) > 10 ? ':' : '', match[2], movie.original_name].join('');
                                const hash = Lampa.Utils.hash(rawKey);
                                hashMap[String(hash)] = movieKey;
                                Lampa.Storage.set('nsl_hash_map_' + PROFILE_ID, hashMap, true);
                            }
                        }
                    }
                }
            } catch(e) {}
            
            // Возвращаем в "Смотрю" если нужно
            if (tmdbId && currentTime > 60 && !returnedToWatchingMap[getBaseTmdbId(tmdbId)]) {
                returnToWatching(tmdbId);
            }
            
            return true;
        }
        return false;
    }
    
    // Обновлённая функция для внешних плееров на Android
    function onExternalPlayerTimeUpdate(time, duration) {
        if (time > 0) {
            currentMovieTime = time;
            if (duration > 0) videoDuration = duration;
            saveProgress(time, false);
        }
    }
    
    // Экспортируем для возможного вызова из AndroidJS
    window.NSL = window.NSL || {};
    window.NSL.onExternalPlayerTimeUpdate = onExternalPlayerTimeUpdate;
    window.NSL.isExternalPlayerActive = isExternalPlayerActive;
    
    function initPlayerHandler() {
        let wasActive = false;
        let lastSyncToGist = 0;
        let checkCount = 0;
        let lastMovieKey = null;
        let currentBaseId = null;
        let externalPlayerCheckInterval = null;
        
        if (playerInterval) clearInterval(playerInterval);
        if (externalPlayerCheckInterval) clearInterval(externalPlayerCheckInterval);
        
        // Основной цикл проверки (для всех плееров)
        playerInterval = setInterval(() => {
            const c = cfg();
            if (!c.enabled) return;
            
            const isPlayerOpen = Lampa.Player.opened();
            const isExternalActive = !isPlayerOpen && isExternalPlayerActive();
            const isActive = isPlayerOpen || isExternalActive;
            
            // Обнаружили начало просмотра
            if (isActive && !wasActive) {
                console.log('[NSL] Playback started', isPlayerOpen ? '(internal)' : '(external)');
                returnedToWatchingMap = {};
                videoDuration = getVideoDuration();
                lastMovieKey = null;
                currentBaseId = null;
                checkCount = 0;

                
                // Сохраняем маппинг хеша Lampa → наш ключ
                try {
                    const pd = Lampa.Player.playdata();
                    if (pd && pd.timeline && pd.timeline.hash) {
                        const nslKey = getCurrentMovieKey();
                        if (nslKey) {
                            const hashMap = Lampa.Storage.get('nsl_hash_map_' + PROFILE_ID, {});
                            if (hashMap[String(pd.timeline.hash)] !== nslKey) {
                                hashMap[String(pd.timeline.hash)] = nslKey;
                                Lampa.Storage.set('nsl_hash_map_' + PROFILE_ID, hashMap, true);
                                console.log('[NSL] Hash mapped on play:', pd.timeline.hash, '→', nslKey);
                            }
                        }
                    }
                } catch(e) {
                    console.log('[NSL] Could not map hash on play:', e.message);
                }
                
                // Для сторонних плееров — сохраняем информацию о начале просмотра
                if (!isPlayerOpen) {
                    const activity = Lampa.Activity.active();
                    if (activity && activity.movie) {
                        const tmdbId = extractTmdbId(activity.movie);
                        if (tmdbId) {
                            currentBaseId = getBaseTmdbId(tmdbId);
                            // Сохраняем минимальный ключ для отслеживания
                            const movieKey = activity.movie.original_name ? 
                                `${tmdbId}_s1_e1` : String(tmdbId);
                            currentMovieKey = movieKey;
                            lastMovieKey = movieKey;
                        }
                    }
                }
            }
            
            // Обнаружили конец просмотра
            if (!isActive && wasActive) {
                if (currentMovieTime > 0) {
                    saveProgress(currentMovieTime, true);
                    syncTimelineWithCategories();
                    if (c.auto_sync && c.gist_token && c.gist_id) {
                        syncToGist('timeline', false);
                    }
                }
                currentMovieTime = 0;
                currentMovieKey = null;
                lastSavedProgress = 0;
                videoDuration = 0;
                lastMovieKey = null;
                currentBaseId = null;
            }
            
            wasActive = isActive;
            
            // Если не активно — пропускаем
            if (!isActive) {
                checkCount++;
                return;
            }
            
            // Активно — получаем время
            const currentTime = getCurrentPlayerTime();
            if (currentTime === null || currentTime <= 0) return;
            
            currentMovieTime = currentTime;
            
            // Для внутреннего плеера получаем точный ключ
            let movieKey;
            if (isPlayerOpen) {
                movieKey = getCurrentMovieKey();
            } else {
                // Для внешнего плеера используем сохранённый ключ
                movieKey = currentMovieKey;
                
                // Пробуем уточнить ключ, если есть video элемент
                const video = document.querySelector('video');
                if (video && video.src) {
                    const newKey = getCurrentMovieKey();
                    if (newKey) movieKey = newKey;
                }
            }
            
            // Обнаружили смену серии/фильма
            if (movieKey && movieKey !== lastMovieKey) {
                // Очищаем блокировку для предыдущего фильма при смене серии
                if (currentBaseId && movieKey.indexOf(currentBaseId) === 0) {
                    // Та же карточка, просто другая серия — не сбрасываем returnedToWatchingMap
                } else {
                    // Новая карточка — сбрасываем
                    returnedToWatchingMap = {};
                }
                
                lastMovieKey = movieKey;
                currentMovieKey = movieKey;
                lastSavedProgress = 0;
                videoDuration = getVideoDuration();
                
                // Сохраняем текущий baseId
                if (isPlayerOpen) {
                    const tmdbId = extractTmdbId(Lampa.Activity.active()?.movie);
                    if (tmdbId) currentBaseId = getBaseTmdbId(tmdbId);
                }
            }
            
            // Сохраняем прогресс (каждые 10 секунд)
            if (c.auto_save && movieKey && Math.floor(currentTime) - lastSavedProgress >= 10) {
                if (saveProgress(currentTime, false)) {
                    const now = Date.now();
                    if (c.auto_sync && (now - lastSyncToGist) >= c.sync_interval * 1000) {
                        syncToGist('timeline', false);
                        lastSyncToGist = now;
                    }
                }
            }
        }, 1000);
        
        // Дополнительный цикл для Android: чаще проверяем состояние внешнего плеера
        if (typeof AndroidJS !== 'undefined') {
            externalPlayerCheckInterval = setInterval(() => {
                const isPlayerOpen = Lampa.Player.opened();
                if (!isPlayerOpen && typeof AndroidJS.getPlayerTime === 'function') {
                    try {
                        const time = AndroidJS.getPlayerTime();
                        if (time > 0 && time !== currentMovieTime) {
                            currentMovieTime = time;
                            videoDuration = AndroidJS.getPlayerDuration() || getVideoDuration();
                        }
                    } catch(e) {}
                }
            }, 2000);
        }
    }

    // ======================
    // СИНХРОНИЗАЦИЯ ТАЙМКОДОВ ИЗ ШТАТНОГО FILE_VIEW
    // ======================
    
    function syncFromFileView() {
        const fileName = 'file_view' + (PROFILE_ID !== 'default' ? '_' + PROFILE_ID : '');
        const fileView = Lampa.Storage.get(fileName, {});
        const timeline = getTimeline();
        const c = cfg();
        let changed = false;
        let foundCount = 0;
        
        const hashMap = Lampa.Storage.get('nsl_hash_map_' + PROFILE_ID, {});
        const hashKeysCount = Object.keys(hashMap).length;
        
        console.log('[NSL] syncFromFileView: fv keys:', Object.keys(fileView).length, 'map keys:', hashKeysCount);
        
        for (const hash in fileView) {
            const fvItem = fileView[hash];
            if (!fvItem || !fvItem.time || fvItem.time <= 0) continue;
            
            let nslKey = hashMap[hash];
            let foundBaseId = nslKey ? getBaseTmdbId(nslKey) : null;
            
            // Fallback: если нет в маппинге, пробуем найти через перебор избранного
            if (!nslKey) {
                const favorites = getFavorites();
                for (const fav of favorites) {
                    const cardData = fav.data || {};
                    const favTmdbId = fav.tmdb_id || extractTmdbId(cardData);
                    if (!favTmdbId) continue;
                    
                    const baseId = getBaseTmdbId(favTmdbId);
                    
                    if (cardData.original_name) {
                        // Сериал: формат [season, season>10?':':'', episode, original_name]
                        for (let s = 1; s <= 30; s++) {
                            for (let e = 1; e <= 50; e++) {
                                const rawKey = [s, s > 10 ? ':' : '', e, cardData.original_name].join('');
                                if (String(Lampa.Utils.hash(rawKey)) === String(hash)) {
                                    nslKey = baseId + '_s' + s + '_e' + e;
                                    foundBaseId = baseId;
                                    hashMap[hash] = nslKey;
                                    break;
                                }
                            }
                            if (nslKey) break;
                        }
                    } else {
                        // Фильм: хеш от original_title
                        const name = cardData.original_title || cardData.title || '';
                        if (name && String(Lampa.Utils.hash(name)) === String(hash)) {
                            nslKey = baseId;
                            foundBaseId = baseId;
                            hashMap[hash] = nslKey;
                            break;
                        }
                    }
                    if (nslKey) break;
                }
            }
            
            if (!nslKey) continue;
            
            foundCount++;
            
            const existingNSL = timeline[nslKey];
            const fvTime = fvItem.time || 0;
            const fvPercent = fvItem.percent || 0;
            const fvDuration = fvItem.duration || 0;
            
            if (!existingNSL || fvTime > existingNSL.time || 
                (fvTime === existingNSL.time && fvPercent > existingNSL.percent)) {
                
                timeline[nslKey] = {
                    time: fvTime,
                    duration: fvDuration,
                    percent: fvPercent,
                    updated: Date.now(),
                    tmdb_id: foundBaseId
                };
                changed = true;
                console.log('[NSL] Updated from file_view:', nslKey, 'time:', fvTime);
            }
        }
        
        // Сохраняем обновлённый маппинг если были найдены новые соответствия
        if (Object.keys(hashMap).length > hashKeysCount) {
            Lampa.Storage.set('nsl_hash_map_' + PROFILE_ID, hashMap, true);
            console.log('[NSL] Hash map updated, new size:', Object.keys(hashMap).length);
        }
        
        notify(`📊 FV:${Object.keys(fileView).length} Found:${foundCount} Upd:${changed ? 'YES' : 'NO'}`);
        
        if (changed) {
            saveTimeline(timeline);
            
            setTimeout(() => {
                refreshCardStatus();
                refreshFavoriteButton();
                refreshAllCardStatuses();
            }, 300);
            
            syncTimelineWithCategories();
            
            if (c.auto_sync && c.gist_token && c.gist_id) {
                syncToGist('timeline', false);
            }
        }
    }

    
    // ======================
    // СТАТУС НА КАРТОЧКЕ
    // ======================

    function getBestTimelineItem(tmdbId) {
        const timeline = getTimeline();
        const baseId = getBaseTmdbId(tmdbId);
        let bestKey = '';
        let bestItem = null;
        let bestEpisode = 0;
        let bestTime = 0;
        let bestUpdated = 0;
        
        for (const key in timeline) {
            if (getBaseTmdbId(timeline[key]?.tmdb_id) === baseId) {
                const t = timeline[key]?.time || 0;
                const updated = timeline[key]?.updated || 0;
                const hasEpisode = key.includes('_s') && key.includes('_e');
                
                if (hasEpisode) {
                    const match = key.match(/_s(\d+)_e(\d+)/);
                    const epNum = match ? parseInt(match[2]) : 0;
                    
                    // Приоритет: больше номер эпизода, при равных — свежее обновление, затем больше время
                    if (epNum > bestEpisode || 
                        (epNum === bestEpisode && updated > bestUpdated) ||
                        (epNum === bestEpisode && updated === bestUpdated && t >= bestTime)) {
                        bestEpisode = epNum;
                        bestTime = t;
                        bestUpdated = updated;
                        bestItem = timeline[key];
                        bestKey = key;
                    }
                } else if (!bestItem || updated > bestUpdated) {
                    // Для фильмов — самое свежее обновление
                    if (updated > bestUpdated || (updated === bestUpdated && t > bestTime)) {
                        bestTime = t;
                        bestUpdated = updated;
                        bestItem = timeline[key];
                        bestKey = key;
                    }
                }
            }
        }
        
        return { key: bestKey, item: bestItem, time: bestTime };
    }
    function getSeriesInfo(tmdbId) {
        const baseId = getBaseTmdbId(tmdbId);
        const seriesCheck = getSeriesCheck();
        const checkData = seriesCheck[baseId];
        
        if (checkData) {
            return {
                totalSeasons: checkData.seasons_count || 0,
                totalEpisodesInSeason: checkData.total_episodes || 0,
                lastSeasonNumber: checkData.last_season_number || 0
            };
        }
        return { totalSeasons: 0, totalEpisodesInSeason: 0, lastSeasonNumber: 0 };
    }

    function getCategoryDisplay(category, tmdbId) {
        const displays = {
            'watching': { text: 'Смотрю', icon: '👁️', color: '#4CAF50', bgColor: 'rgba(76, 175, 80, 0.15)' },
            'abandoned': { text: 'Брошено', icon: '❌', color: '#f44336', bgColor: 'rgba(244, 67, 54, 0.15)' },
            'watched': { text: 'Просмотрено', icon: '✅', color: '#2196F3', bgColor: 'rgba(33, 150, 243, 0.15)' },
            'planned': { text: 'Буду смотреть', icon: '📋', color: '#FF9800', bgColor: 'rgba(255, 152, 0, 0.15)' },
            'favorite': { text: 'В избранном', icon: '⭐', color: '#FFC107', bgColor: 'rgba(255, 193, 7, 0.15)' },
            'collection': { text: 'В коллекции', icon: '📦', color: '#9C27B0', bgColor: 'rgba(156, 39, 176, 0.15)' }
        };
        const base = displays[category];
        if (!base) return null;
        let extraInfo = '', extraText = '';
        
        if (category === 'watching' && tmdbId) {
            const best = getBestTimelineItem(tmdbId);
            
            if (best.item && best.time > 0) {
                const time = best.item.time || 0;
                const duration = best.item.duration || 0;
                const percent = best.item.percent || 0;
                
                let seasonEpisodeStr = '';
                const match = best.key.match(/_s(\d+)_e(\d+)/);
                if (match) {
                    const seriesInfo = getSeriesInfo(tmdbId);
                    const totalSeasons = seriesInfo.totalSeasons;
                    const totalEpisodesInSeason = seriesInfo.totalEpisodesInSeason;
                    const currentSeason = parseInt(match[1]);
                    const currentEpisode = parseInt(match[2]);
                    
                    const seasonStr = totalSeasons > 0 ? `Сез. ${currentSeason} из ${totalSeasons}` : `Сез. ${currentSeason}`;
                    const episodeStr = totalEpisodesInSeason > 0 ? `Сер. ${currentEpisode} из ${totalEpisodesInSeason}` : `Сер. ${currentEpisode}`;
                    
                    seasonEpisodeStr = `: ${seasonStr}; ${episodeStr}`;
                }
                
                if (duration > 0) {
                    extraInfo = `${seasonEpisodeStr}; ${formatTime(time)} из ${formatTime(duration)}`;
                    extraText = `Прогресс: ${percent}% (${formatTime(time)} из ${formatTime(duration)})`;
                } else {
                    extraInfo = `${seasonEpisodeStr}; ${formatTime(time)}`;
                    extraText = `Прогресс: ${formatTime(time)}`;
                }
            }
        }
        
        if (category === 'abandoned' && tmdbId) {
            const favorites = getFavorites();
            const baseId = getBaseTmdbId(tmdbId);
            const item = favorites.find(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === 'abandoned');
            if (item) {
                const lastUpdate = item.updated || item.added;
                const daysAgo = Math.floor((Date.now() - lastUpdate) / (1000 * 60 * 60 * 24));
                if (daysAgo > 0) { extraInfo = daysAgo === 1 ? ' 1 день' : ` ${daysAgo} дн.`; extraText = `Не смотрели ${daysAgo} ${getDaysWord(daysAgo)}`; }
            }
        }
        return { ...base, displayText: base.text + extraInfo, extraText, category };
    }

    function getDaysWord(days) {
        if (days % 10 === 1 && days % 100 !== 11) return 'день';
        if (days % 10 >= 2 && days % 10 <= 4 && (days % 100 < 10 || days % 100 >= 20)) return 'дня';
        return 'дней';
    }

    function getMovieStatus(movie) {
        const tmdbId = extractTmdbId(movie);
        if (!tmdbId) return null;
        const baseId = getBaseTmdbId(tmdbId);
        const favorites = getFavorites();
        const movieCategories = favorites.filter(f => getBaseTmdbId(f.tmdb_id) === baseId).map(f => f.category);
        if (movieCategories.length === 0) return null;
        let bestCategory = null, bestPriority = 999;
        for (const cat of movieCategories) {
            const priority = STATUS_PRIORITY[cat] || 999;
            if (priority < bestPriority) { bestPriority = priority; bestCategory = cat; }
        }
        if (bestCategory === 'collection' && movieCategories.length > 1) {
            for (const cat of movieCategories) {
                if (cat !== 'collection') {
                    const priority = STATUS_PRIORITY[cat] || 999;
                    if (priority < bestPriority) { bestPriority = priority; bestCategory = cat; }
                }
            }
        }
        if (bestCategory === 'favorite' && movieCategories.length > 1) {
            for (const cat of movieCategories) {
                if (cat !== 'favorite' && cat !== 'collection') return getCategoryDisplay(cat, tmdbId);
            }
        }
        return getCategoryDisplay(bestCategory, tmdbId);
    }

    function addStatusToCard() {
        Lampa.Listener.follow('full', function (e) {
            if (e.type == 'complite') {
                setTimeout(() => {
                    try {
                        const movie = e.data.movie || e.data.card;
                        if (!movie || !movie.id) return;
                        if (!e.object || !e.object.activity) return;
                        const render = e.object.activity.render();
                        const statusContainer = render.find('.full-start__status').first();
                        if (!statusContainer.length) return;
                        render.find('.nsl-movie-status').remove();
                        const status = getMovieStatus(movie);
                        if (!status) return;
                        const statusEl = $(`<div class="full-start__status nsl-movie-status" style="margin-left:8px;display:flex;align-items:center;gap:6px;padding:0 12px;height:32px;border-radius:4px;background-color:rgba(0,0,0,0.4);color:rgba(255,255,255,0.9)!important;font-size:16px!important;font-weight:400;cursor:help;white-space:nowrap;border:none;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);" title="${status.extraText || status.text}"><span style="font-size:16px!important;line-height:1;">${status.icon}</span><span style="font-size:16px!important;line-height:1;">${status.displayText}</span></div>`);
                        statusContainer.after(statusEl);
                    } catch (err) { console.error('[NSL] Error adding status:', err); }
                }, 300);
            }
        });
    }
    
    function refreshCardStatus() {
        const activity = Lampa.Activity.active();
        const movie = activity?.movie || activity?.card;
        if (!movie) return;
        $('.nsl-movie-status').remove();
        const status = getMovieStatus(movie);
        if (!status) return;
        const statusContainer = $('.full-start__status').first();
        if (!statusContainer.length) return;
        const statusEl = $(`<div class="full-start__status nsl-movie-status" style="margin-left:8px;display:flex;align-items:center;gap:6px;padding:0 12px;height:32px;border-radius:4px;background-color:rgba(0,0,0,0.4);color:rgba(255,255,255,0.9)!important;font-size:16px!important;font-weight:400;cursor:help;white-space:nowrap;border:none;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);" title="${status.extraText || status.text}"><span style="font-size:16px!important;line-height:1;">${status.icon}</span><span style="font-size:16px!important;line-height:1;">${status.displayText}</span></div>`);
        statusContainer.after(statusEl);
    }

    function refreshFavoriteButton() {
        const movie = Lampa.Activity.active()?.movie;
        if (!movie) return;
        const button = $('.nsl-favorite-button');
        if (!button.length) return;
        const tmdbId = extractTmdbId(movie);
        const baseId = getBaseTmdbId(tmdbId);
        const favorites = getFavorites();
        const isAny = favorites.some(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category !== 'collection');
        button.find('path').attr('fill', isAny ? 'currentColor' : 'none');
    }

    // ======================
    // КНОПКА НА КАРТОЧКЕ
    // ======================
    
    function addFavoriteButtonToCard() {
        Lampa.Listener.follow('full', function (e) {
            if (e.type == 'complite') {
                setTimeout(() => {
                    try {
                        const movie = e.data.movie || e.data.card;
                        if (!movie || !movie.id) return;
                        if (!e.object || !e.object.activity) return;
                        const render = e.object.activity.render();
                        const container = render.find('.full-start-new__buttons, .full-start__buttons').first();
                        if (!container.length) return;
                        container.find('.nsl-favorite-button').remove();
                        const isFavorite = isInFavorites(movie, 'favorite');
                        const button = $(`<div class="full-start__button selector nsl-favorite-button" tabindex="0" role="button"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z"/></svg><span>В избранное</span></div>`);
                        button.on('hover:enter', () => {
                            const categories = [
                                { id: 'favorite', name: 'Избранное', checked: isInFavorites(movie, 'favorite') },
                                { id: 'watching', name: 'Смотрю', checked: isInFavorites(movie, 'watching') },
                                { id: 'planned', name: 'Буду смотреть', checked: isInFavorites(movie, 'planned') },
                                { id: 'watched', name: 'Просмотрено', checked: isInFavorites(movie, 'watched') },
                                { id: 'abandoned', name: 'Брошено', checked: isInFavorites(movie, 'abandoned') },
                                { id: 'collection', name: 'Коллекция', checked: isInFavorites(movie, 'collection') }
                            ];
                            const items = categories.map(cat => ({ title: cat.name, checkbox: true, checked: cat.checked, category: cat.id }));
                            items.push({ title: '──────────', separator: true }, { title: '❌ Закрыть', action: 'close' });
                            Lampa.Select.show({
                                title: 'Добавить в избранное', items,
                                onCheck: (item) => {
                                    setTimeout(() => {
                                        toggleFavorite(movie, item.category);
                                        button.find('path').attr('fill', isInFavorites(movie, 'favorite') ? 'currentColor' : 'none');
                                        refreshCardStatus();
                                    }, 50);
                                },
                                onSelect: (item) => {
                                    if (item.action === 'close') return;
                                    setTimeout(() => {
                                        toggleFavorite(movie, item.category);
                                        button.find('path').attr('fill', isInFavorites(movie, 'favorite') ? 'currentColor' : 'none');
                                        refreshCardStatus();
                                    }, 50);
                                },
                                onBack: () => Lampa.Controller.toggle('content')
                            });
                        });
                        const bookBtn = container.find('.button--book').first();
                        if (bookBtn.length) bookBtn.before(button); else container.prepend(button);
                        
                        if (cfg().hide_lampa_bookmark_button) {
                            container.find('.button--book').addClass('nsl-hidden-lampa-button');
                        }
                        
                        if (isAndroid && Lampa.Controller) {
                            setTimeout(() => {
                                Lampa.Controller.collectionSet(container);
                            }, 100);
                        }
                        
                        // ===== СИНХРОНИЗАЦИЯ ТАЙМКОДОВ: NSL → FILE_VIEW =====
                        const timeline = getTimeline();
                        const tmdbId = extractTmdbId(movie);
                        const baseId = getBaseTmdbId(tmdbId);
                        
                        // Собираем лучший таймкод
                        let bestKey = null;
                        let bestTime = 0;
                        let bestDuration = 0;
                        let bestPercent = 0;
                        let bestUpdated = 0;
                        
                        for (const key in timeline) {
                            if (getBaseTmdbId(timeline[key]?.tmdb_id) === baseId) {
                                const t = timeline[key];
                                const updated = t.updated || 0;
                                
                                if (movie.original_name) {
                                    const hasEpisode = key.includes('_s') && key.includes('_e');
                                    if (hasEpisode) {
                                        const match = key.match(/_s(\d+)_e(\d+)/);
                                        const epNum = match ? parseInt(match[2]) : 0;
                                        const oldMatch = bestKey?.match(/_s(\d+)_e(\d+)/);
                                        const oldEpNum = oldMatch ? parseInt(oldMatch[2]) : 0;
                                        
                                        if (epNum > oldEpNum || 
                                            (epNum === oldEpNum && updated > bestUpdated) ||
                                            (epNum === oldEpNum && updated === bestUpdated && (t.time || 0) > bestTime)) {
                                            bestKey = key;
                                            bestTime = t.time || 0;
                                            bestDuration = t.duration || 0;
                                            bestPercent = t.percent || 0;
                                            bestUpdated = updated;
                                        }
                                    }
                                } else {
                                    if (!bestKey || updated > bestUpdated || 
                                        (updated === bestUpdated && (t.time || 0) > bestTime)) {
                                        bestKey = key;
                                        bestTime = t.time || 0;
                                        bestDuration = t.duration || 0;
                                        bestPercent = t.percent || 0;
                                        bestUpdated = updated;
                                    }
                                }
                            }
                        }
                        
                        if (bestKey && bestTime > 0) {
                            // Формируем хеш для file_view по формату Lampa
                            let fileViewHash;
                            if (bestKey.includes('_s') && bestKey.includes('_e')) {
                                const match = bestKey.match(/_s(\d+)_e(\d+)/);
                                const season = match[1];
                                const episode = match[2];
                                const name = movie.original_name || movie.original_title || movie.title || movie.name || '';
                                const rawKey = [season, season > 10 ? ':' : '', episode, name].join('');
                                fileViewHash = Lampa.Utils.hash(rawKey);
                            } else {
                                const name = movie.original_title || movie.title || movie.original_name || movie.name || '';
                                fileViewHash = Lampa.Utils.hash(name);
                            }
                            
                            // Обновляем file_view
                            const fileName = 'file_view' + (PROFILE_ID !== 'default' ? '_' + PROFILE_ID : '');
                            const fileView = Lampa.Storage.get(fileName, {});
                            fileView[fileViewHash] = {
                                time: bestTime,
                                duration: bestDuration,
                                percent: bestPercent,
                                profile: getProfileId()
                            };
                            Lampa.Storage.set(fileName, fileView, true);
                            
                            // Сохраняем маппинг хеш → nsl_key
                            const hashMapping = Lampa.Storage.get('nsl_hash_mapping_' + PROFILE_ID, {});
                            hashMapping[String(fileViewHash)] = bestKey;
                            Lampa.Storage.set('nsl_hash_mapping_' + PROFILE_ID, hashMapping, true);
                            
                            console.log('[NSL] Synced to file_view:', bestKey, '→ hash:', fileViewHash, 'time:', bestTime);
                            
                            // Для штатного плеера — устанавливаем время продолжения
                            if (bestTime > 60) {
                                setTimeout(() => {
                                    if (Lampa.Player.opened() && Lampa.Player.playdata) {
                                        const pd = Lampa.Player.playdata();
                                        if (pd?.timeline) {
                                            pd.timeline.time = bestTime;
                                        }
                                    }
                                }, 2000);
                            }
                        }
                        
                    } catch (err) { console.error('[NSL] Error:', err.message); }
                }, 500);
            }
        });
        window.nslInsertButton = function() {};
    }

    // ======================
    // МЕНЮ (С ПОСТЕРАМИ И ГОДОМ)
    // ======================
    
    function addFavoritesToMenu() {
        const menuList = $('.menu__list').eq(0);
        if (!menuList.length) return;
        if ($('.nsl-favorites-item').length) return;
        const newEpisodesCount = getNewEpisodesCount();
        const badge = newEpisodesCount > 0 ? ` <span class="nsl-badge" style="background:#f44336;color:#fff;border-radius:50%;padding:0 0.3em;font-size:0.8em;margin-left:0.5em;">🔔${newEpisodesCount}</span>` : '';
        const el = $(`<li class="menu__item selector nsl-favorites-item"><div class="menu__ico"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" stroke="currentColor" stroke-width="1" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg></div><div class="menu__text">Избpаннoe${badge}</div></li>`);
        el.on('hover:enter', (e) => { e.stopPropagation(); showFavoritesMenu(); });
        menuList.append(el);
    }
    
    function refreshNewEpisodesBadge() {
        const badgeEl = $('.nsl-favorites-item .menu__text');
        if (!badgeEl.length) return;
        const newEpisodesCount = getNewEpisodesCount();
        badgeEl.find('.nsl-badge').remove();
        if (newEpisodesCount > 0) {
            badgeEl.append(` <span class="nsl-badge" style="background:#f44336;color:#fff;border-radius:50%;padding:0 0.3em;font-size:0.8em;margin-left:0.5em;">🔔${newEpisodesCount}</span>`);
        }
    }
    
    function showFavoritesMenu() {
        Lampa.Select.show({
            title: '⭐ Избранное+',
            items: [
                { title: '📋 Мои списки', onSelect: () => showMyLists() },
                { title: '🔧 Инструменты', onSelect: () => showTools() },
                { title: '──────────', separator: true },
                { title: '🗑️ Очистить всё', onSelect: () => clearAllFavorites() },
                { title: '❌ Закрыть', onSelect: () => Lampa.Controller.toggle('content') }
            ],
            onBack: () => Lampa.Controller.toggle('content')
        });
    }
    
    function showMyLists() {
        const newEpisodesCount = getNewEpisodesCount();
        const unfinishedCount = getUnfinishedCount();
        
        const items = FAVORITE_CATEGORIES.map(cat => {
            const count = getFavoritesByCategory(cat.id).length;
            let extra = '';
            if (cat.id === 'watching' && unfinishedCount > 0) {
                extra = ' 🔄';
            }
            return { title: `${cat.icon} ${cat.name} (${count})${extra}`, onSelect: () => showFavoritesByCategory(cat.id, cat.name) };
        });
        
        if (newEpisodesCount > 0) {
            items.push({ title: '──────────', separator: true });
            items.push({ title: `🔔 Новые серии (${newEpisodesCount})`, onSelect: () => showNewEpisodes() });
        }
        
        items.push({ title: '──────────', separator: true });
        items.push({ title: '◀ Назад', onSelect: () => showFavoritesMenu() });
        items.push({ title: '❌ Закрыть', onSelect: () => Lampa.Controller.toggle('content') });
        
        const title = newEpisodesCount > 0 ? `📋 Мои списки 🔔${newEpisodesCount}` : '📋 Мои списки';
        Lampa.Select.show({ title, items, onBack: () => showFavoritesMenu() });
    }
    
    function getUnfinishedCount() {
        const now = Date.now();
        const remindAfter = 7 * 24 * 60 * 60 * 1000;
        const timeline = getTimeline();
        const favorites = getFavorites();
        
        return favorites.filter(f => {
            if (f.category !== 'watching') return false;
            const lastUpdate = f.updated || f.added;
            if (now - lastUpdate < remindAfter) return false;
            const baseId = getBaseTmdbId(f.tmdb_id);
            let maxPercent = 0;
            for (const key in timeline) {
                if (getBaseTmdbId(timeline[key]?.tmdb_id) === baseId) {
                    maxPercent = Math.max(maxPercent, timeline[key].percent || 0);
                }
            }
            return maxPercent >= 20 && maxPercent <= 80;
        }).length;
    }
    
    function showTools() {
        const items = [
            { title: '▶ Продолжить просмотр', onSelect: () => continueLastWatching() },
            { title: '🎲 Случайный фильм', onSelect: () => showRandomMovie() },
            { title: '🔍 Поиск по избранному', onSelect: () => searchFavorites() },
            { title: '📊 Статистика просмотров', onSelect: () => showWatchStats() },
            { title: '🕐 История просмотров', onSelect: () => showHistory() },
            { title: '──────────', separator: true },
            { title: '◀ Назад', onSelect: () => showFavoritesMenu() },
            { title: '❌ Закрыть', onSelect: () => Lampa.Controller.toggle('content') }
        ];
        
        Lampa.Select.show({ title: '🔧 Инструменты', items, onBack: () => showFavoritesMenu() });
    }

    function showRandomMovie() {
        const favorites = getFavorites();
        const pool = favorites.filter(f => f.category === 'planned' || f.category === 'favorite');
        
        if (pool.length === 0) {
            notify('Добавьте фильмы в «Буду смотреть» или «Избранное»');
            return;
        }
        
        const random = pool[Math.floor(Math.random() * pool.length)];
        const cardData = random.data || {};
        const method = (random.media_type === 'tv' || cardData.original_name) ? 'tv' : 'movie';
        const cardId = cardData.id || random.card_id || getBaseTmdbId(random.tmdb_id);
        const source = cardData.source || 'tmdb';
        
        Lampa.Activity.push({
            id: cardId, method,
            card: { id: cardId, source, title: cardData.title, name: cardData.name, original_name: cardData.original_name, original_title: cardData.original_title, poster_path: cardData.poster_path, backdrop_path: cardData.backdrop_path, overview: cardData.overview, vote_average: cardData.vote_average, first_air_date: cardData.first_air_date, release_date: cardData.release_date, img: cardData.img },
            url: '', component: 'full', source, page: 1
        });
        
        notify(`🎲 "${cardData.title || cardData.name}"`);
    }
    
    function showFavoritesByCategory(category, categoryName) {
        const items = getFavoritesByCategory(category);
        if (items.length === 0) { notify(`В "${categoryName}" ничего нет`); return; }
        const grouped = {};
        for (const type in MEDIA_TYPES) grouped[type] = items.filter(item => item.media_type === type);
        const menuItems = [];
        menuItems.push({ title: '📋 Сортировка: по названию', onSelect: () => showSortedFavoritesList(items, `${categoryName} (по названию)`, category, 'title') });
        menuItems.push({ title: '📋 Сортировка: по дате добавления', onSelect: () => showSortedFavoritesList(items, `${categoryName} (по дате добавления)`, category, 'added') });
        menuItems.push({ title: '📋 Сортировка: по дате выхода', onSelect: () => showSortedFavoritesList(items, `${categoryName} (по дате выхода)`, category, 'year') });
        menuItems.push({ title: '──────────', separator: true });
        for (const [type, typeItems] of Object.entries(grouped)) {
            if (typeItems.length > 0) {
                const typeInfo = MEDIA_TYPES[type];
                menuItems.push({ title: `${typeInfo.icon} ${typeInfo.name} (${typeItems.length})`, onSelect: () => showFavoritesList(typeItems, `${categoryName} - ${typeInfo.name}`, category) });
            }
        }
        menuItems.push({ title: '──────────', separator: true });
        menuItems.push({ title: '◀ Назад', onSelect: () => showFavoritesMenu() });
        menuItems.push({ title: '❌ Закрыть', onSelect: () => Lampa.Controller.toggle('content') });
        Lampa.Select.show({ title: categoryName, items: menuItems, onBack: () => showFavoritesMenu() });
    }
    
    function showSortedFavoritesList(items, categoryName, category, sortMode) {
        let sorted = [...items];
        if (sortMode === 'added') sorted.sort((a, b) => (b.added || 0) - (a.added || 0));
        else if (sortMode === 'year') sorted.sort((a, b) => { const ya = a.data?.release_date || a.data?.first_air_date || '0000'; const yb = b.data?.release_date || b.data?.first_air_date || '0000'; return yb.localeCompare(ya); });
        else sorted.sort((a, b) => { const ta = (a.data?.title || a.data?.name || '').toLowerCase(); const tb = (b.data?.title || b.data?.name || '').toLowerCase(); return ta.localeCompare(tb); });
        showFavoritesList(sorted, categoryName, category);
    }

    function continueLastWatching() {
        const timeline = getTimeline();
        const favorites = getFavorites();
        
        let bestItem = null;
        let bestTime = 0;
        
        const watchingItems = favorites.filter(f => f.category === 'watching');
        
        watchingItems.forEach(f => {
            const baseId = getBaseTmdbId(f.tmdb_id);
            for (const key in timeline) {
                if (getBaseTmdbId(timeline[key]?.tmdb_id) === baseId) {
                    const time = timeline[key].updated || 0;
                    const percent = timeline[key].percent || 0;
                    if (time > bestTime && percent >= 5 && percent <= 95) {
                        bestTime = time;
                        bestItem = f;
                    }
                }
            }
        });
        
        if (!bestItem) {
            notify('Нет фильмов для продолжения просмотра');
            return;
        }
        
        const cardData = bestItem.data || {};
        const method = (bestItem.media_type === 'tv' || cardData.original_name) ? 'tv' : 'movie';
        const cardId = cardData.id || bestItem.card_id || getBaseTmdbId(bestItem.tmdb_id);
        const source = cardData.source || 'tmdb';
        
        Lampa.Activity.push({
            id: cardId, method,
            card: { id: cardId, source, title: cardData.title, name: cardData.name, original_name: cardData.original_name, original_title: cardData.original_title, poster_path: cardData.poster_path, backdrop_path: cardData.backdrop_path, overview: cardData.overview, vote_average: cardData.vote_average, first_air_date: cardData.first_air_date, release_date: cardData.release_date, img: cardData.img },
            url: '', component: 'full', source, page: 1
        });
        
        const title = cardData.title || cardData.name || 'Без названия';
        notify(`▶ ${title}`);
    }
    
    function searchFavorites() {
        Lampa.Input.edit({ title: 'Поиск по избранному', value: '', free: true }, (query) => {
            if (!query || !query.trim()) { notify('Введите название для поиска'); return; }
            const q = query.toLowerCase().trim();
            const allItems = getFavorites().filter(item => (item.data?.title || item.data?.name || '').toLowerCase().includes(q));
            if (allItems.length === 0) { notify('Ничего не найдено'); return; }
            const menuItems = allItems.map(item => {
                const cardData = item.data || {};
                const itemTitle = cardData.title || cardData.name || 'Без названия';
                const year = extractYear(cardData);
                const posterUrl = getPosterUrl(cardData);
                let sub = '';
                if (item.media_type === 'tv' || cardData.original_name) {
                    const checkData = getSeriesCheck()[getBaseTmdbId(item.tmdb_id)];
                    sub = checkData?.seasons_count ? `${checkData.seasons_count} сез.` : '';
                }
                return {
                    title: `<div style="display:flex;align-items:center;gap:0.6em;min-height:3.8em;padding:0.2em 0;">${posterUrl ? `<img src="${posterUrl}" style="width:2.8em;height:4em;object-fit:cover;border-radius:0.3em;flex-shrink:0;">` : '<div style="width:2.8em;height:4em;background:#333;border-radius:0.3em;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.5em;">🎬</div>'}<div style="flex:1;min-width:0;"><div style="font-size:1.1em;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${itemTitle}${year ? ` (${year})` : ''}</div><div style="font-size:0.85em;opacity:0.7;">${FAVORITE_CATEGORIES.find(c => c.id === item.category)?.name || ''}${sub ? ' · ' + sub : ''}</div></div></div>`,
                    item, onSelect: () => {
                        const method = (item.media_type === 'tv' || cardData.original_name) ? 'tv' : 'movie';
                        const cardId = cardData.id || item.card_id || getBaseTmdbId(item.tmdb_id);
                        const source = cardData.source || 'tmdb';
                        Lampa.Activity.push({ id: cardId, method, card: { id: cardId, source, title: cardData.title, name: cardData.name, original_name: cardData.original_name, original_title: cardData.original_title, poster_path: cardData.poster_path, backdrop_path: cardData.backdrop_path, overview: cardData.overview, vote_average: cardData.vote_average, first_air_date: cardData.first_air_date, release_date: cardData.release_date, img: cardData.img }, url: '', component: 'full', source, page: 1 });
                    }
                };
            });
            menuItems.push({ title: '❌ Закрыть', onSelect: () => Lampa.Controller.toggle('content') });
            Lampa.Select.show({ title: `🔍 Найдено: ${allItems.length}`, items: menuItems, onBack: () => Lampa.Controller.toggle('content') });
        }, () => {});
    }

    function extractYear(cardData) {
        if (cardData.release_date) return cardData.release_date.slice(0,4);
        if (cardData.first_air_date) return cardData.first_air_date.slice(0,4);
        return '';
    }
    
    function showNewEpisodes() {
        const newEpisodes = getNewEpisodesList();
        if (newEpisodes.length === 0) { notify('Новых серий нет'); return; }
        const menuItems = newEpisodes.map(item => {
            const cardData = item.data || {};
            const title = cardData.title || cardData.name || 'Без названия';
            const year = cardData.release_date ? cardData.release_date.slice(0,4) : (cardData.first_air_date ? cardData.first_air_date.slice(0,4) : '');
            const posterUrl = getPosterUrl(cardData);
            const yearStr = year ? ` (${year})` : '';
            let episodeInfo = '';
            if (item.aired_episodes > 0 && item.total_episodes > 0) episodeInfo = `${item.aired_episodes} из ${item.total_episodes} серий`;
            else if (item.new_seasons) episodeInfo = `S${item.new_seasons}`;
            const newInfo = item.old_seasons && item.new_seasons > item.old_seasons ? ` +${item.new_seasons - item.old_seasons} сезон` : ' 🔔';
            return {
                title: `<div style="display:flex;align-items:center;gap:0.6em;min-height:3.8em;padding:0.2em 0;">${posterUrl ? `<img src="${posterUrl}" style="width:2.8em;height:4em;object-fit:cover;border-radius:0.3em;flex-shrink:0;" onerror="this.style.display='none'">` : '<div style="width:2.8em;height:4em;background:#333;border-radius:0.3em;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.5em;">🎬</div>'}<div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:0.2em;"><div style="font-size:1.1em;line-height:1.3;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word;">${title}${yearStr}</div><div style="font-size:0.85em;opacity:0.8;line-height:1.2;">${newInfo}${episodeInfo ? ' · ' + episodeInfo : ''}</div></div></div>`,
                sub: `Было: S${item.old_seasons || '?'} → Стало: S${item.new_seasons || '?'}`, item,
                onSelect: () => {
                    let method = 'movie';
                    if (item.media_type === 'tv' || cardData.original_name) method = 'tv';
                    const cardId = cardData.id || item.card_id || getBaseTmdbId(item.tmdb_id);
                    const source = cardData.source || 'tmdb';
                    const cardObject = { id: cardId, source, title: cardData.title, name: cardData.name, original_name: cardData.original_name, original_title: cardData.original_title, poster_path: cardData.poster_path, backdrop_path: cardData.backdrop_path, overview: cardData.overview, vote_average: cardData.vote_average, first_air_date: cardData.first_air_date, release_date: cardData.release_date, img: cardData.img };
                    Object.keys(cardObject).forEach(key => { if (cardObject[key] === undefined) delete cardObject[key]; });
                    Lampa.Activity.push({ id: cardId, method, card: cardObject, url: '', component: 'full', source, page: 1 });
                    markNewEpisodesSeen(item.tmdb_id);
                }
            };
        });
        menuItems.push({ title: '──────────', separator: true });
        menuItems.push({ 
            title: '✅ Отметить всё просмотренным', 
            onSelect: () => {
                Lampa.Select.show({
                    title: '⚠️ Отметить все новые серии просмотренными?',
                    items: [
                        { title: '✅ Да', action: 'confirm' },
                        { title: '❌ Отмена', action: 'cancel' }
                    ],
                    onSelect: (opt) => {
                        if (opt.action === 'confirm') {
                            clearAllNewEpisodes();
                            notify('✅ Все новые серии отмечены');
                        }
                    },
                    onBack: () => Lampa.Controller.toggle('content')
                });
            }
        });
        menuItems.push({ title: '◀ Назад', onSelect: () => showFavoritesMenu() });
        menuItems.push({ title: '❌ Закрыть', onSelect: () => Lampa.Controller.toggle('content') });
        Lampa.Select.show({ title: '🔔 Новые серии', items: menuItems, onBack: () => showFavoritesMenu() });
    }
    
    function getPosterUrl(cardData) {
        if (cardData.poster_path) return Lampa.TMDB.image('t/p/w92' + cardData.poster_path);
        return null;
    }
    
    function showFavoritesList(items, title, currentCategory) {
        const timeline = getTimeline();
        const menuItems = items.map(item => {
            let sub = '';
            const cardData = item.data || {};
            const itemTitle = cardData.title || cardData.name || 'Без названия';
            const year = cardData.release_date ? cardData.release_date.slice(0,4) : (cardData.first_air_date ? cardData.first_air_date.slice(0,4) : '');
            const yearStr = year ? ` (${year})` : '';
            const posterUrl = getPosterUrl(cardData);
            let seriesInfo = '';
            if (item.media_type === 'tv' || cardData.original_name) {
                const baseId = getBaseTmdbId(item.tmdb_id);
                const checkData = getSeriesCheck()[baseId];
                if (checkData && checkData.seasons_count > 0) {
                    seriesInfo = `${checkData.seasons_count} сез.`;
                    if (checkData.total_episodes > 0) seriesInfo += ` · ${checkData.total_episodes} сер.`;
                    if (checkData.last_air_date) {
                        try {
                            const airDate = new Date(checkData.last_air_date);
                            const months = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
                            const dateStr = `${airDate.getDate()} ${months[airDate.getMonth()]}`;
                            seriesInfo += ` · ${dateStr}`;
                        } catch(e) {}
                    }
                } else if (cardData.number_of_seasons) {
                    seriesInfo = `${cardData.number_of_seasons} сез.`;
                }
            }
            if (item.category === 'watching') {
                const baseId = getBaseTmdbId(item.tmdb_id);
                let timelineItem = null;
                for (const key in timeline) { if (getBaseTmdbId(timeline[key].tmdb_id) === baseId) { timelineItem = timeline[key]; break; } }
                const parts = [];
                if (seriesInfo) parts.push(seriesInfo);
                if (timelineItem) {
                    const time = timelineItem.time || 0;
                    const duration = timelineItem.duration || 0;
                    if (duration > 0) {
                        parts.push(`${formatTime(time)} из ${formatTime(duration)}`);
                    } else {
                        parts.push(`${timelineItem.percent || 0}%`);
                    }
                }
                sub = parts.join(' · ');
            } else if (item.category === 'watched') {
                sub = '✓ Просмотрено';
                if (seriesInfo) sub += ' · ' + seriesInfo;
            } else if (item.category === 'abandoned') {
                sub = '❌ Брошено';
                if (seriesInfo) sub += ' · ' + seriesInfo;
            } else if (item.category === 'planned') sub = seriesInfo || 'В планах';
            else if (seriesInfo) sub = seriesInfo;
            
            return {
                title: `<div style="display:flex;align-items:center;gap:0.6em;min-height:3.8em;padding:0.2em 0;">${posterUrl ? `<img src="${posterUrl}" style="width:2.8em;height:4em;object-fit:cover;border-radius:0.3em;flex-shrink:0;" onerror="this.style.display='none'">` : '<div style="width:2.8em;height:4em;background:#333;border-radius:0.3em;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.5em;">🎬</div>'}<div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:0.2em;"><div style="font-size:1.1em;line-height:1.3;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word;">${itemTitle}${yearStr}</div>${sub ? `<div class="nsl-subtitle-line" style="font-size:0.85em;opacity:0.8;line-height:1.2;">${sub}</div>` : '<div class="nsl-subtitle-line" style="font-size:0.85em;opacity:0.8;line-height:1.2;"></div>'}</div></div>`,
                sub: '', item,
                onSelect: () => {
                    let method = 'movie';
                    if (item.media_type === 'tv' || cardData.original_name) method = 'tv';
                    const cardId = cardData.id || item.card_id || getBaseTmdbId(item.tmdb_id);
                    const source = cardData.source || 'tmdb';
                    const cardObject = { id: cardId, source, title: cardData.title, name: cardData.name, original_name: cardData.original_name, original_title: cardData.original_title, poster_path: cardData.poster_path, backdrop_path: cardData.backdrop_path, overview: cardData.overview, vote_average: cardData.vote_average, first_air_date: cardData.first_air_date, release_date: cardData.release_date, img: cardData.img };
                    Object.keys(cardObject).forEach(key => { if (cardObject[key] === undefined) delete cardObject[key]; });
                    Lampa.Activity.push({ id: cardId, method, card: cardObject, url: '', component: 'full', source, page: 1 });
                },
                onLongPress: null
            };
        });
        menuItems.push({ title: '──────────', separator: true });
        menuItems.push({ title: '◀ Назад', onSelect: () => showFavoritesByCategory(items[0]?.category, title.split(' - ')[0]) });
        menuItems.push({ title: '❌ Закрыть', onSelect: () => Lampa.Controller.toggle('content') });
        Lampa.Select.show({ title, items: menuItems, onBack: () => showFavoritesByCategory(items[0]?.category, title.split(' - ')[0]),
            onFullDraw: (scroll) => {
                const itemsElements = scroll.render().find('.selectbox-item');
                menuItems.forEach((menuItem, index) => {
                    if (!menuItem || !menuItem.item) return;
                    const item = menuItem.item;
                    const cardData = item.data || {};
                    if (item.media_type === 'tv' || cardData.original_name) {
                        loadSeriesDataQuick(item.tmdb_id, (checkData) => {
                            const el = $(itemsElements[index]);
                            if (!el.length || !checkData) return;
                            let newSeriesInfo = '';
                            if (checkData.seasons_count > 0) {
                                newSeriesInfo = `${checkData.seasons_count} сез.`;
                                if (checkData.total_episodes > 0) newSeriesInfo += ` · ${checkData.total_episodes} сер.`;
                                if (checkData.last_air_date) {
                                    try {
                                        const airDate = new Date(checkData.last_air_date);
                                        const months = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
                                        newSeriesInfo += ` · ${airDate.getDate()} ${months[airDate.getMonth()]}`;
                                    } catch(e) {}
                                }
                            }
                            if (!newSeriesInfo) return;
                            const subtitleLine = el.find('.nsl-subtitle-line');
                            if (!subtitleLine.length) return;
                            const currentText = subtitleLine.text().trim();
                            const percentMatch = currentText.match(/(\d+%)/);
                            let finalText = newSeriesInfo;
                            if (percentMatch) finalText += ' · ' + percentMatch[1];
                            if (item.category === 'watched') finalText = '✓ Просмотрено · ' + newSeriesInfo;
                            if (item.category === 'abandoned') finalText = '❌ Брошено · ' + newSeriesInfo;
                            subtitleLine.text(finalText);
                        });
                    }
                });
                itemsElements.each((index, element) => {
                    const menuItem = menuItems[index];
                    if (!menuItem || !menuItem.item) return;
                    const item = menuItem.item;
                    const el = $(element);
                    if (menuItem.title && menuItem.title.indexOf('<img') !== -1) {
                        el.css('min-height', '5em'); el.css('display', 'flex'); el.css('align-items', 'center');
                    }
                    el.on('hover:long', (e) => {
                        e.stopPropagation();
                        const actionItems = [
                            { title: `📋 Переместить в...`, action: 'move' },
                            { title: `🗑️ Удалить из категории`, action: 'remove' },
                            { title: `💥 Удалить из Избранное+`, action: 'delete_all' },
                            { title: '❌ Отмена', action: 'cancel' }
                        ];
                        Lampa.Select.show({
                            title: `Действия с "${item.data?.title || item.data?.name || 'Без названия'}"`, items: actionItems,
                            onSelect: (opt) => {
                                if (opt.action === 'move') showMoveMenu(item);
                                else if (opt.action === 'remove') {
                                    removeFromFavorites(item.data, item.category);
                                    showFavoritesByCategory(currentCategory, title.split(' - ')[0]);
                                    notify(`Удалено из "${FAVORITE_CATEGORIES.find(c => c.id === item.category)?.name}"`);
                                } else if (opt.action === 'delete_all') {
                                    Lampa.Select.show({
                                        title: '⚠️ Удалить полностью?',
                                        items: [{ title: '✅ Да, удалить всё', action: 'confirm' }, { title: '❌ Отмена', action: 'cancel' }],
                                        onSelect: (opt2) => { if (opt2.action === 'confirm') { deleteCompletely(item); showFavoritesByCategory(currentCategory, title.split(' - ')[0]); } },
                                        onBack: () => Lampa.Controller.toggle('content')
                                    });
                                }
                            },
                            onBack: () => Lampa.Controller.toggle('content')
                        });
                    });
                });
            }
        });
    }
    
    function showMoveMenu(item) {
        const categories = FAVORITE_CATEGORIES.filter(c => c.id !== item.category);
        const items = categories.map(cat => ({
            title: `${cat.icon} ${cat.name}`, category: cat.id,
            onSelect: () => {
                const favorites = getFavorites();
                const baseId = getBaseTmdbId(item.tmdb_id);
                const targetItem = favorites.find(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === item.category);
                if (targetItem) {
                    const oldCategory = targetItem.category;
                    const title = targetItem.data?.title || targetItem.data?.name || 'Без названия';
                    targetItem.category = cat.id; targetItem.updated = Date.now();
                    applyCategoryRules(item.tmdb_id, cat.id, favorites);
                    saveFavorites(favorites);
                    logMove('move', title, oldCategory, cat.id);
                    notify(`📦 "${title}" → ${cat.name}`);
                    const c = cfg();
                    if (c.gist_token && c.gist_id) syncToGist('favorites', false);
                }
            }
        }));
        items.push({ title: '❌ Отмена', action: 'cancel' });
        Lampa.Select.show({ title: `Переместить "${item.data?.title || item.data?.name}"`, items, onBack: () => Lampa.Controller.toggle('content') });
    }

    // ======================
    // ОТСЛЕЖИВАНИЕ НОВЫХ СЕРИЙ
    // ======================
    
    function getNewEpisodesCount() {
        const c = cfg();
        if (!c.check_new_episodes) return 0;
        const seriesCheck = getSeriesCheck();
        let count = 0;
        for (const key in seriesCheck) { if (seriesCheck[key].has_new) count++; }
        return count;
    }
    
    function getNewEpisodesList() {
        const c = cfg();
        if (!c.check_new_episodes) return [];
        const seriesCheck = getSeriesCheck();
        const favorites = getFavorites();
        const newEpisodes = [];
        for (const key in seriesCheck) {
            if (seriesCheck[key].has_new) {
                const item = favorites.find(f => getBaseTmdbId(f.tmdb_id) === key);
                if (item) newEpisodes.push({ ...item, old_seasons: seriesCheck[key].old_seasons, new_seasons: seriesCheck[key].new_seasons, total_episodes: seriesCheck[key].total_episodes || 0, aired_episodes: seriesCheck[key].aired_episodes || 0, last_season_number: seriesCheck[key].last_season_number || 0, last_check: seriesCheck[key].checked_at });
            }
        }
        return newEpisodes;
    }
    
    function markNewEpisodesSeen(tmdbId) {
        const seriesCheck = getSeriesCheck();
        const baseId = getBaseTmdbId(tmdbId);
        for (const key in seriesCheck) {
            if (key === baseId || getBaseTmdbId(key) === baseId) { seriesCheck[key].has_new = false; seriesCheck[key].seen_at = Date.now(); }
        }
        saveSeriesCheck(seriesCheck);
        refreshNewEpisodesBadge();
    }
    
    function clearAllNewEpisodes() {
        const seriesCheck = getSeriesCheck();
        for (const key in seriesCheck) { seriesCheck[key].has_new = false; seriesCheck[key].seen_at = Date.now(); }
        saveSeriesCheck(seriesCheck);
        refreshNewEpisodesBadge();
    }
    
    function checkNewEpisodes(showNotifyFlag = false) {
        const c = cfg();
        if (!c.check_new_episodes) return;
        const favorites = getFavorites();
        const seriesCheck = getSeriesCheck();
        const now = Date.now();
        const checkInterval = (c.new_episodes_check_interval || 24) * 60 * 60 * 1000;
        
        // Фильтруем сериалы из watching и planned
        const seriesToCheck = favorites.filter(f => 
            (f.category === 'watching' || f.category === 'planned') && 
            (f.media_type === 'tv' || f.data?.original_name)
        );
        
        if (seriesToCheck.length === 0) {
            if (showNotifyFlag) notify('Нет сериалов для проверки');
            return;
        }
        
        let checkCount = 0;
        let newFound = 0;
        let completedChecks = 0;
        
        seriesToCheck.forEach(item => {
            const baseId = getBaseTmdbId(item.tmdb_id);
            if (!baseId) return;
            
            const lastCheck = seriesCheck[baseId]?.checked_at || 0;
            const lastError = seriesCheck[baseId]?.error;
            
            // Если проверяли недавно и нет ошибки — пропускаем
            if (now - lastCheck < checkInterval && !lastError) {
                if (seriesCheck[baseId]?.has_new) newFound++;
                completedChecks++;
                return;
            }
            
            checkCount++;
            const tmdbId = baseId;
            
            try {
                if (typeof Lampa.TMDB !== 'undefined' && Lampa.TMDB.api) {
                    const url = Lampa.TMDB.api('tv/' + tmdbId + '?api_key=' + Lampa.TMDB.key());
                    
                    $.ajax({
                        url,
                        method: 'GET',
                        timeout: 10000,
                        success: (data) => {
                            completedChecks++;
                            const newSeasons = data.number_of_seasons || 0;
                            const oldSeasons = seriesCheck[baseId]?.seasons_count || item.data?.number_of_seasons || 0;
                            const hasNew = newSeasons > oldSeasons && oldSeasons > 0;
                            const lastSeason = data.seasons ? data.seasons[data.seasons.length - 1] : null;
                            const totalEpisodes = lastSeason ? lastSeason.episode_count || 0 : 0;
                            const airedEpisodes = lastSeason ? countAiredEpisodes(lastSeason) : 0;
                            
                            seriesCheck[baseId] = {
                                checked_at: now,
                                seasons_count: newSeasons,
                                old_seasons: oldSeasons,
                                new_seasons: newSeasons,
                                has_new: hasNew,
                                last_air_date: data.last_air_date || '',
                                title: data.name || item.data?.title || item.data?.name || '',
                                total_episodes: totalEpisodes,
                                aired_episodes: airedEpisodes,
                                last_season_number: lastSeason ? lastSeason.season_number : 0,
                                error: false
                            };
                            
                            // Обновляем данные в избранном
                            if (data.number_of_seasons && data.number_of_seasons !== item.data?.number_of_seasons) {
                                item.data.number_of_seasons = data.number_of_seasons;
                                item.data.number_of_episodes = data.number_of_episodes;
                                item.data.last_air_date = data.last_air_date;
                                item.updated = now;
                                saveFavorites(favorites);
                            }
                            
                            if (hasNew) {
                                newFound++;
                                if (c.new_episodes_notify && showNotifyFlag) {
                                    const title = data.name || item.data?.title || item.data?.name || 'Без названия';
                                    const epInfo = airedEpisodes > 0 ? ` (${airedEpisodes} из ${totalEpisodes} серий)` : '';
                                    notify(`🔔 Новый сезон: "${title}" S${newSeasons}${epInfo}`);
                                }
                            }
                            
                            saveSeriesCheck(seriesCheck);
                            refreshNewEpisodesBadge();
                            checkFinalNotify();
                        },
                        error: () => {
                            completedChecks++;
                            seriesCheck[baseId] = {
                                checked_at: now,
                                seasons_count: item.data?.number_of_seasons || 0,
                                old_seasons: item.data?.number_of_seasons || 0,
                                new_seasons: item.data?.number_of_seasons || 0,
                                has_new: false,
                                last_air_date: item.data?.last_air_date || '',
                                title: item.data?.title || item.data?.name || '',
                                total_episodes: seriesCheck[baseId]?.total_episodes || 0,
                                aired_episodes: seriesCheck[baseId]?.aired_episodes || 0,
                                last_season_number: seriesCheck[baseId]?.last_season_number || 0,
                                error: true
                            };
                            saveSeriesCheck(seriesCheck);
                            checkFinalNotify();
                        }
                    });
                } else {
                    completedChecks++;
                }
            } catch (e) {
                completedChecks++;
                console.error('[NSL] Error checking episodes:', e);
            }
        });
        
        function checkFinalNotify() {
            if (completedChecks >= seriesToCheck.length) {
                if (showNotifyFlag) {
                    if (checkCount > 0 && newFound > 0) {
                        notify(`🔔 Найдено новых серий: ${newFound}`);
                    } else if (checkCount > 0 && newFound === 0) {
                        notify('✅ Новых серий нет');
                    }
                }
            }
        }
    }

    function checkUpcomingEpisodes() {
        const c = cfg();
        if (!c.check_new_episodes || !c.new_episodes_notify) return;
        
        const seriesCheck = getSeriesCheck();
        const favorites = getFavorites();
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const tomorrow = today + 24 * 60 * 60 * 1000;
        
        const upcoming = [];
        
        for (const key in seriesCheck) {
            const data = seriesCheck[key];
            if (!data.last_air_date) continue;
            
            try {
                const airDate = new Date(data.last_air_date);
                const airTime = new Date(airDate.getFullYear(), airDate.getMonth(), airDate.getDate()).getTime();
                
                // Проверяем: дата выхода — сегодня или завтра
                if (airTime >= today && airTime < tomorrow) {
                    const item = favorites.find(f => getBaseTmdbId(f.tmdb_id) === key);
                    if (item && (item.category === 'watching' || item.category === 'planned')) {
                        upcoming.push({
                            title: data.title || item.data?.title || item.data?.name || 'Без названия',
                            date: data.last_air_date,
                            hasNew: data.has_new
                        });
                    }
                }
            } catch(e) {}
        }
        
        if (upcoming.length > 0) {
            // Разделяем на "сегодня" и "завтра"
            const todayList = upcoming.filter(u => {
                const d = new Date(u.date);
                return d.getFullYear() === now.getFullYear() && 
                       d.getMonth() === now.getMonth() && 
                       d.getDate() === now.getDate();
            });
            const tomorrowList = upcoming.filter(u => {
                const d = new Date(u.date);
                const tomorrow = new Date(now);
                tomorrow.setDate(tomorrow.getDate() + 1);
                return d.getFullYear() === tomorrow.getFullYear() && 
                       d.getMonth() === tomorrow.getMonth() && 
                       d.getDate() === tomorrow.getDate();
            });
            
            if (todayList.length > 0) {
                const titles = todayList.slice(0, 3).map(u => {
                    const emoji = u.hasNew ? '🔔 ' : '';
                    return emoji + '"' + u.title + '"';
                }).join(', ');
                notify(`📅 Премьера сегодня: ${titles}${todayList.length > 3 ? ' и ещё ' + (todayList.length - 3) : ''}`);
            }
            if (tomorrowList.length > 0) {
                setTimeout(() => {
                    const titles = tomorrowList.slice(0, 3).map(u => {
                        const emoji = u.hasNew ? '🔔 ' : '';
                        return emoji + '"' + u.title + '"';
                    }).join(', ');
                    notify(`📅 Завтра: ${titles}${tomorrowList.length > 3 ? ' и ещё ' + (tomorrowList.length - 3) : ''}`);
                }, 3000);
            }
        }
    }
    
    function countAiredEpisodes(season) {
        if (!season || !season.episodes) return 0;
        const now = new Date();
        return season.episodes.filter(ep => { if (!ep.air_date) return false; return new Date(ep.air_date) <= now; }).length;
    }
    
    function startSeriesCheckTimer() {
        const c = cfg();
        if (!c.check_new_episodes) return;
        if (seriesCheckTimer) clearInterval(seriesCheckTimer);
        setTimeout(() => checkNewEpisodes(true), 30000);
        seriesCheckTimer = setInterval(() => checkNewEpisodes(false), 60 * 60 * 1000);
    }

    function loadSeriesDataQuick(tmdbId, callback) {
        const baseId = getBaseTmdbId(tmdbId);
        const seriesCheck = getSeriesCheck();
        const now = Date.now();
        if (seriesCheck[baseId] && (now - seriesCheck[baseId].checked_at < 60 * 60 * 1000)) { callback(seriesCheck[baseId]); return; }
        try {
            if (typeof Lampa.TMDB !== 'undefined' && Lampa.TMDB.api) {
                const url = Lampa.TMDB.api('tv/' + baseId + '?api_key=' + Lampa.TMDB.key());
                $.ajax({
                    url, method: 'GET', timeout: 5000,
                    success: (data) => {
                        const seasonsCount = data.number_of_seasons || 0;
                        const lastSeason = data.seasons ? data.seasons[data.seasons.length - 1] : null;
                        const totalEpisodes = lastSeason ? lastSeason.episode_count || 0 : 0;
                        const airedEpisodes = lastSeason ? countAiredEpisodes(lastSeason) : 0;
                        const checkData = { checked_at: now, seasons_count: seasonsCount, old_seasons: seriesCheck[baseId]?.old_seasons || seasonsCount, new_seasons: seasonsCount, has_new: seriesCheck[baseId]?.has_new || false, last_air_date: data.last_air_date || '', title: data.name || '', total_episodes: totalEpisodes, aired_episodes: airedEpisodes, last_season_number: data.last_episode_to_air ? data.last_episode_to_air.season_number : (lastSeason ? lastSeason.season_number : 0) };
                        seriesCheck[baseId] = checkData;
                        saveSeriesCheck(seriesCheck);
                        const favorites = getFavorites();
                        const item = favorites.find(f => getBaseTmdbId(f.tmdb_id) === baseId);
                        if (item) { item.data.number_of_seasons = seasonsCount; item.data.number_of_episodes = data.number_of_episodes; item.data.last_air_date = data.last_air_date; }
                        callback(checkData);
                    },
                    error: () => {
                        const favorites = getFavorites();
                        const item = favorites.find(f => getBaseTmdbId(f.tmdb_id) === baseId);
                        const cardData = item?.data || {};
                        const fallbackData = { checked_at: now, seasons_count: cardData.number_of_seasons || 0, total_episodes: 0, aired_episodes: 0, last_season_number: 0, error: true };
                        seriesCheck[baseId] = fallbackData;
                        saveSeriesCheck(seriesCheck);
                        callback(fallbackData);
                    }
                });
            } else callback(null);
        } catch (e) { callback(null); }
    }

    function formatSeriesInfo(checkData, cardData) {
        if (!checkData || checkData.error) {
            if (cardData?.number_of_seasons) return `${cardData.number_of_seasons} сез.`;
            return '';
        }
        const parts = [];
        if (checkData.seasons_count > 0) parts.push(`${checkData.seasons_count} сез.`);
        if (checkData.total_episodes > 0) {
            if (checkData.aired_episodes > 0) parts.push(`${checkData.aired_episodes} из ${checkData.total_episodes} сер.`);
            else parts.push(`${checkData.total_episodes} сер.`);
        }
        return parts.join(' · ');
    }

    // ======================
    // ИСТОРИЯ ПРОСМОТРОВ
    // ======================
    
    function addToHistory(card) {
        if (!card || !card.id) return;
        const history = getHistory();
        const existingIndex = history.findIndex(h => h.id === card.id);
        if (existingIndex >= 0) history.splice(existingIndex, 1);
        history.unshift({ id: card.id, tmdb_id: extractTmdbId(card), media_type: getMediaType(card), data: cleanCardData(card), time: Date.now() });
        if (history.length > 50) history.length = 50;
        saveHistory(history);
        
        const c = cfg();
        if (c.gist_token && c.gist_id) syncToGist('history', false);
    }
    
    function showHistory() {
        const history = getHistory();
        if (history.length === 0) { notify('История пуста'); return; }
        const menuItems = history.map(item => {
            const cardData = item.data || {};
            const itemTitle = cardData.title || cardData.name || 'Без названия';
            const year = extractYear(cardData);
            const posterUrl = getPosterUrl(cardData);
            const timeAgo = getTimeAgo(item.time);
            return {
                title: `<div style="display:flex;align-items:center;gap:0.6em;min-height:3.8em;padding:0.2em 0;">${posterUrl ? `<img src="${posterUrl}" style="width:2.8em;height:4em;object-fit:cover;border-radius:0.3em;flex-shrink:0;">` : '<div style="width:2.8em;height:4em;background:#333;border-radius:0.3em;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.5em;">🎬</div>'}<div style="flex:1;min-width:0;"><div style="font-size:1.1em;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${itemTitle}${year ? ` (${year})` : ''}</div><div style="font-size:0.85em;opacity:0.7;">${timeAgo}</div></div></div>`,
                item,
                onSelect: () => {
                    const method = (item.media_type === 'tv' || cardData.original_name) ? 'tv' : 'movie';
                    const source = cardData.source || 'tmdb';
                    Lampa.Activity.push({ id: item.id, method, card: { id: item.id, source, title: cardData.title, name: cardData.name, original_name: cardData.original_name, original_title: cardData.original_title, poster_path: cardData.poster_path, backdrop_path: cardData.backdrop_path, overview: cardData.overview, vote_average: cardData.vote_average, first_air_date: cardData.first_air_date, release_date: cardData.release_date, img: cardData.img }, url: '', component: 'full', source, page: 1 });
                }
            };
        });
        menuItems.push({ title: '──────────', separator: true });
        menuItems.push({ 
            title: '🗑️ Очистить историю', 
            onSelect: () => {
                Lampa.Select.show({
                    title: '⚠️ Очистить историю просмотров?',
                    items: [
                        { title: '✅ Да, очистить', action: 'confirm' },
                        { title: '❌ Отмена', action: 'cancel' }
                    ],
                    onSelect: (opt) => {
                        if (opt.action === 'confirm') {
                            saveHistory([]);
                            notify('История очищена');
                            const c = cfg();
                            if (c.gist_token && c.gist_id) syncToGist('history', false);
                        }
                    },
                    onBack: () => Lampa.Controller.toggle('content')
                });
            }
        });
        menuItems.push({ title: '◀ Назад', onSelect: () => showFavoritesMenu() });
        menuItems.push({ title: '❌ Закрыть', onSelect: () => Lampa.Controller.toggle('content') });
        Lampa.Select.show({ title: '🕐 История просмотров', items: menuItems, onBack: () => showFavoritesMenu() });
    }
    
    function getTimeAgo(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);
        if (minutes < 1) return 'Только что';
        if (minutes < 60) return `${minutes} мин назад`;
        if (hours < 24) return `${hours} ч назад`;
        if (days < 7) return `${days} дн назад`;
        return new Date(timestamp).toLocaleDateString();
    }
    
    // ======================
    // ОТОБРАЖЕНИЕ НА КАРТОЧКАХ
    // ======================
    
    function getCardStyles() {
        const c = cfg();
        
        if (c.card_display_mode === 'nsl_status') {
            return `
                .card .card-watched { display: none !important; }
                .card-watched__item { display: none !important; }
                .card .icon--history { display: none !important; }
                
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
                .nsl-card-status__icon { flex-shrink: 0; font-size: 1.2em; line-height: 1.5; }
                .nsl-card-status__text { 
                    color: #fff; 
                    font-weight: 500; 
                    text-align: left; 
                    flex: 1; 
                    min-width: 0; 
                    display: flex;
                    flex-direction: column;
                }
                .nsl-card-status__time { color: rgba(255,255,255,0.8); font-size: 0.9em; }
                .nsl-card-status--top { top: 0.5em; bottom: auto; }
                .nsl-card-status--center { top: 50%; bottom: auto; transform: translateY(-50%); }
                .nsl-card-status--bottom { bottom: 2.5em; top: auto; }
                @media screen and (max-width: 480px) {
                    .nsl-card-status { left: 0.5em; right: 0.5em; font-size: 0.65em; }
                }
            `;
        } else if (c.card_display_mode === 'lampa_default') {
            // Восстанавливаем штатные стили Lampa
            return `
                .nsl-card-status { display: none !important; }
                .card .card-watched { display: block !important; }
                .card-watched__item { display: block !important; }
                .card .icon--history { display: inline-block !important; }
            `;
        }
        
        return '.nsl-card-status { display: none !important; }';
    }
    
    function injectCardDisplayStyles() {
        const oldStyle = document.getElementById('nsl-card-display-styles');
        if (oldStyle) oldStyle.remove();
        
        const style = document.createElement('style');
        style.id = 'nsl-card-display-styles';
        style.textContent = getCardStyles();
        document.head.appendChild(style);
    }
    
    function removeCardDisplayStyles() {
        const s = document.getElementById('nsl-card-display-styles');
        if (s) s.remove();
    }
    
    function updateCardStatusElement(cardElement, cardData) {
        if (!cardElement || !cardData?.id) return;
        
        const c = cfg();
        if (c.card_display_mode !== 'nsl_status') {
            const existing = cardElement.querySelector('.nsl-card-status');
            if (existing) existing.remove();
            return;
        }
        
        const tmdbId = extractTmdbId(cardData);
        if (!tmdbId) return;
        
        const best = getBestTimelineItem(tmdbId);
        
        const favorites = getFavorites();
        const baseId = getBaseTmdbId(tmdbId);
        const favItem = favorites.find(f => getBaseTmdbId(f.tmdb_id) === baseId);
        
        if (!favItem) {
            if (!best.item) {
                const existing = cardElement.querySelector('.nsl-card-status');
                if (existing) existing.remove();
                return;
            }
            updateCardStatusElementWithTime(cardElement, cardData, null, best.item, best.key);
            return;
        }
        
        const status = getMovieStatus(cardData);
        if (!status) return;
        
        updateCardStatusElementWithTime(cardElement, cardData, status, best.item, best.key);
    }

    function updateCardStatusElementWithTime(cardElement, cardData, status, timelineItem, bestKey) {
        let existing = cardElement.querySelector('.nsl-card-status');
        
        if (!status) {
            if (existing) existing.remove();
            return;
        }
        
        let iconHtml = `<span class="nsl-card-status__icon" style="color:${status.color}">${status.icon}</span>`;
        
        let line1 = status.text;
        let line2 = '';
        
        if (timelineItem && timelineItem.time > 0 && bestKey) {
            const match = bestKey.match(/_s(\d+)_e(\d+)/);
            if (match) {
                const seriesInfo = getSeriesInfo(extractTmdbId(cardData));
                const totalSeasons = seriesInfo.totalSeasons;
                const totalEpisodesInSeason = seriesInfo.totalEpisodesInSeason;
                const currentSeason = parseInt(match[1]);
                const currentEpisode = parseInt(match[2]);
                
                const seasonStr = totalSeasons > 0 ? `Сезон ${currentSeason} из ${totalSeasons}` : `Сезон ${currentSeason}`;
                const episodeStr = totalEpisodesInSeason > 0 ? `Серия ${currentEpisode} из ${totalEpisodesInSeason}` : `Серия ${currentEpisode}`;
                const timeStr = formatTimeShort(timelineItem.time) + (timelineItem.duration > 0 ? ` из ${formatTimeShort(timelineItem.duration)}` : '');
                
                line1 += `: ${seasonStr}`;
                line2 = `${episodeStr}; ${timeStr}`;
            }
        }
        
        const textHtml = `<span class="nsl-card-status__text"><span>${line1}</span><span>${line2}</span></span>`;
        const contentHtml = iconHtml + textHtml;
        
        if (existing) {
            existing.innerHTML = contentHtml;
        } else {
            const div = document.createElement('div');
            div.className = 'nsl-card-status';
            div.innerHTML = contentHtml;
            
            const viewEl = cardElement.querySelector('.card__view');
            if (viewEl) {
                viewEl.appendChild(div);
            } else {
                return;
            }
        }
        
        updateCardStatusPosition(cardElement.querySelector('.nsl-card-status'));
    }
    
    function formatTimeShort(seconds) {
        if (!seconds || seconds < 0) return '';
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        
        if (hours > 0) {
            return `${hours} ч. ${minutes} м.`;
        } else if (minutes > 0) {
            return `${minutes} м.`;
        } else {
            return `${Math.floor(seconds)} с.`;
        }
    }
    
    function updateCardStatusPosition(element) {
        if (!element) return;
        const c = cfg();
        const pos = c.nsl_status_position || 'bottom';
        
        element.classList.remove('nsl-card-status--top', 'nsl-card-status--center', 'nsl-card-status--bottom');
        element.classList.add(`nsl-card-status--${pos}`);
    }
    
    function refreshAllCardStatuses() {
        document.querySelectorAll('.card').forEach(card => {
            const cardData = card._data || card.__data;
            if (cardData) {
                updateCardStatusElement(card, cardData);
            }
        });
    }
    
    function patchCardDisplay() {
        const c = cfg();
        if (c.card_display_mode !== 'nsl_status') {
            cardDisplayPatched = false;
            return;
        }
        
        if (cardDisplayPatched) return;
        if (!Lampa.Maker?.map) {
            setTimeout(patchCardDisplay, 1000);
            return;
        }
        
        try {
            const cardMap = Lampa.Maker.map('Card');
            if (!cardMap?.Watched) {
                setTimeout(patchCardDisplay, 1000);
                return;
            }
            
            const origCreate = cardMap.Watched.onCreate;
            const origDestroy = cardMap.Watched.onDestroy;
            
            cardMap.Watched.onCreate = function() {
                if (origCreate) origCreate.call(this);
                
                const updateCard = () => {
                    const data = this.data;
                    if (!data?.id) return;
                    const el = this.render().get(0);
                    if (!el) return;
                    updateCardStatusElement(el, data);
                };
                
                setTimeout(updateCard, 150);
                
                const handler = () => setTimeout(updateCard, 100);
                
                // Очищаем предыдущий обработчик
                if (this._nslUnsubscribe) {
                    Lampa.Listener.unfollow('state:changed', this._nslUnsubscribe);
                }
                
                Lampa.Listener.follow('state:changed', handler);
                this._nslUnsubscribe = handler;
            };
            
            // Добавляем очистку при разрушении карточки
            cardMap.Watched.onDestroy = function() {
                if (this._nslUnsubscribe) {
                    Lampa.Listener.unfollow('state:changed', this._nslUnsubscribe);
                    this._nslUnsubscribe = null;
                }
                if (origDestroy) origDestroy.call(this);
            };
            
            cardDisplayPatched = true;
        } catch(e) {
            console.error('[NSL] Error patching card display:', e);
        }
    }
    
    function applyCardDisplayMode() {
        const c = cfg();
        cardDisplayPatched = false;
        removeCardDisplayStyles();
        injectCardDisplayStyles();
        
        if (c.card_display_mode === 'nsl_status') {
            patchCardDisplay();
            setTimeout(refreshAllCardStatuses, 500);
        }
    }
    
    function initCardDisplay() {
        if (!cfg().enabled) return;
        applyCardDisplayMode();
    }

    // ======================
    // GITHUB GIST СИНХРОНИЗАЦИЯ (РАЗДЕЛЁННАЯ)
    // ======================

    function getGistData() {
        const c = cfg();
        if (!c.gist_token || !c.gist_id) return null;
        return { token: c.gist_token, id: c.gist_id };
    }

    function syncToGist(type, showNotify) {
        const gist = getGistData();
        if (!gist) { if (showNotify) notify('⚠️ GitHub Gist не настроен'); return; }
        
        let fileName, data, busyFlag;
        if (type === 'favorites') {
            if (gistSyncingFav) return;
            gistSyncingFav = true; busyFlag = () => gistSyncingFav = false;
            fileName = 'nsl_favorites.json';
            data = { version: 5, profile_id: PROFILE_ID, updated: new Date().toISOString(), bookmarks: getBookmarks(), favorites: getFavorites() };
        } else if (type === 'timeline') {
            if (gistSyncingTime) return;
            gistSyncingTime = true; busyFlag = () => gistSyncingTime = false;
            fileName = 'nsl_timeline.json';
            data = { version: 5, profile_id: PROFILE_ID, updated: new Date().toISOString(), timeline: getTimeline() };
        } else if (type === 'bookmarks') {
            if (gistSyncingBook) return;
            gistSyncingBook = true; busyFlag = () => gistSyncingBook = false;
            fileName = 'nsl_bookmarks.json';
            data = { version: 5, profile_id: PROFILE_ID, updated: new Date().toISOString(), bookmarks: getBookmarks() };
        } else if (type === 'history') {
            if (gistSyncingHis) return;
            gistSyncingHis = true; busyFlag = () => gistSyncingHis = false;
            fileName = 'nsl_history.json';
            data = { version: 5, profile_id: PROFILE_ID, updated: new Date().toISOString(), history: getHistory() };
        } else return;
        
        $.ajax({
            url: `https://api.github.com/gists/${gist.id}`,
            method: 'PATCH',
            headers: { 'Authorization': `token ${gist.token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
            data: JSON.stringify({ description: 'NSL Sync Data', public: false, files: { [fileName]: { content: JSON.stringify(data) } } }),
            success: () => { Lampa.Storage.set(GIST_CACHE + '_last_sync', Date.now()); busyFlag(); },
            error: () => { busyFlag(); },
            timeout: 15000, crossDomain: true
        });
    }
    
    function syncFromGist(showNotify) {
        const gist = getGistData();
        if (!gist) { 
            if (showNotify) notify('⚠️ GitHub Gist не настроен'); 
            return; 
        }
        
        syncingFromGist = true;
        
        $.ajax({
            url: `https://api.github.com/gists/${gist.id}`,
            method: 'GET',
            dataType: 'json',
            headers: {
                'Authorization': `token ${gist.token}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            crossDomain: true,
            success: (data) => {
                try {
                    let changed = false;
                    
                    const favContent = data.files['nsl_favorites.json']?.content;
                    if (favContent) {
                        const favData = JSON.parse(favContent);
                        if (favData.favorites) { 
                            saveFavorites(favData.favorites); 
                            changed = true; 
                        }
                        if (favData.bookmarks) { 
                            saveBookmarks(favData.bookmarks); 
                            changed = true; 
                        }
                    }
                    
                    const timeContent = data.files['nsl_timeline.json']?.content;
                    if (timeContent) {
                        const timeData = JSON.parse(timeContent);
                        if (timeData.timeline) { 
                            saveTimeline(timeData.timeline); 
                            changed = true; 
                        }
                    }
                    
                    const bookContent = data.files['nsl_bookmarks.json']?.content;
                    if (bookContent) {
                        const bookData = JSON.parse(bookContent);
                        if (bookData.bookmarks) { 
                            saveBookmarks(bookData.bookmarks); 
                            changed = true; 
                        }
                    }
                    
                    const hisContent = data.files['nsl_history.json']?.content;
                    if (hisContent) {
                        const hisData = JSON.parse(hisContent);
                        if (hisData.history) { 
                            saveHistory(hisData.history); 
                            changed = true; 
                        }
                    }
                    
                    // Старый формат (единый файл)
                    if (!favContent && !timeContent) {
                        const oldContent = data.files['nsl_sync.json']?.content;
                        if (oldContent) {
                            const oldData = JSON.parse(oldContent);
                            if (oldData.timeline) saveTimeline(oldData.timeline);
                            if (oldData.favorites) saveFavorites(oldData.favorites);
                            if (oldData.bookmarks) saveBookmarks(oldData.bookmarks);
                            changed = true;
                        }
                    }
                    
                    syncingFromGist = false;
                    
                    if (changed) {
                        cleanupDuplicateCategories();
                        syncTimelineWithCategories();
                        checkNewEpisodes(false);
                    }
                    
                    Lampa.Storage.set(GIST_CACHE + '_last_sync', Date.now());
                    setTimeout(() => renderBookmarks(), 500);
                    
                    // Единое обновление UI после всех изменений
                    refreshCardStatus();
                    refreshFavoriteButton();
                    refreshNewEpisodesBadge();
                    
                    if (showNotify) notify(changed ? '📥 Данные загружены с Gist' : '✅ Актуально');
                } catch(e) {
                    syncingFromGist = false;
                    console.error('[NSL] Parse error:', e);
                    if (showNotify) notify('❌ Ошибка чтения данных');
                }
            },
            error: (xhr) => {
                syncingFromGist = false;
                console.error('[NSL] Load error:', xhr.status, xhr.statusText);
                if (showNotify) notify('❌ Ошибка загрузки с Gist');
            },
            timeout: 20000
        });
    }

    function checkAutoSync() {
        const c = cfg();
        if (!c.sync_auto_interval) return;
        const lastSync = Lampa.Storage.get(GIST_CACHE + '_last_sync', 0);
        if (Date.now() - lastSync > (c.sync_interval_minutes || 60) * 60 * 1000) syncFromGist(false);
    }

    let syncTimer = null;
    function startAutoSync() { if (syncTimer) clearInterval(syncTimer); syncTimer = setInterval(() => checkAutoSync(), 5 * 60 * 1000); }

    let autoBackupTimer = null;
    
    function startAutoBackup() {
        const c = cfg();
        if (!c.auto_backup) return;
        
        if (autoBackupTimer) clearInterval(autoBackupTimer);
        setTimeout(() => doAutoBackup(), 60000);
        const interval = (c.auto_backup_interval || 24) * 60 * 60 * 1000;
        autoBackupTimer = setInterval(() => doAutoBackup(), interval);
    }
    
    function doAutoBackup() {
        try {
            const data = {
                version: 5,
                profile_id: PROFILE_ID,
                updated: new Date().toISOString(),
                bookmarks: getBookmarks(),
                favorites: getFavorites(),
                timeline: getTimeline()
            };
            Lampa.Storage.set(`nsl_autobackup_${PROFILE_ID}`, data);
            Lampa.Storage.set(`nsl_autobackup_time_${PROFILE_ID}`, Date.now());
        } catch (e) {
            console.error('[NSL] Auto-backup failed:', e);
        }
    }
    
    function exportToFile() {
        const data = { version: 5, profile_id: PROFILE_ID, updated: new Date().toISOString(), bookmarks: getBookmarks(), favorites: getFavorites(), timeline: getTimeline() };
        const jsonStr = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `nsl_backup_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        notify('📤 Данные сохранены в файл');
    }
    
    function importFromFile() {
        const input = document.createElement('input'); input.type = 'file'; input.accept = '.json'; input.style.display = 'none';
        document.body.appendChild(input);
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) { document.body.removeChild(input); return; }
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = JSON.parse(event.target.result);
                    if (data.timeline) saveTimeline(data.timeline);
                    if (data.favorites) saveFavorites(data.favorites);
                    if (data.bookmarks) saveBookmarks(data.bookmarks);
                    cleanupDuplicateCategories(); syncTimelineWithCategories();
                    notify('📥 Данные загружены из файла');
                } catch (err) { notify('❌ Ошибка чтения файла'); }
                document.body.removeChild(input);
            };
            reader.readAsText(file);
        };
        input.click();
    }

    // ======================
    // СТАТИСТИКА
    // ======================

    function getWatchStats() {
        const timeline = getTimeline();
        const favorites = getFavorites();
        let totalTime = 0, totalMovies = 0, totalEpisodes = 0;
        for (const key in timeline) {
            const item = timeline[key];
            if (item.time && item.time > 0) { totalTime += item.time; if (key.includes('_s') || key.includes('_e')) totalEpisodes++; else totalMovies++; }
        }
        const categoryStats = {};
        FAVORITE_CATEGORIES.forEach(cat => categoryStats[cat.id] = { name: cat.name, icon: cat.icon, count: 0, time: 0 });
        favorites.forEach(fav => {
            if (categoryStats[fav.category]) categoryStats[fav.category].count++;
            const baseId = getBaseTmdbId(fav.tmdb_id);
            for (const key in timeline) {
                if (getBaseTmdbId(timeline[key].tmdb_id) === baseId && timeline[key].time > 0)
                    if (categoryStats[fav.category]) categoryStats[fav.category].time += timeline[key].time;
            }
        });
        return { totalTime, totalTimeFormatted: formatTotalTime(totalTime), totalMovies, totalEpisodes, favoritesCount: favorites.length, timelineCount: Object.keys(timeline).length, categoryStats };
    }
    
    function formatTotalTime(seconds) {
        if (seconds < 60) return `${seconds} с`;
        const hours = Math.floor(seconds / 3600), minutes = Math.floor((seconds % 3600) / 60);
        if (hours > 0) return `${hours} ч ${minutes} мин`;
        return `${minutes} мин`;
    }

    function showWatchStats() {
        const stats = getWatchStats();
        const items = [];
        items.push({ title: `⏱️ Общее время просмотра: ${stats.totalTimeFormatted}` });
        items.push({ title: `🎬 Просмотрено фильмов: ${stats.totalMovies}` });
        items.push({ title: `📺 Просмотрено эпизодов: ${stats.totalEpisodes}` });
        items.push({ title: `⭐ В избранном: ${stats.favoritesCount}` });
        items.push({ title: `📊 Всего таймкодов: ${stats.timelineCount}` });
        items.push({ title: '──────────', separator: true });
        items.push({ title: '📋 По категориям:', separator: true });
        FAVORITE_CATEGORIES.forEach(cat => {
            const stat = stats.categoryStats[cat.id];
            if (stat.count > 0) { const timeStr = stat.time > 0 ? ` | ${formatTotalTime(stat.time)}` : ''; items.push({ title: `${stat.icon} ${stat.name}: ${stat.count} шт.${timeStr}` }); }
        });
        const timeline = getTimeline();
        const topItems = Object.entries(timeline).filter(([, item]) => item.time > 0).sort((a, b) => b[1].time - a[1].time).slice(0, 5);
        if (topItems.length > 0) {
            items.push({ title: '──────────', separator: true });
            items.push({ title: '🏆 Топ-5 по времени:', separator: true });
            topItems.forEach(([key, topItem], index) => {
                const baseId = getBaseTmdbId(topItem.tmdb_id);
                const fav = getFavorites().find(f => getBaseTmdbId(f.tmdb_id) === baseId);
                const title = fav?.data?.title || fav?.data?.name || `ID: ${baseId}`;
                const timeStr = formatTotalTime(topItem.time);
                const posterUrl = fav?.data ? getPosterUrl(fav.data) : null;
                const cardData = fav?.data || {};
                items.push({
                    title: `<div style="display:flex;align-items:center;gap:0.6em;min-height:3em;padding:0.2em 0;">${posterUrl ? `<img src="${posterUrl}" style="width:2.8em;height:4em;object-fit:cover;border-radius:0.3em;flex-shrink:0;">` : '<div style="width:2.8em;height:4em;background:#333;border-radius:0.3em;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.2em;">🎬</div>'}<div style="flex:1;min-width:0;"><div style="font-size:1.1em;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${index + 1}. ${title}</div><div style="font-size:0.85em;opacity:0.7;">${timeStr}${fav ? ` · ${FAVORITE_CATEGORIES.find(c => c.id === fav.category)?.icon || ''} ${FAVORITE_CATEGORIES.find(c => c.id === fav.category)?.name || ''}` : ''}</div></div></div>`,
                    onSelect: () => {
                        if (!fav) return;
                        const method = (fav.media_type === 'tv' || cardData.original_name) ? 'tv' : 'movie';
                        const cardId = cardData.id || fav.card_id || baseId;
                        const source = cardData.source || 'tmdb';
                        Lampa.Activity.push({ id: cardId, method, card: { id: cardId, source, title: cardData.title, name: cardData.name, original_name: cardData.original_name, original_title: cardData.original_title, poster_path: cardData.poster_path, backdrop_path: cardData.backdrop_path, overview: cardData.overview, vote_average: cardData.vote_average, first_air_date: cardData.first_air_date, release_date: cardData.release_date, img: cardData.img }, url: '', component: 'full', source, page: 1 });
                    }
                });
            });
        }
        items.push({ title: '──────────', separator: true });
        items.push({ title: '◀ Назад', onSelect: () => showFavoritesMenu() });
        items.push({ title: '❌ Закрыть', onSelect: () => Lampa.Controller.toggle('content') });
        Lampa.Select.show({ title: '📊 Статистика просмотров', items, onBack: () => showFavoritesMenu() });
    }

    // ======================
    // СКРЫТИЕ ШТАТНЫХ ЭЛЕМЕНТОВ LAMPA
    // ======================
    
    function applyHideLampaElements() {
        const c = cfg();
        
        if (c.hide_lampa_bookmark_button) {
            $('.button--book').addClass('nsl-hidden-lampa-button');
        } else {
            $('.nsl-hidden-lampa-button').removeClass('nsl-hidden-lampa-button');
        }
    }

    // ======================
    // НАСТРОЙКИ
    // ======================

    function showMainMenu() {
        const c = cfg();
        const cardModeNames = {
            'none': 'Выкл',
            'nsl_status': 'Избранное+',
            'lampa_default': 'Стандарт Lampa'
        };
        const positionNames = {
            'top': 'Сверху',
            'center': 'По центру',
            'bottom': 'Снизу'
        };
        const newEpisodesCount = getNewEpisodesCount();
        
        Lampa.Select.show({
            title: 'Избранное+',
            items: [
                { title: `📌 Закладки разделов (${getBookmarks().length})`, action: 'sections' },
                { title: `⭐ Избранное (${getFavorites().length})${newEpisodesCount > 0 ? ` 🔔${newEpisodesCount}` : ''}`, action: 'favorites' },
                { title: `⏱️ Таймкоды (${Object.keys(getTimeline()).length})`, action: 'timeline' },
                { title: `☁️ GitHub Gist`, action: 'gist' },
                { title: '──────────', separator: true },
                { title: `🎨 Отображение на карточках: ${cardModeNames[c.card_display_mode] || 'Выкл'}`, action: 'card_display_mode' },
                { title: `📍 Позиция статуса: ${positionNames[c.nsl_status_position] || 'Снизу'}`, action: 'nsl_status_position' },
                { title: '──────────', separator: true },
                { title: `🔔 Новые серии: ${c.check_new_episodes ? 'Вкл' : 'Выкл'}`, action: 'toggle_new_episodes' },
                { title: `📢 Уведомления о сериях: ${c.new_episodes_notify ? 'Вкл' : 'Выкл'}`, action: 'toggle_new_episodes_notify' },
                { title: `⏱️ Проверка серий: ${c.new_episodes_check_interval} ч.`, action: 'set_episodes_check_interval' },
                { title: `🔍 Проверить сейчас${newEpisodesCount > 0 ? ` (${newEpisodesCount})` : ''}`, action: 'check_episodes_now' },
                { title: '──────────', separator: true },
                { title: `👁 Скрыть кнопку Избранное: ${c.hide_lampa_bookmark_button ? 'Да' : 'Нет'}`, action: 'toggle_hide_bookmark_btn' },
                { title: '──────────', separator: true },
                { title: `🔄 Синхронизировать сейчас`, action: 'sync_now' },
                { title: `🧹 Очистить дубликаты`, action: 'cleanup_duplicates' },
                { title: `📋 Лог перемещений`, action: 'show_log' },
                { title: `❌ Закрыть`, action: 'cancel' }
            ],
            onSelect: (item) => {
                const c = cfg();
                if (item.action === 'sections') showSectionsSettings();
                else if (item.action === 'favorites') showFavoritesSettings();
                else if (item.action === 'timeline') showTimelineSettings();
                else if (item.action === 'gist') showGistSetup();
                else if (item.action === 'card_display_mode') {
                    Lampa.Select.show({
                        title: 'Отображение на карточках',
                        items: [
                            { title: '❌ Выкл (ничего не показывать)', action: 'none' },
                            { title: '⭐ Избранное+ (статус + таймкод)', action: 'nsl_status' },
                            { title: '🔄 Стандарт Lampa', action: 'lampa_default' }
                        ],
                        onSelect: (subItem) => {
                            if (subItem.action) {
                                c.card_display_mode = subItem.action;
                                saveCfg(c);
                                applyCardDisplayMode();
                                notify(`Режим: ${cardModeNames[subItem.action]}`);
                            }
                            showMainMenu();
                        },
                        onBack: () => showMainMenu()
                    });
                }
                else if (item.action === 'nsl_status_position') {
                    Lampa.Select.show({
                        title: 'Позиция статуса',
                        items: [
                            { title: '⬆️ Сверху', action: 'top' },
                            { title: '↕️ По центру', action: 'center' },
                            { title: '⬇️ Снизу', action: 'bottom' }
                        ],
                        onSelect: (subItem) => {
                            if (subItem.action) {
                                c.nsl_status_position = subItem.action;
                                saveCfg(c);
                                injectCardDisplayStyles();
                                refreshAllCardStatuses();
                                notify(`Позиция: ${positionNames[subItem.action]}`);
                            }
                            showMainMenu();
                        },
                        onBack: () => showMainMenu()
                    });
                }
                else if (item.action === 'toggle_new_episodes') {
                    c.check_new_episodes = !c.check_new_episodes; saveCfg(c);
                    if (c.check_new_episodes) startSeriesCheckTimer(); else if (seriesCheckTimer) clearInterval(seriesCheckTimer);
                    showMainMenu();
                }
                else if (item.action === 'toggle_new_episodes_notify') { c.new_episodes_notify = !c.new_episodes_notify; saveCfg(c); showMainMenu(); }
                else if (item.action === 'set_episodes_check_interval') {
                    Lampa.Input.edit({ title: 'Интервал проверки (часов)', value: String(c.new_episodes_check_interval || 24), free: true, number: true }, (val) => {
                        if (val !== null && !isNaN(val) && val > 0) { c.new_episodes_check_interval = parseInt(val); saveCfg(c); startSeriesCheckTimer(); }
                        showMainMenu();
                    });
                }
                else if (item.action === 'check_episodes_now') { checkNewEpisodes(true); showMainMenu(); }
                else if (item.action === 'toggle_hide_bookmark_btn') { c.hide_lampa_bookmark_button = !c.hide_lampa_bookmark_button; saveCfg(c); applyHideLampaElements(); showMainMenu(); }
                else if (item.action === 'sync_now') { syncToGist('favorites', false); syncToGist('timeline', false); syncToGist('bookmarks', false); notify('🔄 Синхронизация...'); setTimeout(() => syncFromGist(true), 1500); }
                else if (item.action === 'cleanup_duplicates') { if (cleanupDuplicateCategories()) notify('🧹 Дубликаты очищены'); else notify('✅ Дубликатов не найдено'); showMainMenu(); }
                else if (item.action === 'show_log') showMoveLog();
            },
            onBack: () => Lampa.Controller.toggle('content')
        });
    }
    
    function showMoveLog() {
        const log = getMoveLog();
        if (log.length === 0) { notify('📋 Лог пуст'); return; }
        const items = log.slice(-30).reverse().map(entry => {
            const time = new Date(entry.time).toLocaleString();
            let text = '';
            if (entry.action === 'move') { const fromCat = FAVORITE_CATEGORIES.find(c => c.id === entry.from)?.name || entry.from; const toCat = FAVORITE_CATEGORIES.find(c => c.id === entry.to)?.name || entry.to; text = `📦 "${entry.title}" ${fromCat} → ${toCat}`; }
            else if (entry.action === 'auto_watching') text = `👁️ "${entry.title}" → Смотрю`;
            else if (entry.action === 'auto_watched') text = `✅ "${entry.title}" → Просмотрено`;
            else if (entry.action === 'auto_abandoned') text = `❌ "${entry.title}" → Брошено`;
            else if (entry.action === 'return_abandoned') text = `🔄 "${entry.title}" возвращён в Смотрю`;
            else if (entry.action === 'return_watched') text = `🔄 "${entry.title}" возвращён в Смотрю (повтор)`;
            else if (entry.action === 'delete') text = `🗑️ "${entry.title}" удалён полностью`;
            else if (entry.action === 'clear_all') text = `🗑️ Всё избранное очищено`;
            else if (entry.action === 'cleanup') text = `🧹 Системная очистка дубликатов`;
            else if (entry.action === 'auto_remove_watched') text = `🧹 "${entry.title}" авто-удалён из Просмотрено`;
            else text = `${entry.action}: ${entry.title}`;
            return { title: text, sub: time };
        });
        items.push({ title: '──────────', separator: true });
        items.push({ title: '🗑️ Очистить лог', action: 'clear' });
        items.push({ title: '❌ Закрыть', onSelect: () => {} });
        Lampa.Select.show({
            title: '📋 Лог перемещений',
            items: items,
            onSelect: (item) => {
                if (item.action === 'clear') {
                    Lampa.Select.show({
                        title: '⚠️ Очистить лог перемещений?',
                        items: [
                            { title: '✅ Да, очистить', action: 'confirm' },
                            { title: '❌ Отмена', action: 'cancel' }
                        ],
                        onSelect: (opt) => {
                            if (opt.action === 'confirm') {
                                saveMoveLog([]);
                                notify('📋 Лог очищен');
                            }
                        },
                        onBack: () => Lampa.Controller.toggle('content')
                    });
                }
            },
            onBack: () => showMainMenu()
        });
    }
    
    function showSectionsSettings() {
        const c = cfg();
        Lampa.Select.show({
            title: '📌 Закладки разделов',
            items: [
                { title: `📍 Положение кнопки: ${c.button_position === 'side' ? 'Боковое меню' : 'Верхняя панель'}`, action: 'toggle_position' },
                { title: `📌 Сохранить текущий раздел`, action: 'save_section' },
                { title: `🗑️ Очистить все (${getBookmarks().length})`, action: 'clear_sections' },
                { title: '◀ Назад', action: 'back' }
            ],
            onSelect: (item) => {
                if (item.action === 'toggle_position') { c.button_position = c.button_position === 'side' ? 'top' : 'side'; saveCfg(c); notify('Настройка применится после перезагрузки'); showSectionsSettings(); }
                else if (item.action === 'save_section') { saveBookmark(); setTimeout(() => showSectionsSettings(), 1000); }
                else if (item.action === 'clear_sections') {
                    Lampa.Select.show({
                        title: '⚠️ Удалить все закладки разделов?',
                        items: [
                            { title: '✅ Да, удалить все', action: 'confirm' },
                            { title: '❌ Отмена', action: 'cancel' }
                        ],
                        onSelect: (opt) => {
                            if (opt.action === 'confirm') {
                                saveBookmarks([]);
                                notify('🗑️ Все закладки удалены');
                            }
                            showSectionsSettings();
                        },
                        onBack: () => showSectionsSettings()
                    });
                }
                else if (item.action === 'back') showMainMenu();
            },
            onBack: () => showMainMenu()
        });
    }
    
    function showFavoritesSettings() {
        const c = cfg();
        Lampa.Select.show({
            title: '⭐ Избранное',
            items: [
                { title: `🔔 Уведомления: ${c.show_move_notifications ? 'Вкл' : 'Выкл'}`, action: 'toggle_notifications' },
                { title: '──────────', separator: true },
                { title: `🔄 Авто в Брошено: ${c.auto_abandoned ? 'Вкл' : 'Выкл'}`, action: 'toggle_auto_abandoned' },
                { title: `📅 Дней до Брошено: ${c.abandoned_days}`, action: 'set_abandoned_days' },
                { title: '──────────', separator: true },
                { title: `👁️ Авто в Смотрю: ${c.auto_watching ? 'Вкл' : 'Выкл'}`, action: 'toggle_auto_watching' },
                { title: `📊 Порог Смотрю: ${c.watching_min_progress}% - ${c.watching_max_progress}%`, action: 'set_watching_range' },
                { title: '──────────', separator: true },
                { title: `✅ Авто в Просмотрено: ${c.auto_watched ? 'Вкл' : 'Выкл'}`, action: 'toggle_auto_watched' },
                { title: `📊 Порог Просмотрено: ${c.watched_min_progress}%`, action: 'set_watched_threshold' },
                { title: '──────────', separator: true },
                { title: `🗑️ Очистить всё`, action: 'clear_favorites' },
                { title: '◀ Назад', action: 'back' }
            ],
            onSelect: (item) => {
                if (item.action === 'toggle_notifications') { c.show_move_notifications = !c.show_move_notifications; saveCfg(c); showFavoritesSettings(); }
                else if (item.action === 'toggle_auto_abandoned') { c.auto_abandoned = !c.auto_abandoned; saveCfg(c); showFavoritesSettings(); }
                else if (item.action === 'set_abandoned_days') {
                    Lampa.Input.edit({ title: 'Дней без просмотра', value: String(c.abandoned_days), free: true, number: true }, (val) => { if (val !== null && !isNaN(val) && val > 0) { c.abandoned_days = parseInt(val); saveCfg(c); } showFavoritesSettings(); });
                }
                else if (item.action === 'toggle_auto_watching') { c.auto_watching = !c.auto_watching; saveCfg(c); showFavoritesSettings(); }
                else if (item.action === 'set_watching_range') showWatchingRangeSettings();
                else if (item.action === 'toggle_auto_watched') { c.auto_watched = !c.auto_watched; saveCfg(c); showFavoritesSettings(); }
                else if (item.action === 'set_watched_threshold') {
                    Lampa.Input.edit({ title: 'Порог Просмотрено (%)', value: String(c.watched_min_progress), free: true, number: true }, (val) => { if (val !== null && !isNaN(val) && val >= 0 && val <= 100) { c.watched_min_progress = parseInt(val); saveCfg(c); } showFavoritesSettings(); });
                }
                else if (item.action === 'clear_favorites') { clearAllFavorites(); showFavoritesSettings(); }
                else if (item.action === 'back') showMainMenu();
            },
            onBack: () => showMainMenu()
        });
    }
    
    function showWatchingRangeSettings() {
        const c = cfg();
        Lampa.Select.show({
            title: '📊 Порог "Смотрю"',
            items: [
                { title: `Минимальный: ${c.watching_min_progress}%`, action: 'set_min' },
                { title: `Максимальный: ${c.watching_max_progress}%`, action: 'set_max' },
                { title: '◀ Назад', action: 'back' }
            ],
            onSelect: (item) => {
                if (item.action === 'set_min') {
                    Lampa.Input.edit({ title: 'Мин. прогресс (%)', value: String(c.watching_min_progress), free: true, number: true }, (val) => { if (val !== null && !isNaN(val) && val >= 0 && val <= 100) { c.watching_min_progress = parseInt(val); saveCfg(c); } showWatchingRangeSettings(); });
                } else if (item.action === 'set_max') {
                    Lampa.Input.edit({ title: 'Макс. прогресс (%)', value: String(c.watching_max_progress), free: true, number: true }, (val) => { if (val !== null && !isNaN(val) && val >= 0 && val <= 100) { c.watching_max_progress = parseInt(val); saveCfg(c); } showWatchingRangeSettings(); });
                } else if (item.action === 'back') showFavoritesSettings();
            },
            onBack: () => showFavoritesSettings()
        });
    }
    
    function showTimelineSettings() {
        const c = cfg();
        const strategyName = c.sync_strategy === 'max_time' ? 'По длительности' : 'По дате';
        Lampa.Select.show({
            title: '⏱️ Таймкоды',
            items: [
                { title: `✅ Автосохранение: ${c.auto_save ? 'Вкл' : 'Выкл'}`, action: 'toggle_auto_save' },
                { title: `✅ Автосинхронизация: ${c.auto_sync ? 'Вкл' : 'Выкл'}`, action: 'toggle_auto_sync' },
                { title: `⏱️ Интервал синхр.: ${c.sync_interval} сек`, action: 'set_interval' },
                { title: `📊 Стратегия: ${strategyName}`, action: 'toggle_strategy' },
                { title: '──────────', separator: true },
                { title: `🗑️ Удалять старые таймкоды старше: ${c.cleanup_older_days || 'никогда'} дней`, action: 'set_cleanup_days' },
                { title: `✅ Удалять завершённые таймкоды: ${c.cleanup_completed ? 'Вкл' : 'Выкл'}`, action: 'toggle_cleanup_completed' },
                { title: '──────────', separator: true },
                { title: `🗑️ Авто-удаление просмотренных: ${c.auto_remove_watched ? 'Вкл' : 'Выкл'}`, action: 'toggle_auto_remove_watched' },
                { title: `📅 Удалять просмотренное через: ${c.auto_remove_watched_days} дн.`, action: 'set_auto_remove_watched_days' },
                { title: '──────────', separator: true },
                { title: `🗑️ Очистить все таймкоды`, action: 'clear_timeline' },
                { title: `🧹 Очистить старые сейчас`, action: 'cleanup_now' },
                { title: '◀ Назад', action: 'back' }
            ],
            onSelect: (item) => {
                if (item.action === 'toggle_auto_save') { c.auto_save = !c.auto_save; saveCfg(c); showTimelineSettings(); }
                else if (item.action === 'toggle_auto_sync') { c.auto_sync = !c.auto_sync; saveCfg(c); showTimelineSettings(); }
                else if (item.action === 'set_interval') {
                    Lampa.Input.edit({ title: 'Интервал (сек)', value: String(c.sync_interval), free: true, number: true }, (val) => { if (val !== null && !isNaN(val) && val > 0) { c.sync_interval = parseInt(val); saveCfg(c); } showTimelineSettings(); });
                }
                else if (item.action === 'toggle_strategy') { c.sync_strategy = c.sync_strategy === 'max_time' ? 'last_watch' : 'max_time'; saveCfg(c); showTimelineSettings(); }
                else if (item.action === 'set_cleanup_days') {
                    Lampa.Input.edit({ title: 'Удалять старше (дней, 0 = откл)', value: String(c.cleanup_older_days), free: true, number: true }, (val) => { if (val !== null && !isNaN(val)) { c.cleanup_older_days = parseInt(val); saveCfg(c); } showTimelineSettings(); });
                }
                else if (item.action === 'toggle_cleanup_completed') { c.cleanup_completed = !c.cleanup_completed; saveCfg(c); showTimelineSettings(); }
                else if (item.action === 'toggle_auto_remove_watched') { c.auto_remove_watched = !c.auto_remove_watched; saveCfg(c); showTimelineSettings(); }
                else if (item.action === 'set_auto_remove_watched_days') {
                    Lampa.Input.edit({ title: 'Удалять через (дней)', value: String(c.auto_remove_watched_days), free: true, number: true }, (val) => { if (val !== null && !isNaN(val) && val > 0) { c.auto_remove_watched_days = parseInt(val); saveCfg(c); } showTimelineSettings(); });
                }
                else if (item.action === 'clear_timeline') { clearAllTimeline(); showTimelineSettings(); }
                else if (item.action === 'cleanup_now') { cleanupTimeline(); showTimelineSettings(); }
                else if (item.action === 'back') showMainMenu();
            },
            onBack: () => showMainMenu()
        });
    }
    
    function clearAllTimeline() {
        Lampa.Select.show({
            title: '⚠️ Очистить все таймкоды?',
            items: [
                { title: '✅ Да, очистить всё', action: 'confirm' },
                { title: '❌ Отмена', action: 'cancel' }
            ],
            onSelect: (opt) => { 
                if (opt.action === 'confirm') { 
                    saveTimeline({});
                    notify('🗑️ Все таймкоды очищены');
                    const c = cfg();
                    if (c.sync_on_remove && c.gist_token && c.gist_id) syncToGist('timeline', false);
                } 
            },
            onBack: () => Lampa.Controller.toggle('content')
        });
    }
    
    function cleanupTimeline() {
        const c = cfg();
        const timeline = getTimeline();
        const now = Date.now();
        let removed = 0;
        
        // Удаление старых таймкодов
        if (c.cleanup_older_days > 0) {
            const olderThan = c.cleanup_older_days * 24 * 60 * 60 * 1000;
            for (const key in timeline) {
                const updated = timeline[key]?.updated || 0;
                if (updated > 0 && (now - updated) > olderThan) {
                    delete timeline[key];
                    removed++;
                }
            }
        }
        
        // Удаление завершённых таймкодов (>= 95%)
        if (c.cleanup_completed) {
            for (const key in timeline) {
                const percent = timeline[key]?.percent || 0;
                if (percent >= 95) {
                    delete timeline[key];
                    removed++;
                }
            }
        }
        
        if (removed > 0) {
            saveTimeline(timeline);
            notify(`🧹 Удалено таймкодов: ${removed}`);
        } else {
            notify('✅ Нечего очищать');
        }
    }
    
    function getSyncStatus() {
        const lastSync = Lampa.Storage.get(GIST_CACHE + '_last_sync', 0);
        if (!lastSync) return 'Никогда';
        
        const now = Date.now();
        const diff = now - lastSync;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);
        
        if (minutes < 1) return 'Только что';
        if (minutes < 60) return `${minutes} мин назад`;
        if (hours < 24) return `${hours} ч назад`;
        if (days < 7) return `${days} дн назад`;
        return new Date(lastSync).toLocaleDateString();
    }
    
    function showGistSetup() {
        const c = cfg();
        Lampa.Select.show({
            title: '☁️ GitHub Gist',
            items: [
                { title: `🔑 Токен: ${c.gist_token ? '✓ Установлен' : '❌ Не установлен'}`, action: 'token' },
                { title: `📄 Gist ID: ${c.gist_id ? c.gist_id.substring(0, 8) + '…' : '❌ Не установлен'}`, action: 'id' },
                { title: '──────────', separator: true },
                { title: '📤 Экспорт всего на Gist', action: 'upload_all' },
                { title: '📥 Импорт всего с Gist', action: 'download' },
                { title: '──────────', separator: true },
                { title: '💾 Экспорт в файл', action: 'export_file' },
                { title: '📂 Импорт из файла', action: 'import_file' },
                { title: '──────────', separator: true },
                { title: `🔄 Статус: ${getSyncStatus()}`, action: 'sync_status' },
                { title: '──────────', separator: true },
                { title: '◀ Назад', action: 'back' }
            ],
            onSelect: (item) => {
                if (item.action === 'token') {
                    Lampa.Input.edit({ title: 'GitHub Token', value: c.gist_token || '', free: true }, (val) => { if (val !== null) { c.gist_token = val; saveCfg(c); } showGistSetup(); });
                } else if (item.action === 'id') {
                    Lampa.Input.edit({ title: 'Gist ID', value: c.gist_id || '', free: true }, (val) => { if (val !== null) { c.gist_id = val; saveCfg(c); } showGistSetup(); });
                } else if (item.action === 'upload_all') {
                    syncToGist('favorites', false); syncToGist('timeline', false); syncToGist('bookmarks', false);
                    notify('📤 Отправлено'); setTimeout(() => showGistSetup(), 1500);
                } else if (item.action === 'download') {
                    syncFromGist(true); setTimeout(() => showGistSetup(), 1500);
                } else if (item.action === 'export_file') { exportToFile(); setTimeout(() => showGistSetup(), 500); }
                else if (item.action === 'import_file') { importFromFile(); setTimeout(() => showGistSetup(), 500); }
                else if (item.action === 'back') showMainMenu();
                else if (item.action === 'sync_status') {
                    syncFromGist(true);
                    setTimeout(() => showGistSetup(), 1500);
                }
            },
            onBack: () => showMainMenu()
        });
    }

    function addSettingsButton() {
        setTimeout(() => {
            let menuList = $('.menu__list').eq(2);
            if (!menuList.length) menuList = $('.menu__list').last();
            if (menuList.length && !$('.nsl-settings-item').length) {
                const el = $(`
                    <li class="menu__item selector nsl-settings-item">
                        <div class="menu__ico">
                            <svg viewBox="0 0 24 24" width="20" height="20">
                                <path fill="currentColor" d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/>
                            </svg>
                        </div>
                        <div class="menu__text">Избранное+</div>
                    </li>
                `);
                el.on('hover:enter', (e) => { e.stopPropagation(); showMainMenu(); });
                menuList.append(el);
            }
        }, 2000);
    }
    
    // ======================
    // ИНИЦИАЛИЗАЦИЯ
    // ======================

    function onAppClose() {
        const c = cfg();
        if (c.sync_on_close && c.gist_token && c.gist_id) { syncToGist('favorites', false); syncToGist('timeline', false); syncToGist('bookmarks', false); }
    }

    function onAppStart() {
        const c = cfg();
        if (c.sync_on_start && c.gist_token && c.gist_id) setTimeout(() => syncFromGist(false), 5000);
    }

    function init() {
        if (!cfg().enabled) return;
        console.log('[NSL] Init v27 for profile:', PROFILE_ID);
        
        $('<style>').text('.nsl-hidden-lampa-item{display:none!important}.nsl-hidden-lampa-button{display:none!important}').appendTo('head');
        
        setTimeout(() => {
            addBookmarkButton();
            addFavoritesToMenu();
            addSettingsButton();
            renderBookmarks();
            applyHideLampaElements();
        }, 1000);
    
        addFavoriteButtonToCard();
        addStatusToCard();
        initPlayerHandler();
        startAutoSync();
        onAppStart();
        
        const c = cfg();
        if (c.auto_backup) startAutoBackup();
        if (c.check_new_episodes) startSeriesCheckTimer();
        initCardDisplay();
        
        Lampa.Listener.follow('full', function(e) {
            if (e.type == 'complite' && e.data && (e.data.movie || e.data.card)) {
                const movie = e.data.movie || e.data.card;
                if (movie && movie.id) {
                    addToHistory(movie);
                    // Синхронизируем таймкоды из file_view после возврата из плеера
                    setTimeout(() => syncFromFileView(), 2000);
                }
            }
        });
        
        // Заполняем маппинг хешей из существующих таймкодов при старте
        setTimeout(() => {
            try {
                const hashMap = Lampa.Storage.get('nsl_hash_map_' + PROFILE_ID, {});
                const timeline = getTimeline();
                const fileName = 'file_view' + (PROFILE_ID !== 'default' ? '_' + PROFILE_ID : '');
                const fileView = Lampa.Storage.get(fileName, {});
                const favorites = getFavorites();
                let mappedCount = 0;
                
                // Для каждого таймкода NSL пытаемся найти соответствующий хеш в file_view
                for (const nslKey in timeline) {
                    if (Object.values(hashMap).includes(nslKey)) continue;
                    
                    const baseId = getBaseTmdbId(nslKey);
                    const match = nslKey.match(/_s(\d+)_e(\d+)/);
                    const fav = favorites.find(f => getBaseTmdbId(f.tmdb_id) === baseId);
                    const cardData = fav?.data || {};
                    
                    if (match && cardData.original_name) {
                        const rawKey = [match[1], parseInt(match[1]) > 10 ? ':' : '', match[2], cardData.original_name].join('');
                        const hash = Lampa.Utils.hash(rawKey);
                        if (fileView[hash] !== undefined) {
                            hashMap[String(hash)] = nslKey;
                            mappedCount++;
                        }
                    } else if (!match && (cardData.original_title || cardData.title)) {
                        const name = cardData.original_title || cardData.title;
                        const hash = Lampa.Utils.hash(name);
                        if (fileView[hash] !== undefined) {
                            hashMap[String(hash)] = nslKey;
                            mappedCount++;
                        }
                    }
                }
                
                if (mappedCount > 0) {
                    Lampa.Storage.set('nsl_hash_map_' + PROFILE_ID, hashMap, true);
                    console.log('[NSL] Initial hash map: added', mappedCount, 'mappings, total:', Object.keys(hashMap).length);
                } else {
                    console.log('[NSL] Initial hash map: no new mappings, existing:', Object.keys(hashMap).length);
                }
            } catch(e) {
                console.error('[NSL] Error building hash map:', e);
            }
        }, 5000);
        
        setTimeout(() => {
            cleanupDuplicateCategories();
            syncTimelineWithCategories();
            syncFromFileView();
            checkNewEpisodes(false);
            checkAutoRemoveWatched();
            checkUnfinishedWatching();
            checkUpcomingEpisodes();
        }, 5000);
    
        // Синхронизация при возврате из фона (после внешнего плеера)
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                console.log('[NSL] Visibility change: visible, syncing from file_view');
                setTimeout(() => syncFromFileView(), 1500);
            }
        });
        
        // Слушаем обновления штатного timeline Lampa (срабатывает при timeCall из внешнего плеера)
        Lampa.Listener.follow('state:changed', function(e) {
            if (e.target === 'timeline' && e.reason === 'update') {
                console.log('[NSL] Lampa timeline updated by external player, syncing from file_view');
                setTimeout(() => syncFromFileView(), 1000);
            }
        });
        
        // Обновление UI при изменениях наших данных
        Lampa.Listener.follow('state:changed', function(e) {
            if (e.target === 'nsl_favorites' || e.target === 'nsl_timeline') {
                setTimeout(() => { refreshCardStatus(); refreshFavoriteButton(); refreshNewEpisodesBadge(); }, 100);
            }
        });
        
        window.addEventListener('beforeunload', onAppClose);
        
        window.NSL = {
            cfg, getFavorites, getBookmarks, getTimeline,
            syncToGist, syncFromGist, addToFavorites, toggleFavorite,
            getMoveLog, getMovieStatus, refreshCardStatus,
            cleanupDuplicateCategories, applyCardDisplayMode,
            checkNewEpisodes, getNewEpisodesCount, getNewEpisodesList,
            syncFromFileView
        };
        
        console.log('[NSL] Init complete');
    }
    
    if (window.appready) init();
    else Lampa.Listener.follow('app', e => { if (e.type === 'ready') init(); });
    
})();
