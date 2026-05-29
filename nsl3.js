(function () {
    'use strict';

    if (window.nsl_sync_init_v2) return;
    window.nsl_sync_init_v2 = true;

    // ====================== КОНСТАНТЫ И ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ======================
    const isAndroid = navigator.userAgent.toLowerCase().indexOf('android') > -1 || 
                      (typeof window.AndroidJS !== 'undefined');
    
    function getProfileId() {
        try {
            const account = Lampa.Storage.get('account', {});
            const profile = account.profile || {};
            return String(profile.id || 'default');
        } catch (e) { return 'default'; }
    }

    const PROFILE_ID = getProfileId();
    const FN = (suffix) => `nsl_${suffix}_${PROFILE_ID}_v5`;
    const STORE_BOOKMARKS = FN('bookmarks');
    const STORE_FAVORITES = FN('favorites');
    const STORE_TIMELINE = FN('timeline');
    const STORE_MOVE_LOG = `nsl_move_log_${PROFILE_ID}_v1`;
    const STORE_SERIES_CHECK = `nsl_series_check_${PROFILE_ID}_v1`;
    const STORE_HISTORY = `nsl_history_${PROFILE_ID}_v1`;
    const CFG = FN('cfg');
    const GIST_CACHE = `nsl_gist_cache_${PROFILE_ID}`;

    // Категории избранного (без изменений)
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

    const STATUS_PRIORITY = { 'watching': 1, 'abandoned': 2, 'watched': 3, 'planned': 4, 'favorite': 5, 'collection': 6 };
    const CATEGORY_RULES = {
        abandoned: { removeFrom: ['favorite', 'watching', 'planned', 'watched'] },
        watched: { removeFrom: ['favorite', 'watching', 'planned'] },
        watching: { removeFrom: ['planned'] },
        collection: { removeFrom: [] }, favorite: { removeFrom: [] }, planned: { removeFrom: [] }
    };

    const CATEGORY_DISPLAYS = {
        'watching': { text: 'Смотрю', icon: '👁️', color: '#4CAF50' },
        'abandoned': { text: 'Брошено', icon: '❌', color: '#f44336' },
        'watched': { text: 'Просмотрено', icon: '✅', color: '#2196F3' },
        'planned': { text: 'Буду смотреть', icon: '📋', color: '#FF9800' },
        'favorite': { text: 'В избранном', icon: '⭐', color: '#FFC107' },
        'collection': { text: 'В коллекции', icon: '📦', color: '#9C27B0' }
    };

    const STATUS_BADGE_STYLE = 'style="margin-left:8px;display:flex;align-items:center;gap:6px;padding:0 12px;height:32px;border-radius:4px;background-color:rgba(0,0,0,0.4);color:rgba(255,255,255,0.9)!important;font-size:16px!important;font-weight:400;cursor:help;white-space:nowrap;border:none;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);"';

    let syncingFromGist = false;

    // ====================== ХРАНИЛИЩЕ С КЭШИРОВАНИЕМ ======================
    function cfg() {
        return Lampa.Storage.get(CFG, {
            enabled: true, button_position: 'side', gist_token: '', gist_id: '',
            sync_on_start: true, sync_on_close: false, sync_on_add: true, sync_on_remove: true,
            sync_auto_interval: true, sync_interval_minutes: 60,
            auto_save: true, auto_sync: true, auto_backup: true, auto_backup_interval: 24,
            sync_interval: 30, sync_strategy: 'max_time',
            auto_abandoned: false, card_display_mode: 'nsl_status', nsl_status_position: 'bottom',
            abandoned_days: 30, auto_watching: true, watching_min_progress: 5, watching_max_progress: 95,
            auto_watched: true, watched_min_progress: 95,
            auto_remove_watched: false, auto_remove_watched_days: 90,
            show_move_notifications: true, cleanup_older_days: 0, cleanup_completed: false,
            check_new_episodes: true, new_episodes_notify: true, new_episodes_check_interval: 24,
            hide_lampa_bookmark_button: false
        }) || {};
    }

    function saveCfg(c) { Lampa.Storage.set(CFG, c, true); }

    // Кэшируемые хранилища
    const store = {
        getBookmarks: () => Lampa.Storage.cache(STORE_BOOKMARKS, 100, []),
        setBookmarks: (val) => Lampa.Storage.set(STORE_BOOKMARKS, val, true),
        
        getFavorites: () => Lampa.Storage.cache(STORE_FAVORITES, 500, []),
        setFavorites: (val) => Lampa.Storage.set(STORE_FAVORITES, val, true),
        
        getTimeline: () => Lampa.Storage.get(STORE_TIMELINE, {}),
        setTimeline: (val) => Lampa.Storage.set(STORE_TIMELINE, val, true),
        
        getMoveLog: () => Lampa.Storage.get(STORE_MOVE_LOG, []),
        setMoveLog: (val) => { if (val.length > 50) val = val.slice(-50); Lampa.Storage.set(STORE_MOVE_LOG, val, true); },
        
        getSeriesCheck: () => Lampa.Storage.get(STORE_SERIES_CHECK, {}),
        setSeriesCheck: (val) => Lampa.Storage.set(STORE_SERIES_CHECK, val, true),
        
        getHistory: () => Lampa.Storage.get(STORE_HISTORY, []),
        setHistory: (val) => { if (val.length > 50) val = val.slice(-50); Lampa.Storage.set(STORE_HISTORY, val, true); }
    };

    // ====================== РАБОТА С Lampa.Timeline (ВМЕСТО ПРЯМОЙ ЗАПИСИ В file_view) ======================
    const TimelineHelper = {
        /**
         * Получить хеш для таймлайна (штатный метод Lampa)
         */
        getHash(movie, season = 1, episode = 1) {
            if (!movie) return null;
            
            if (movie.original_name) {
                // Сериал: [сезон, разделитель, эпизод, название]
                const hashString = [season, season > 10 ? ':' : '', episode, movie.original_name].join('');
                return Lampa.Utils.hash(hashString);
            } else if (movie.original_title) {
                return Lampa.Utils.hash(movie.original_title);
            }
            return null;
        },
        
        /**
         * Получить NSL-ключ для внутреннего хранилища
         */
        getNslKey(tmdbId, season, episode) {
            if (season && episode) return `${tmdbId}_s${season}_e${episode}`;
            return String(tmdbId);
        },
        
        /**
         * Сохранить прогресс через официальный Timeline.update
         */
        saveProgress(movie, time, duration, season, episode) {
            if (!movie) return false;
            
            const hash = this.getHash(movie, season, episode);
            if (!hash) return false;
            
            const percent = duration > 0 ? Math.round((time / duration) * 100) : 0;
            
            // Штатный метод Lampa.Timeline
            Lampa.Timeline.update({
                hash: hash,
                percent: percent,
                time: time,
                duration: duration,
                profile: PROFILE_ID
            });
            
            // Также сохраняем в NSL-хранилище для категорий и истории
            const tmdbId = this.extractTmdbId(movie);
            if (tmdbId) {
                const nslKey = this.getNslKey(tmdbId, season, episode);
                const nslTimeline = store.getTimeline();
                nslTimeline[nslKey] = {
                    time: time,
                    duration: duration,
                    percent: percent,
                    updated: Date.now(),
                    tmdb_id: tmdbId
                };
                store.setTimeline(nslTimeline);
            }
            
            return true;
        },
        
        /**
         * Получить прогресс из штатного Timeline
         */
        getProgress(movie, season, episode) {
            const hash = this.getHash(movie, season, episode);
            if (!hash) return null;
            return Lampa.Timeline.view(hash);
        },
        
        /**
         * Извлечь TMDB ID из объекта карточки
         */
        extractTmdbId(card) {
            if (!card) return null;
            if (card.tmdb_id) return String(card.tmdb_id);
            if (card.id && /^\d{2,8}$/.test(String(card.id))) return String(card.id);
            if (card.movie_id && /^\d{6,8}$/.test(String(card.movie_id))) return String(card.movie_id);
            return null;
        },
        
        /**
         * Получить базовый ID (без суффиксов)
         */
        getBaseId(tmdbId) {
            return tmdbId ? String(tmdbId).replace(/[_-].*$/, '') : null;
        }
    };

    // ====================== ХЕЛПЕРЫ ДЛЯ РАБОТЫ С ДАННЫМИ ======================
    function extractTmdbId(card) { return TimelineHelper.extractTmdbId(card); }
    function getBaseTmdbId(tmdbId) { return TimelineHelper.getBaseId(tmdbId); }
    
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
    
    function isSeries(cd) { return !!(cd.original_name); }
    
    function cleanCardData(card) {
        const cleaned = {};
        const fields = ['id','title','name','original_title','original_name','poster_path','backdrop_path','vote_average','release_date','first_air_date','overview','genre_ids','source','animation','anime','kp_rating','rating','number_of_seasons','number_of_episodes','last_air_date'];
        for (const f of fields) { if (card[f] !== undefined) cleaned[f] = card[f]; }
        return cleaned;
    }
    
    function getCategoryName(catId) { const c = FAVORITE_CATEGORIES.find(cc => cc.id === catId); return c ? c.name : catId; }
    
    function notify(text) { 
        if (text && cfg().show_move_notifications) Lampa.Notification.show(text, 2000);
    }
    
    function formatTimeShort(seconds) {
        if (!seconds || seconds < 0) return '';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return h > 0 ? `${h} ч. ${m} м.` : m > 0 ? `${m} м.` : `${Math.floor(seconds)} с.`;
    }
    
    function formatTotalTime(seconds) {
        if (seconds < 60) return `${seconds} с`;
        const h = Math.floor(seconds/3600);
        const m = Math.floor((seconds%3600)/60);
        return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
    }

    // ====================== ИЗБРАННОЕ (категории) ======================
    function getFavorites() { return store.getFavorites(); }
    function saveFavorites(list) { 
        store.setFavorites(list); 
        if (!syncingFromGist) setTimeout(() => Lampa.Listener.send('state:changed', { target: 'nsl_favorites', reason: 'update' }), 100);
    }
    
    function addToFavorites(card, category) {
        if (!card || !card.id) return false;
        const tmdbId = extractTmdbId(card);
        const mediaType = getMediaType(card);
        const favorites = getFavorites();
        const baseId = getBaseTmdbId(tmdbId);
        const inCollection = favorites.find(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === 'collection');
        
        // Применяем правила удаления из других категорий
        const rules = CATEGORY_RULES[category];
        if (rules && rules.removeFrom.length) {
            for (const catToRemove of rules.removeFrom) {
                const index = favorites.findIndex(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === catToRemove);
                if (index >= 0) favorites.splice(index, 1);
            }
        }
        
        const existingIndex = favorites.findIndex(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === category);
        const cardData = cleanCardData(card);
        
        const newItem = { 
            id: Date.now(), 
            card_id: card.id, 
            tmdb_id: tmdbId, 
            media_type: mediaType, 
            category, 
            data: cardData, 
            added: Date.now(), 
            updated: Date.now() 
        };
        
        if (existingIndex >= 0) favorites[existingIndex] = newItem;
        else favorites.push(newItem);
        
        if (inCollection && category !== 'collection' && !favorites.some(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === 'collection')) {
            favorites.push(inCollection);
        }
        
        saveFavorites(favorites);
        if (cfg().sync_on_add) syncToGist('favorites', false);
        return true;
    }
    
    function removeFromFavorites(card, category) {
        const favorites = getFavorites();
        const baseId = getBaseTmdbId(extractTmdbId(card));
        const index = favorites.findIndex(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === category);
        if (index >= 0) { 
            favorites.splice(index, 1); 
            saveFavorites(favorites); 
            if (cfg().sync_on_remove) syncToGist('favorites', false);
            return true; 
        }
        return false;
    }
    
    function isInFavorites(card, category) { 
        return getFavorites().some(f => getBaseTmdbId(f.tmdb_id) === getBaseTmdbId(extractTmdbId(card)) && f.category === category); 
    }
    
    function toggleFavorite(card, category) { 
        return isInFavorites(card, category) ? removeFromFavorites(card, category) : addToFavorites(card, category); 
    }
    
    function getFavoritesByCategory(category) { 
        return getFavorites().filter(f => f.category === category); 
    }
    
    function getMovieStatus(movie) {
        const tmdbId = extractTmdbId(movie);
        if (!tmdbId) return null;
        const baseId = getBaseTmdbId(tmdbId);
        const cats = getFavorites().filter(f => getBaseTmdbId(f.tmdb_id) === baseId).map(f => f.category);
        if (!cats.length) return null;
        
        let bestCat = null, bestP = 999;
        for (const cat of cats) { 
            const p = STATUS_PRIORITY[cat] || 999; 
            if (p < bestP) { bestP = p; bestCat = cat; } 
        }
        
        // Для коллекции и избранного — приоритет ниже, если есть другие категории
        if (bestCat === 'collection' && cats.length > 1) {
            for (const cat of cats) { 
                if (cat !== 'collection') { 
                    const p = STATUS_PRIORITY[cat] || 999;
                    if (p < bestP) { bestP = p; bestCat = cat; }
                } 
            }
        }
        if (bestCat === 'favorite' && cats.length > 1) {
            for (const cat of cats) { 
                if (cat !== 'favorite' && cat !== 'collection') 
                    return CATEGORY_DISPLAYS[cat];
            }
        }
        
        return CATEGORY_DISPLAYS[bestCat];
    }

    // ====================== ЗАКЛАДКИ РАЗДЕЛОВ ======================
    const ICON_FLAG = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M6 2v20l6-4 6 4V2z"/></svg>';
    const ICON_ADD = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M11 5h2v14h-2zM5 11h14v2H5z"/></svg>';
    
    function makeKey(act) {
        return [act.url || '', act.component || '', act.source || '', act.id || '', 
                act.job || '', JSON.stringify(act.genres || ''), JSON.stringify(act.params || '')].join('|');
    }
    
    function bookmarkExists(act) { 
        return store.getBookmarks().some(i => i.key === makeKey(act)); 
    }
    
    function isAllowedForBookmark() {
        const act = Lampa.Activity.active();
        if (!act) return false;
        if (act.component === 'actor' || act.component === 'person') return true;
        if (!act.url || ['movie', 'tv', 'anime', 'catalog'].includes(act.url)) return false;
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
        
        Lampa.Input.edit({ title: 'Название', value: act.title || act.name || 'Закладка', free: true }, (val) => {
            if (!val) return;
            const bookmarks = store.getBookmarks();
            bookmarks.push({ ...normalizeBookmark(act), name: val.trim() });
            store.setBookmarks(bookmarks);
            renderBookmarks();
            if (cfg().sync_on_add) syncToGist('bookmarks', false);
            notify('Сохранено');
        });
    }
    
    function removeBookmark(item) { 
        store.setBookmarks(store.getBookmarks().filter(i => i.id !== item.id)); 
        renderBookmarks();
        notify('Удалено'); 
        if (cfg().sync_on_remove) syncToGist('bookmarks', false);
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
        const ml = $('.menu__list').first();
        if (!ml.length) return;
        
        store.getBookmarks().forEach(item => {
            const el = $(`<li class="menu__item selector nsl-bookmark-item"><div class="menu__ico">${ICON_FLAG}</div><div class="menu__text" style="line-height:1.1;padding-top:0.3em;padding-bottom:0.3em;">${item.name}</div></li>`);
            el.on('hover:enter', (e) => { e.stopPropagation(); openBookmark(item); });
            el.on('hover:long', (e) => { 
                e.stopPropagation(); 
                Lampa.Select.show({
                    title: `Удалить "${item.name}"?`,
                    items: [{ title: 'Нет', action: 'cancel' }, { title: 'Да', action: 'remove' }],
                    onSelect: (a) => { if (a.action === 'remove') removeBookmark(item); }
                });
            });
            ml.append(el);
        });
    }
    
    function addBookmarkButton() {
        if ($('[data-nsl-save]').length) return;
        const c = cfg();
        
        if (c.button_position === 'side') {
            const ml = $('.menu__list').eq(1);
            if (ml.length) {
                const btn = $(`<li class="menu__item selector" data-nsl-save><div class="menu__ico">${ICON_ADD}</div><div class="menu__text">Сохранить раздел</div></li>`);
                btn.on('hover:enter', (e) => { e.stopPropagation(); saveBookmark(); });
                ml.prepend(btn);
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

    // ====================== ОТСЛЕЖИВАНИЕ ПРОСМОТРА (через Lampa.Player + Lampa.Timeline) ======================
    let currentTrackingMovie = null;
    let trackingInterval = null;
    let lastSavedTime = 0;
    
    function startTrackingProgress() {
        if (trackingInterval) clearInterval(trackingInterval);
        
        trackingInterval = setInterval(() => {
            if (!currentTrackingMovie) return;
            
            const playdata = Lampa.Player.playdata();
            if (!playdata) return;
            
            const time = playdata.timeline?.time || 0;
            const duration = playdata.timeline?.duration || 0;
            const season = playdata.season || 1;
            const episode = playdata.episode || 1;
            
            if (time > 0 && Math.abs(time - lastSavedTime) >= 5) {
                lastSavedTime = time;
                
                // Сохраняем через официальный Timeline API
                TimelineHelper.saveProgress(currentTrackingMovie, time, duration, season, episode);
                
                // Автоматический возврат в "Смотрю" при просмотре более 60 секунд
                const tmdbId = TimelineHelper.extractTmdbId(currentTrackingMovie);
                if (tmdbId && time > 60) {
                    const baseId = getBaseTmdbId(tmdbId);
                    const favorites = getFavorites();
                    const abandonedItem = favorites.find(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === 'abandoned');
                    if (abandonedItem) {
                        abandonedItem.category = 'watching';
                        abandonedItem.updated = Date.now();
                        saveFavorites(favorites);
                        notify(`🔄 "${abandonedItem.data?.title || abandonedItem.data?.name}" возвращён в Смотрю`);
                    }
                }
            }
        }, 5000); // Каждые 5 секунд
    }
    
    function stopTrackingProgress() {
        if (trackingInterval) {
            clearInterval(trackingInterval);
            trackingInterval = null;
        }
        currentTrackingMovie = null;
        lastSavedTime = 0;
    }
    
    function initPlayerTracking() {
        // Слушаем событие готовности плеера (вместо перехвата Android.openPlayer)
        Lampa.Player.listener.follow('ready', (data) => {
            console.log('[NSL] Player ready, tracking started');
            
            // Получаем текущий фильм из активности
            const activity = Lampa.Activity.active();
            currentTrackingMovie = activity?.movie || data.card;
            
            if (currentTrackingMovie) {
                startTrackingProgress();
            }
        });
        
        // Слушаем событие уничтожения плеера
        Lampa.Player.listener.follow('destroy', () => {
            console.log('[NSL] Player destroyed, tracking stopped');
            
            // Финальное сохранение
            if (currentTrackingMovie) {
                const playdata = Lampa.Player.playdata();
                if (playdata?.timeline?.time) {
                    TimelineHelper.saveProgress(
                        currentTrackingMovie,
                        playdata.timeline.time,
                        playdata.timeline.duration || 0,
                        playdata.season || 1,
                        playdata.episode || 1
                    );
                }
            }
            
            stopTrackingProgress();
            syncTimelineWithCategories();
            refreshAllCardStatuses();
        });
        
        console.log('[NSL] Player tracking initialized');
    }

    // ====================== СИНХРОНИЗАЦИЯ С GIST ======================
    let syncFlags = { fav: false, time: false, book: false, his: false };
    
    function getGistData() { 
        const c = cfg(); 
        return (c.gist_token && c.gist_id) ? { token: c.gist_token, id: c.gist_id } : null; 
    }
    
    function syncToGist(type, showNotify) {
        const gist = getGistData();
        if (!gist) { if (showNotify) notify('⚠️ GitHub Gist не настроен'); return; }
        
        let fileName, data, flag;
        if (type === 'favorites') {
            if (syncFlags.fav) return;
            syncFlags.fav = true;
            flag = () => syncFlags.fav = false;
            fileName = 'nsl_favorites.json';
            data = { version: 5, profile_id: PROFILE_ID, updated: new Date().toISOString(), favorites: getFavorites() };
        } else if (type === 'timeline') {
            if (syncFlags.time) return;
            syncFlags.time = true;
            flag = () => syncFlags.time = false;
            fileName = 'nsl_timeline.json';
            data = { version: 5, profile_id: PROFILE_ID, updated: new Date().toISOString(), timeline: store.getTimeline() };
        } else if (type === 'bookmarks') {
            if (syncFlags.book) return;
            syncFlags.book = true;
            flag = () => syncFlags.book = false;
            fileName = 'nsl_bookmarks.json';
            data = { version: 5, profile_id: PROFILE_ID, updated: new Date().toISOString(), bookmarks: store.getBookmarks() };
        } else if (type === 'history') {
            if (syncFlags.his) return;
            syncFlags.his = true;
            flag = () => syncFlags.his = false;
            fileName = 'nsl_history.json';
            data = { version: 5, profile_id: PROFILE_ID, updated: new Date().toISOString(), history: store.getHistory() };
        } else return;
        
        $.ajax({
            url: `https://api.github.com/gists/${gist.id}`,
            method: 'PATCH',
            headers: { 'Authorization': `token ${gist.token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
            data: JSON.stringify({ description: 'NSL Sync Data', public: false, files: { [fileName]: { content: JSON.stringify(data) } } }),
            success: () => { Lampa.Storage.set(GIST_CACHE + '_last_sync', Date.now()); flag(); },
            error: () => flag(),
            timeout: 15000
        });
    }
    
    function syncFromGist(showNotify) {
        const gist = getGistData();
        if (!gist) { if (showNotify) notify('⚠️ GitHub Gist не настроен'); return; }
        syncingFromGist = true;
        
        $.ajax({
            url: `https://api.github.com/gists/${gist.id}`,
            method: 'GET',
            headers: { 'Authorization': `token ${gist.token}`, 'Accept': 'application/vnd.github.v3+json' },
            timeout: 20000,
            success: (data) => {
                try {
                    let changed = false;
                    const favContent = data.files['nsl_favorites.json']?.content;
                    if (favContent) {
                        const favData = JSON.parse(favContent);
                        if (favData.favorites) { store.setFavorites(favData.favorites); changed = true; }
                        if (favData.bookmarks) { store.setBookmarks(favData.bookmarks); changed = true; }
                    }
                    const timeContent = data.files['nsl_timeline.json']?.content;
                    if (timeContent) {
                        const timeData = JSON.parse(timeContent);
                        if (timeData.timeline) { store.setTimeline(timeData.timeline); changed = true; }
                    }
                    const bookContent = data.files['nsl_bookmarks.json']?.content;
                    if (bookContent) {
                        const bookData = JSON.parse(bookContent);
                        if (bookData.bookmarks) { store.setBookmarks(bookData.bookmarks); changed = true; }
                    }
                    const hisContent = data.files['nsl_history.json']?.content;
                    if (hisContent) {
                        const hisData = JSON.parse(hisContent);
                        if (hisData.history) { store.setHistory(hisData.history); changed = true; }
                    }
                    
                    syncingFromGist = false;
                    if (changed) {
                        syncTimelineWithCategories();
                        checkNewEpisodes(false);
                    }
                    Lampa.Storage.set(GIST_CACHE + '_last_sync', Date.now());
                    renderBookmarks();
                    refreshAllCardStatuses();
                    if (showNotify) notify(changed ? '📥 Данные загружены с Gist' : '✅ Актуально');
                } catch(e) { syncingFromGist = false; console.error('[NSL] Parse error:', e); if (showNotify) notify('❌ Ошибка чтения данных'); }
            },
            error: () => { syncingFromGist = false; console.error('[NSL] Load error'); if (showNotify) notify('❌ Ошибка загрузки с Gist'); }
        });
    }

    // ====================== СИНХРОНИЗАЦИЯ ТАЙМЛАЙНА С КАТЕГОРИЯМИ ======================
    let syncTimelineTimer = null;
    
    function syncTimelineWithCategories() {
        const c = cfg();
        if (!c.auto_watching && !c.auto_watched) return;
        if (syncTimelineTimer) clearTimeout(syncTimelineTimer);
        
        const timeline = store.getTimeline();
        const favorites = getFavorites();
        let changed = false;
        
        for (const [key, item] of Object.entries(timeline)) {
            const tmdbId = item.tmdb_id;
            if (!tmdbId) continue;
            const baseId = getBaseTmdbId(tmdbId);
            const percent = item.percent || 0;
            
            // Пропускаем брошенные
            if (favorites.some(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === 'abandoned')) continue;
            
            const existingWatching = favorites.find(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === 'watching');
            const existingWatched = favorites.find(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === 'watched');
            const existingOther = favorites.find(f => getBaseTmdbId(f.tmdb_id) === baseId);
            const cardData = existingOther?.data || { id: tmdbId, title: 'ID: ' + baseId };
            const title = cardData.title || cardData.name || 'ID: ' + baseId;
            
            // Для фильмов (не эпизодов)
            if (!key.includes('_s') && !key.includes('_e')) {
                if (c.auto_watched && !existingWatched && percent >= c.watched_min_progress) {
                    if (existingWatching) {
                        existingWatching.category = 'watched';
                        existingWatching.updated = Date.now();
                    } else if (!existingOther) {
                        favorites.push({
                            id: Date.now(), card_id: baseId, tmdb_id: tmdbId,
                            media_type: 'movie', category: 'watched',
                            data: cardData, added: Date.now(), updated: Date.now()
                        });
                    }
                    changed = true;
                    notify(`✅ "${title}" → Просмотрено`);
                } else if (c.auto_watching && !existingWatching && !existingWatched && percent >= c.watching_min_progress && percent <= c.watching_max_progress) {
                    if (!existingOther) {
                        favorites.push({
                            id: Date.now(), card_id: baseId, tmdb_id: tmdbId,
                            media_type: 'movie', category: 'watching',
                            data: cardData, added: Date.now(), updated: Date.now()
                        });
                        changed = true;
                        notify(`👁️ "${title}" → Смотрю`);
                    }
                }
            }
        }
        
        if (changed) saveFavorites(favorites);
    }
    
    function refreshAllCardStatuses() {
        document.querySelectorAll('.card').forEach(card => {
            const data = card._data || card.__data;
            if (data) updateCardStatusElement(card, data);
        });
    }
    
    function updateCardStatusElement(cardElement, cardData) {
        if (!cardElement || !cardData?.id || cfg().card_display_mode !== 'nsl_status') {
            const existing = cardElement.querySelector('.nsl-card-status');
            if (existing) existing.remove();
            return;
        }
        
        const tmdbId = extractTmdbId(cardData);
        if (!tmdbId) return;
        
        const status = getMovieStatus(cardData);
        let existing = cardElement.querySelector('.nsl-card-status');
        
        if (!status) {
            if (existing) existing.remove();
            return;
        }
        
        const iconHtml = `<span class="nsl-card-status__icon" style="color:${status.color}">${status.icon}</span>`;
        const contentHtml = iconHtml + `<span class="nsl-card-status__text"><span>${status.text}</span></span>`;
        
        if (existing) {
            existing.innerHTML = contentHtml;
        } else {
            const div = document.createElement('div');
            div.className = 'nsl-card-status';
            div.innerHTML = contentHtml;
            const viewEl = cardElement.querySelector('.card__view');
            if (viewEl) viewEl.appendChild(div);
        }
        
        const el = cardElement.querySelector('.nsl-card-status');
        if (el) {
            const pos = cfg().nsl_status_position || 'bottom';
            el.classList.remove('nsl-card-status--top', 'nsl-card-status--center', 'nsl-card-status--bottom');
            el.classList.add(`nsl-card-status--${pos}`);
        }
    }
    
    function getCardStyles() {
        const c = cfg();
        if (c.card_display_mode === 'nsl_status') {
            return `.card .card-watched,.card-watched__item,.card .icon--history{display:none!important}
                    .nsl-card-status{position:absolute;left:0.8em;right:0.8em;z-index:5;display:flex;align-items:center;gap:0.4em;padding:0.5em 0.8em;background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);border-radius:0.5em;pointer-events:none;font-size:0.7em;line-height:1.5}
                    .nsl-card-status__icon{flex-shrink:0;font-size:1.2em}
                    .nsl-card-status__text{color:#fff;font-weight:500;flex:1;min-width:0}
                    .nsl-card-status--top{top:0.5em;bottom:auto}
                    .nsl-card-status--center{top:50%;bottom:auto;transform:translateY(-50%)}
                    .nsl-card-status--bottom{bottom:2.5em;top:auto}`;
        }
        if (c.card_display_mode === 'lampa_default') {
            return `.nsl-card-status{display:none!important}.card .card-watched,.card-watched__item,.card .icon--history{display:block!important}`;
        }
        return `.nsl-card-status{display:none!important}`;
    }
    
    function updateCardStyles() {
        let s = document.getElementById('nsl-card-display-styles');
        if (!s) { s = document.createElement('style'); s.id = 'nsl-card-display-styles'; document.head.appendChild(s); }
        s.textContent = getCardStyles();
    }
    
    function applyCardDisplayMode() { updateCardStyles(); setTimeout(refreshAllCardStatuses, 500); }

    // ====================== НОВЫЕ СЕРИИ ======================
    function getNewEpisodesCount() {
        if (!cfg().check_new_episodes) return 0;
        let count = 0;
        const sc = store.getSeriesCheck();
        for (const key in sc) { if (sc[key].has_new) count++; }
        return count;
    }
    
    function checkNewEpisodes(showNotifyFlag = false) {
        const c = cfg();
        if (!c.check_new_episodes) return;
        
        const favorites = getFavorites();
        const sc = store.getSeriesCheck();
        const now = Date.now();
        const interval = (c.new_episodes_check_interval || 24) * 3600000;
        
        const toCheck = favorites.filter(f => (f.category === 'watching' || f.category === 'planned') && isSeries(f.data || {}));
        if (!toCheck.length) { if (showNotifyFlag) notify('Нет сериалов для проверки'); return; }
        
        let completed = 0, newFound = 0;
        const checkFinal = () => {
            if (completed >= toCheck.length && showNotifyFlag) {
                notify(newFound > 0 ? `🔔 Найдено новых серий: ${newFound}` : '✅ Новых серий нет');
            }
        };
        
        toCheck.forEach(item => {
            const baseId = getBaseTmdbId(item.tmdb_id);
            if (!baseId) { completed++; checkFinal(); return; }
            
            if (now - (sc[baseId]?.checked_at || 0) < interval && !sc[baseId]?.error) {
                if (sc[baseId]?.has_new) newFound++;
                completed++;
                checkFinal();
                return;
            }
            
            if (typeof Lampa.TMDB !== 'undefined' && Lampa.TMDB.api) {
                $.ajax({
                    url: Lampa.TMDB.api('tv/' + baseId + '?api_key=' + Lampa.TMDB.key()),
                    method: 'GET',
                    timeout: 10000,
                    success: (data) => {
                        completed++;
                        const newSeasons = data.number_of_seasons || 0;
                        const oldSeasons = sc[baseId]?.seasons_count || item.data?.number_of_seasons || 0;
                        const hasNew = newSeasons > oldSeasons && oldSeasons > 0;
                        
                        sc[baseId] = {
                            checked_at: now,
                            seasons_count: newSeasons,
                            old_seasons: oldSeasons,
                            new_seasons: newSeasons,
                            has_new: hasNew,
                            last_air_date: data.last_air_date || '',
                            title: data.name || item.data?.title || item.data?.name || ''
                        };
                        
                        if (hasNew) {
                            newFound++;
                            if (c.new_episodes_notify && showNotifyFlag) {
                                notify(`🔔 Новый сезон: "${data.name}" S${newSeasons}`);
                            }
                        }
                        
                        store.setSeriesCheck(sc);
                        checkFinal();
                    },
                    error: () => {
                        completed++;
                        sc[baseId] = { checked_at: now, has_new: false, error: true };
                        store.setSeriesCheck(sc);
                        checkFinal();
                    }
                });
            } else {
                completed++;
                checkFinal();
            }
        });
    }
    
    function refreshNewEpisodesBadge() {
        const badgeEl = $('.nsl-favorites-item .menu__text');
        if (!badgeEl.length) return;
        badgeEl.find('.nsl-badge').remove();
        const count = getNewEpisodesCount();
        if (count > 0) badgeEl.append(` <span class="nsl-badge" style="background:#f44336;color:#fff;border-radius:50%;padding:0 0.3em;font-size:0.8em;margin-left:0.5em;">🔔${count}</span>`);
    }
    
    let seriesCheckTimer = null;
    function startSeriesCheckTimer() {
        if (!cfg().check_new_episodes) return;
        if (seriesCheckTimer) clearInterval(seriesCheckTimer);
        setTimeout(() => checkNewEpisodes(true), 30000);
        seriesCheckTimer = setInterval(() => checkNewEpisodes(false), 3600000);
    }

    // ====================== СТРАНИЦА ИЗБРАННОГО ======================
    function openFavoritesPage() {
        let currentCategory = Lampa.Storage.get('nsl_current_category', 'favorite');
        
        function renderContent($container) {
            let items = getFavoritesByCategory(currentCategory);
            const category = FAVORITE_CATEGORIES.find(c => c.id === currentCategory);
            const catName = category ? category.name : 'Избранное';
            
            $container.empty();
            
            const $header = $(`
                <div style="padding:1rem;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                        <h1 style="font-size:1.5rem;margin:0;">${category?.icon || '⭐'} ${catName}</h1>
                        <div class="selector" style="padding:0.3rem 0.8rem;background:rgba(255,255,255,0.1);border-radius:0.5rem;cursor:pointer;" data-action="back">◀ Назад</div>
                    </div>
                    <div class="favorites-tabs" style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;"></div>
                </div>
            `);
            $container.append($header);
            
            // Вкладки категорий
            const $tabs = $header.find('.favorites-tabs');
            const favoritesAll = getFavorites();
            
            FAVORITE_CATEGORIES.forEach(cat => {
                const count = favoritesAll.filter(f => f.category === cat.id).length;
                const isActive = currentCategory === cat.id;
                const $tab = $(`
                    <div class="selector favorites-tab" data-category="${cat.id}" style="padding:0.3rem 0.8rem;border-radius:1.5rem;background:${isActive ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)'};display:inline-flex;align-items:center;gap:0.3rem;cursor:pointer;">
                        <span>${cat.icon}</span>
                        <span>${cat.name}</span>
                        <span style="font-size:0.7rem;">${count}</span>
                    </div>
                `);
                $tab.on('hover:enter', () => {
                    currentCategory = cat.id;
                    Lampa.Storage.set('nsl_current_category', currentCategory);
                    renderContent($container);
                });
                $tabs.append($tab);
            });
            
            $header.find('[data-action="back"]').on('hover:enter', () => {
                Lampa.Activity.backward();
            });
            
            if (items.length === 0) {
                $container.append('<div style="text-align:center;padding:2rem;opacity:0.6;">📭 В этой категории пока ничего нет</div>');
                return;
            }
            
            const $list = $('<div style="padding:0 1rem;"></div>');
            items.forEach(item => {
                const cd = item.data || {};
                const title = cd.title || cd.name || 'Без названия';
                const year = (cd.release_date || cd.first_air_date || '').slice(0,4);
                const yearStr = year ? ` (${year})` : '';
                const posterUrl = cd.poster_path ? Lampa.TMDB.image('t/p/w92' + cd.poster_path) : null;
                
                const $card = $(`
                    <div class="selector" style="display:flex;align-items:center;gap:0.6em;padding:0.5rem;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05);">
                        ${posterUrl ? `<img src="${posterUrl}" style="width:2.8em;height:4em;object-fit:cover;border-radius:0.3em;flex-shrink:0;">` : '<div style="width:2.8em;height:4em;background:#333;border-radius:0.3em;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.5em;">🎬</div>'}
                        <div style="flex:1;">
                            <div style="font-size:1em;font-weight:500;">${title}${yearStr}</div>
                        </div>
                    </div>
                `);
                
                $card.on('hover:enter', () => {
                    const method = (item.media_type === 'tv' || cd.original_name) ? 'tv' : 'movie';
                    Lampa.Activity.push({
                        id: cd.id || item.card_id,
                        method: method,
                        card: cd,
                        url: '',
                        component: 'full',
                        source: cd.source || 'tmdb'
                    });
                });
                
                $card.on('hover:focus', () => {
                    if (cd.backdrop_path) {
                        Lampa.Background.change(Lampa.TMDB.image('t/p/w780' + cd.backdrop_path));
                    }
                });
                
                $list.append($card);
            });
            
            $container.append($list);
        }
        
        const $container = $('<div class="scroll__container" style="height:100%;overflow-y:auto;"></div>');
        renderContent($container);
        
        Lampa.Activity.push({
            url: 'nsl_favorites',
            title: 'Избранное+',
            component: 'nsl_favorites',
            onRender: function($activityContainer) {
                $activityContainer.empty().append($container);
            },
            onStart: function() {
                Lampa.Controller.add('content', {
                    toggle: function() {
                        Lampa.Controller.collectionSet($container);
                        const firstItem = $container.find('.selector').first();
                        if (firstItem.length) Lampa.Controller.collectionFocus(firstItem[0], $container);
                    },
                    up: function() { if (Navigator.canmove('up')) Navigator.move('up'); else Lampa.Controller.toggle('head'); },
                    down: function() { Navigator.move('down'); },
                    left: function() { if (Navigator.canmove('left')) Navigator.move('left'); else Lampa.Controller.toggle('menu'); },
                    right: function() { Navigator.move('right'); },
                    back: function() { Lampa.Activity.backward(); }
                });
                Lampa.Controller.toggle('content');
            }
        });
    }
    
    function addFavoritesPageToMenu() {
        setTimeout(() => {
            const ml = $('.menu__list').eq(0);
            if (!ml.length || $('.nsl-favorites-page-item').length) return;
            
            const newCount = getNewEpisodesCount();
            const badge = newCount > 0 ? ` <span class="nsl-badge" style="background:#f44336;color:#fff;border-radius:50%;padding:0 0.3em;font-size:0.8em;margin-left:0.5em;">🔔${newCount}</span>` : '';
            
            const el = $(`
                <li class="menu__item selector nsl-favorites-page-item">
                    <div class="menu__ico"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" stroke="currentColor" stroke-width="1" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg></div>
                    <div class="menu__text">Избранное+${badge}</div>
                </li>
            `);
            el.on('hover:enter', (e) => { e.stopPropagation(); openFavoritesPage(); });
            ml.append(el);
        }, 1000);
    }
    
    function addSettingsButton() {
        setTimeout(() => {
            let ml = $('.menu__list').eq(2);
            if (!ml.length) ml = $('.menu__list').last();
            if (ml.length && !$('.nsl-settings-item').length) {
                const el = $(`
                    <li class="menu__item selector nsl-settings-item">
                        <div class="menu__ico"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg></div>
                        <div class="menu__text">Избранное+</div>
                    </li>
                `);
                el.on('hover:enter', () => showSettingsMenu());
                ml.append(el);
            }
        }, 2000);
    }
    
    function showSettingsMenu() {
        const c = cfg();
        const cardModeNames = { none: 'Выкл', nsl_status: 'Избранное+', lampa_default: 'Стандарт Lampa' };
        const posNames = { top: 'Сверху', center: 'По центру', bottom: 'Снизу' };
        
        Lampa.Select.show({
            title: '⚙️ Избранное+',
            items: [
                { title: `⭐ Избранное (${getFavorites().length})`, action: 'favorites' },
                { title: `📌 Закладки разделов (${store.getBookmarks().length})`, action: 'bookmarks' },
                { title: '──────────', separator: true },
                { title: `🎨 Отображение: ${cardModeNames[c.card_display_mode] || 'Выкл'}`, action: 'card_display_mode' },
                { title: `📍 Позиция статуса: ${posNames[c.nsl_status_position] || 'Снизу'}`, action: 'nsl_status_position' },
                { title: '──────────', separator: true },
                { title: `🔔 Новые серии: ${c.check_new_episodes ? 'Вкл' : 'Выкл'}`, action: 'toggle_new_episodes' },
                { title: '──────────', separator: true },
                { title: '☁️ GitHub Gist', action: 'gist' },
                { title: '──────────', separator: true },
                { title: '❌ Закрыть', action: 'cancel' }
            ],
            onSelect: (item) => {
                if (item.action === 'favorites') openFavoritesPage();
                else if (item.action === 'bookmarks') showBookmarksSettings();
                else if (item.action === 'card_display_mode') {
                    Lampa.Select.show({
                        title: 'Отображение на карточках',
                        items: [
                            { title: '❌ Выкл', action: 'none' },
                            { title: '⭐ Избранное+', action: 'nsl_status' },
                            { title: '🔄 Стандарт Lampa', action: 'lampa_default' }
                        ],
                        onSelect: (si) => {
                            if (si.action) {
                                c.card_display_mode = si.action;
                                saveCfg(c);
                                applyCardDisplayMode();
                            }
                            showSettingsMenu();
                        }
                    });
                } else if (item.action === 'nsl_status_position') {
                    Lampa.Select.show({
                        title: 'Позиция статуса',
                        items: [
                            { title: '⬆️ Сверху', action: 'top' },
                            { title: '↕️ По центру', action: 'center' },
                            { title: '⬇️ Снизу', action: 'bottom' }
                        ],
                        onSelect: (si) => {
                            if (si.action) {
                                c.nsl_status_position = si.action;
                                saveCfg(c);
                                updateCardStyles();
                                refreshAllCardStatuses();
                            }
                            showSettingsMenu();
                        }
                    });
                } else if (item.action === 'toggle_new_episodes') {
                    c.check_new_episodes = !c.check_new_episodes;
                    saveCfg(c);
                    if (c.check_new_episodes) startSeriesCheckTimer();
                    else if (seriesCheckTimer) clearInterval(seriesCheckTimer);
                    showSettingsMenu();
                } else if (item.action === 'gist') showGistSettings();
            }
        });
    }
    
    function showBookmarksSettings() {
        const bookmarks = store.getBookmarks();
        if (!bookmarks.length) {
            notify('📭 Нет сохранённых закладок');
            return;
        }
        
        const items = bookmarks.map(b => ({
            title: `📌 ${b.name}`,
            bookmark: b,
            onSelect: () => openBookmark(b),
            onLongPress: () => {
                Lampa.Select.show({
                    title: `Удалить "${b.name}"?`,
                    items: [{ title: 'Нет', action: 'cancel' }, { title: 'Да', action: 'remove' }],
                    onSelect: (opt) => { if (opt.action === 'remove') removeBookmark(b); showBookmarksSettings(); }
                });
            }
        }));
        
        items.push({ title: '──────────', separator: true });
        items.push({ title: '🗑️ Очистить все', action: 'clear' });
        items.push({ title: '◀ Назад', action: 'back' });
        
        Lampa.Select.show({
            title: '📌 Закладки разделов',
            items,
            onSelect: (item) => {
                if (item.action === 'clear') {
                    Lampa.Select.show({
                        title: '⚠️ Удалить все закладки?',
                        items: [{ title: '✅ Да', action: 'confirm' }, { title: '❌ Нет', action: 'cancel' }],
                        onSelect: (opt) => {
                            if (opt.action === 'confirm') {
                                store.setBookmarks([]);
                                renderBookmarks();
                                notify('🗑️ Все закладки удалены');
                            }
                            showBookmarksSettings();
                        }
                    });
                } else if (item.action === 'back') showSettingsMenu();
            }
        });
    }
    
    function showGistSettings() {
        const c = cfg();
        Lampa.Select.show({
            title: '☁️ GitHub Gist',
            items: [
                { title: `🔑 Токен: ${c.gist_token ? '✓' : '❌'}`, action: 'set_token' },
                { title: `📄 Gist ID: ${c.gist_id ? c.gist_id.slice(0, 8) + '…' : '❌'}`, action: 'set_id' },
                { title: '──────────', separator: true },
                { title: '📤 Экспорт на Gist', action: 'upload' },
                { title: '📥 Импорт с Gist', action: 'download' },
                { title: '──────────', separator: true },
                { title: '◀ Назад', action: 'back' }
            ],
            onSelect: (item) => {
                if (item.action === 'set_token') {
                    Lampa.Input.edit({ title: 'GitHub Token', value: c.gist_token || '', free: true }, (val) => {
                        if (val !== null) { c.gist_token = val; saveCfg(c); }
                        showGistSettings();
                    });
                } else if (item.action === 'set_id') {
                    Lampa.Input.edit({ title: 'Gist ID', value: c.gist_id || '', free: true }, (val) => {
                        if (val !== null) { c.gist_id = val; saveCfg(c); }
                        showGistSettings();
                    });
                } else if (item.action === 'upload') {
                    syncToGist('favorites', false);
                    syncToGist('timeline', false);
                    syncToGist('bookmarks', false);
                    notify('📤 Отправлено на Gist');
                    setTimeout(() => showGistSettings(), 1500);
                } else if (item.action === 'download') {
                    syncFromGist(true);
                    setTimeout(() => showGistSettings(), 1500);
                } else if (item.action === 'back') showSettingsMenu();
            }
        });
    }

    // ====================== ИНИЦИАЛИЗАЦИЯ ======================
    function init() {
        if (!cfg().enabled) return;
        console.log('[NSL] Initializing v2 with improved API integration');
        
        // Добавляем стили
        $('<style>').text(`
            .nsl-hidden-lampa-button{display:none!important}
            .nsl-card-status{position:absolute;left:0.8em;right:0.8em;z-index:5;display:flex;align-items:center;gap:0.4em;padding:0.5em 0.8em;background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);border-radius:0.5em;pointer-events:none;font-size:0.7em;line-height:1.5}
            .nsl-card-status__icon{flex-shrink:0;font-size:1.2em}
            .nsl-card-status__text{color:#fff;font-weight:500;flex:1;min-width:0}
            .nsl-card-status--top{top:0.5em;bottom:auto}
            .nsl-card-status--center{top:50%;bottom:auto;transform:translateY(-50%)}
            .nsl-card-status--bottom{bottom:2.5em;top:auto}
        `).appendTo('head');
        
        // Инициализация
        addBookmarkButton();
        addFavoritesPageToMenu();
        addSettingsButton();
        renderBookmarks();
        initPlayerTracking();  // ← используем Lampa.Player.listener вместо перехвата Android.openPlayer
        
        // Стили отображения
        updateCardStyles();
        
        // Автоматические задачи
        startSeriesCheckTimer();
        setTimeout(() => {
            syncTimelineWithCategories();
            checkNewEpisodes(false);
        }, 5000);
        
        // Автосинхронизация при закрытии
        window.addEventListener('beforeunload', () => {
            if (cfg().sync_on_close && cfg().gist_token && cfg().gist_id) {
                syncToGist('favorites', false);
                syncToGist('timeline', false);
                syncToGist('bookmarks', false);
            }
        });
        
        // Экспорт API
        window.NSL = {
            cfg, getFavorites, getBookmarks: store.getBookmarks,
            syncToGist, syncFromGist, addToFavorites, toggleFavorite,
            getMovieStatus, refreshAllCardStatuses
        };
        
        console.log('[NSL] Initialized successfully');
    }
    
    // Запуск после готовности Lampa
    if (window.appready) init();
    else Lampa.Listener.follow('app', (e) => { if (e.type === 'ready') init(); });
})();
