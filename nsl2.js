(function () {
    'use strict';

    if (window.nsl_sync_init) return;
    window.nsl_sync_init = true;

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
    const FN = (suffix) => `nsl_${suffix}_${PROFILE_ID}_v4`;
    const STORE_BOOKMARKS = FN('bookmarks');
    const STORE_FAVORITES = FN('favorites');
    const STORE_TIMELINE = FN('timeline');
    const STORE_MOVE_LOG = `nsl_move_log_${PROFILE_ID}_v1`;
    const STORE_SERIES_CHECK = `nsl_series_check_${PROFILE_ID}_v1`;
    const STORE_HISTORY = `nsl_history_${PROFILE_ID}_v1`;
    const CFG = FN('cfg');
    const GIST_CACHE = `nsl_gist_cache_${PROFILE_ID}`;
    const FILE_VIEW_KEY = 'file_view' + (PROFILE_ID !== 'default' ? '_' + PROFILE_ID : '');

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

    const MONTHS = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
    
    const STATUS_BADGE_STYLE = 'style="margin-left:8px;display:flex;align-items:center;gap:6px;padding:0 12px;height:32px;border-radius:4px;background-color:rgba(0,0,0,0.4);color:rgba(255,255,255,0.9)!important;font-size:16px!important;font-weight:400;cursor:help;white-space:nowrap;border:none;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);"';

    let cardDisplayPatched = false, seriesCheckTimer = null, syncingFromGist = false;
    const syncFlags = { fav: false, time: false, book: false, his: false };

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

    // ====================== ХЕЛПЕРЫ ======================
    function getBookmarks() { return Lampa.Storage.get(STORE_BOOKMARKS, []) || []; }
    function saveBookmarks(l) { Lampa.Storage.set(STORE_BOOKMARKS, l, true); renderBookmarks(); }
    function getFavorites() { return Lampa.Storage.get(STORE_FAVORITES, []) || []; }
    function saveFavorites(l) {
        Lampa.Storage.set(STORE_FAVORITES, l, true);
        if (!syncingFromGist) setTimeout(() => Lampa.Listener.send('state:changed', { target: 'nsl_favorites', reason: 'update' }), 100);
    }
    function getTimeline() { return Lampa.Storage.get(STORE_TIMELINE, {}) || {}; }
    function saveTimeline(t) { Lampa.Storage.set(STORE_TIMELINE, t, true); }
    function getMoveLog() { return Lampa.Storage.get(STORE_MOVE_LOG, []) || []; }
    function saveMoveLog(l) { if (l.length > 50) l = l.slice(-50); Lampa.Storage.set(STORE_MOVE_LOG, l, true); }
    function getSeriesCheck() { return Lampa.Storage.get(STORE_SERIES_CHECK, {}) || {}; }
    function saveSeriesCheck(s) { Lampa.Storage.set(STORE_SERIES_CHECK, s, true); }
    function getHistory() { return Lampa.Storage.get(STORE_HISTORY, []) || []; }
    function saveHistory(h) { if (h.length > 50) h = h.slice(-50); Lampa.Storage.set(STORE_HISTORY, h, true); }
    function getFileView() { return Lampa.Storage.get(FILE_VIEW_KEY, {}) || {}; }
    function saveFileView(fv) { Lampa.Storage.set(FILE_VIEW_KEY, fv, true); }

    function notify(text) { /* уведомления отключены */ }
    
    function formatTime(s) {
        if (!s || s < 0) return '0:00';
        const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = Math.floor(s%60);
        return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
    }
    
    function formatTimeShort(s) {
        if (!s || s < 0) return '';
        const h = Math.floor(s/3600), m = Math.floor((s%3600)/60);
        return h > 0 ? `${h} ч. ${m} м.` : m > 0 ? `${m} м.` : `${Math.floor(s)} с.`;
    }
    
    function formatTotalTime(s) {
        if (s < 60) return `${s} с`;
        const h = Math.floor(s/3600), m = Math.floor((s%3600)/60);
        return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
    }
    
    function extractYear(cd) { return cd.release_date ? cd.release_date.slice(0,4) : cd.first_air_date ? cd.first_air_date.slice(0,4) : ''; }
    function getPosterUrl(cd) { return cd.poster_path ? Lampa.TMDB.image('t/p/w92' + cd.poster_path) : null; }
    
    function extractTmdbId(item) {
        if (!item) return null;
        if (item.tmdb_id) return String(item.tmdb_id);
        if (item.id && /^\d{2,8}$/.test(String(item.id))) return String(item.id);
        if (item.movie_id && /^\d{6,8}$/.test(String(item.movie_id))) return String(item.movie_id);
        return null;
    }
    
    function getBaseTmdbId(tmdbId) { return tmdbId ? String(tmdbId).replace(/[_-].*$/, '') : null; }
    
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
    
    function getDaysWord(d) {
        if (d % 10 === 1 && d % 100 !== 11) return 'день';
        if (d % 10 >= 2 && d % 10 <= 4 && (d % 100 < 10 || d % 100 >= 20)) return 'дня';
        return 'дней';
    }
    
    function getTimeAgo(ts) {
        const diff = Date.now() - ts, mins = Math.floor(diff/60000), hrs = Math.floor(diff/3600000), days = Math.floor(diff/86400000);
        if (mins < 1) return 'Только что'; if (mins < 60) return `${mins} мин назад`;
        if (hrs < 24) return `${hrs} ч назад`; if (days < 7) return `${days} дн назад`;
        return new Date(ts).toLocaleDateString();
    }
    
    function confirmDialog(title, items, onSelect, onBack) {
        Lampa.Select.show({ title, items, onSelect, onBack: onBack || (() => Lampa.Controller.toggle('content')) });
    }
    
    function editNumberSetting(title, value, callback) {
        Lampa.Input.edit({ title, value: String(value), free: true, number: true }, (val) => { if (val !== null && !isNaN(val)) callback(parseInt(val)); });
    }
    
    function renderCardItemHTML(cardData, item, options = {}) {
        const itemTitle = cardData.title || cardData.name || 'Без названия';
        const year = extractYear(cardData), posterUrl = getPosterUrl(cardData), yearStr = year ? ` (${year})` : '';
        const posterHTML = posterUrl ? `<img src="${posterUrl}" style="width:2.8em;height:4em;object-fit:cover;border-radius:0.3em;flex-shrink:0;" onerror="this.style.display='none'">` : '<div style="width:2.8em;height:4em;background:#333;border-radius:0.3em;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.5em;">🎬</div>';
        const subHTML = options.sub ? `<div style="font-size:0.85em;opacity:0.8;line-height:1.2;">${options.sub}</div>` : '';
        const titleHTML = options.multiLine ? `<div style="font-size:1.1em;line-height:1.3;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word;">${itemTitle}${yearStr}</div>` : `<div style="font-size:1.1em;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${itemTitle}${yearStr}</div>`;
        return { html: `<div style="display:flex;align-items:center;gap:0.6em;min-height:3.8em;padding:0.2em 0;">${posterHTML}<div style="flex:1;min-width:0;${options.multiLine ? 'display:flex;flex-direction:column;justify-content:center;gap:0.2em;' : ''}">${titleHTML}${subHTML}</div></div>`, itemTitle, year, posterUrl };
    }
    
    function openItem(item) {
        const cd = item.data || {};
        const method = (item.media_type === 'tv' || cd.original_name) ? 'tv' : 'movie';
        const cardId = cd.id || item.card_id || getBaseTmdbId(item.tmdb_id);
        const source = cd.source || 'tmdb';
        Lampa.Activity.push({ id: cardId, method, card: { id: cardId, source, title: cd.title, name: cd.name, original_name: cd.original_name, original_title: cd.original_title, poster_path: cd.poster_path, backdrop_path: cd.backdrop_path, overview: cd.overview, vote_average: cd.vote_average, first_air_date: cd.first_air_date, release_date: cd.release_date, img: cd.img }, url: '', component: 'full', source, page: 1 });
    }
    
    function pushActivity(item) {
        const cd = item.data || {};
        const method = (item.media_type === 'tv' || cd.original_name) ? 'tv' : 'movie';
        const cardId = cd.id || item.card_id || getBaseTmdbId(item.tmdb_id);
        Lampa.Activity.push({ id: cardId, method, card: { id: cardId, source: cd.source||'tmdb', title: cd.title, name: cd.name, original_name: cd.original_name, original_title: cd.original_title, poster_path: cd.poster_path, backdrop_path: cd.backdrop_path, overview: cd.overview, vote_average: cd.vote_average, first_air_date: cd.first_air_date, release_date: cd.release_date, img: cd.img }, url: '', component: 'full', source: cd.source||'tmdb', page: 1 });
    }
    
    function applyCategoryRules(tmdbId, newCategory, favorites) {
        const rules = CATEGORY_RULES[newCategory];
        if (!rules || !rules.removeFrom.length) return false;
        const baseId = getBaseTmdbId(tmdbId); let changed = false;
        for (const catToRemove of rules.removeFrom) {
            const index = favorites.findIndex(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === catToRemove);
            if (index >= 0) { favorites.splice(index, 1); changed = true; }
        }
        return changed;
    }

    // ====================== ЗАКЛАДКИ РАЗДЕЛОВ ======================
    const ICON_FLAG = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M6 2v20l6-4 6 4V2z"/></svg>';
    const ICON_ADD = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M11 5h2v14h-2zM5 11h14v2H5z"/></svg>';
    
    function makeKey(a) { return [a.url||'', a.component||'', a.source||'', a.id||'', a.job||'', JSON.stringify(a.genres||''), JSON.stringify(a.params||'')].join('|'); }
    function bookmarkExists(act) { return getBookmarks().some(i => i.key === makeKey(act)); }
    function isAllowedForBookmark() {
        const act = Lampa.Activity.active();
        if (!act) return false;
        if (act.component === 'actor' || act.component === 'person') return true;
        if (!act.url || ['movie','tv','anime','catalog'].includes(act.url)) return false;
        if (act.params || act.genres || act.sort || act.filter) return true;
        return act.url.indexOf('discover') !== -1 && act.url.indexOf('?') !== -1;
    }
    function normalizeBookmark(a) { return { id: Date.now(), key: makeKey(a), name: a.title||a.name||'Закладка', url: a.url, component: a.component||'category_full', source: a.source||'tmdb', id_person: a.id, job: a.job, genres: a.genres, params: a.params, page: a.page||1, created: Date.now() }; }
    
    function saveBookmark() {
        const act = Lampa.Activity.active();
        if (!isAllowedForBookmark()) { notify('Здесь нельзя создать закладку'); return; }
        if (bookmarkExists(act)) { notify('Уже есть'); return; }
        Lampa.Input.edit({ title: 'Название', value: act.title||act.name||'Закладка', free: true }, (val) => {
            if (!val) { if (isAndroid) Lampa.Controller.toggle('content'); return; }
            getBookmarks().push({ ...normalizeBookmark(act), name: val.trim() });
            saveBookmarks(getBookmarks());
            if (cfg().sync_on_add) syncToGist('bookmarks', false);
            notify('Сохранено');
            if (isAndroid) Lampa.Controller.toggle('content');
        }, () => { if (isAndroid) Lampa.Controller.toggle('content'); });
    }
    
    function removeBookmark(item) { saveBookmarks(getBookmarks().filter(i => i.id !== item.id)); notify('Удалено'); if (cfg().sync_on_remove) syncToGist('bookmarks', false); }
    function openBookmark(item) { Lampa.Activity.push({ url: item.url, title: item.name, component: item.component, source: item.source, id: item.id_person, job: item.job, genres: item.genres, params: item.params, page: item.page }); }
    
    function renderBookmarks() {
        $('.nsl-bookmark-item').remove();
        const ml = $('.menu__list').first();
        if (!ml.length) return;
        getBookmarks().forEach(item => {
            const el = $(`<li class="menu__item selector nsl-bookmark-item"><div class="menu__ico">${ICON_FLAG}</div><div class="menu__text" style="line-height:1.1;padding-top:0.3em;padding-bottom:0.3em;">${item.name}</div></li>`);
            el.on('hover:enter', (e) => { e.stopPropagation(); openBookmark(item); });
            el.on('hover:long', (e) => { e.stopPropagation(); confirmDialog(`Удалить "${item.name}"?`, [{ title: 'Нет', action: 'cancel' }, { title: 'Да', action: 'remove' }], (a) => { if (a.action === 'remove') removeBookmark(item); }); });
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

    // ====================== ИЗБРАННОЕ ======================
    let tmdbSeriesDataCache = {};
    
    function addToFavorites(card, category) {
        if (!card || !card.id) return false;
        const tmdbId = extractTmdbId(card), mediaType = getMediaType(card), favorites = getFavorites(), baseId = getBaseTmdbId(tmdbId);
        const inCollection = favorites.find(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === 'collection');
        applyCategoryRules(tmdbId, category, favorites);
        const existingIndex = favorites.findIndex(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === category);
        const cardData = cleanCardData(card);
        const needSeriesData = isSeries(cardData) && !cardData.number_of_seasons;
        const saveItem = (fcd) => {
            const fi = { id: Date.now(), card_id: card.id, tmdb_id: tmdbId, media_type: mediaType, category, data: fcd, added: Date.now(), updated: Date.now() };
            const title = fcd.title || fcd.name || 'Без названия';
            if (existingIndex >= 0) favorites[existingIndex] = fi;
            else { favorites.push(fi); logMove('add', title, null, category); }
            if (inCollection && category !== 'collection' && !favorites.some(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === 'collection')) favorites.push(inCollection);
            saveFavorites(favorites); checkAutoAbandoned(); refreshNewEpisodesBadge();
            if (cfg().sync_on_add) syncToGist('favorites', false);
        };
        if (needSeriesData && typeof Lampa.TMDB !== 'undefined' && Lampa.TMDB.api) {
            if (tmdbSeriesDataCache[baseId] && Date.now() - tmdbSeriesDataCache[baseId].time < 3600000) {
                const cd = tmdbSeriesDataCache[baseId].data;
                cardData.number_of_seasons = cd.number_of_seasons || 0; cardData.number_of_episodes = cd.number_of_episodes || 0; cardData.last_air_date = cd.last_air_date || '';
                saveItem(cardData); return true;
            }
            $.ajax({ url: Lampa.TMDB.api('tv/'+baseId+'?api_key='+Lampa.TMDB.key()), method: 'GET', timeout: 5000,
                success: (data) => {
                    cardData.number_of_seasons = data.number_of_seasons||0; cardData.number_of_episodes = data.number_of_episodes||0; cardData.last_air_date = data.last_air_date||'';
                    tmdbSeriesDataCache[baseId] = { time: Date.now(), data: { number_of_seasons: cardData.number_of_seasons, number_of_episodes: cardData.number_of_episodes, last_air_date: cardData.last_air_date } };
                    saveItem(cardData);
                },
                error: () => saveItem(cardData)
            });
        } else saveItem(cardData);
        return true;
    }
    
    function removeFromFavorites(card, category) {
        const favorites = getFavorites(), baseId = getBaseTmdbId(extractTmdbId(card));
        const index = favorites.findIndex(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === category);
        if (index >= 0) { favorites.splice(index, 1); saveFavorites(favorites); refreshNewEpisodesBadge(); if (cfg().sync_on_remove) syncToGist('favorites', false); return true; }
        return false;
    }
    
    function toggleFavorite(card, category) { return isInFavorites(card, category) ? removeFromFavorites(card, category) : addToFavorites(card, category); }
    function isInFavorites(card, category) { return getFavorites().some(f => getBaseTmdbId(f.tmdb_id) === getBaseTmdbId(extractTmdbId(card)) && f.category === category); }
    function getFavoritesByCategory(category) { return getFavorites().filter(f => f.category === category); }

    function deleteCompletely(item) {
        const baseId = getBaseTmdbId(item.tmdb_id), title = item.data?.title||item.data?.name||'Без названия';
        let favorites = getFavorites().filter(f => getBaseTmdbId(f.tmdb_id) !== baseId); saveFavorites(favorites);
        const timeline = getTimeline();
        for (const key in timeline) { if (getBaseTmdbId(timeline[key]?.tmdb_id) === baseId || getBaseTmdbId(key) === baseId) delete timeline[key]; }
        saveTimeline(timeline);
        saveHistory(getHistory().filter(h => getBaseTmdbId(h.tmdb_id) !== baseId && h.id != baseId));
        const fv = Lampa.Storage.get('file_view', {}); for (const key in fv) { if (String(key).includes(baseId)) delete fv[key]; }
        Lampa.Storage.set('file_view', fv, true);
        const fav = Lampa.Storage.get('favorite', {}); if (fav.history) { fav.history = fav.history.filter(id => String(id) !== baseId); Lampa.Storage.set('favorite', fav, true); }
        if (Lampa.Cache && typeof Lampa.Cache.rewriteData === 'function') Lampa.Cache.rewriteData('timetable', baseId, null).catch(() => {});
        notify(`🗑️ "${title}" удалён полностью`); logMove('delete', title, item.category, null); refreshNewEpisodesBadge();
        if (cfg().sync_on_remove) { syncToGist('favorites', false); syncToGist('timeline', false); syncToGist('history', false); }
    }

    let autoAbandonedRunning = false;
    function checkAutoAbandoned() {
        if (autoAbandonedRunning) return; if (!cfg().auto_abandoned) return;
        autoAbandonedRunning = true;
        try {
            const now = Date.now(), threshold = cfg().abandoned_days * 86400000, favorites = getFavorites(); let changed = false;
            for (const item of favorites.filter(f => f.category === 'watching')) {
                if ((item.updated||item.added) > 0 && (now - (item.updated||item.added)) > threshold) {
                    item.category = 'abandoned'; item.updated = now;
                    applyCategoryRules(item.tmdb_id, 'abandoned', favorites);
                    logMove('auto_abandoned', item.data?.title||item.data?.name||'Без названия', 'watching', 'abandoned'); changed = true;
                }
            }
            if (changed) { saveFavorites(favorites); if (cfg().gist_token && cfg().gist_id) syncToGist('favorites', false); }
        } finally { autoAbandonedRunning = false; }
    }
    
    function checkAutoRemoveWatched() {
        if (!cfg().auto_remove_watched) return;
        const now = Date.now(), threshold = cfg().auto_remove_watched_days * 86400000;
        let favorites = getFavorites(); const timeline = getTimeline();
        const toRemove = favorites.filter(f => f.category === 'watched' && (f.updated||f.added) > 0 && (now - (f.updated||f.added)) > threshold);
        if (!toRemove.length) return;
        toRemove.forEach(item => {
            const baseId = getBaseTmdbId(item.tmdb_id);
            favorites = favorites.filter(f => getBaseTmdbId(f.tmdb_id) !== baseId || f.category !== 'watched');
            for (const key in timeline) { if (getBaseTmdbId(timeline[key]?.tmdb_id) === baseId) delete timeline[key]; }
        });
        saveFavorites(favorites); saveTimeline(timeline); refreshNewEpisodesBadge();
        notify(`🧹 Авто-удалено просмотренных: ${toRemove.length}`);
        if (cfg().gist_token && cfg().gist_id) { syncToGist('favorites', false); syncToGist('timeline', false); }
    }
    
    function checkUnfinishedWatching() {
        if (!cfg().auto_watching) return;
        const timeline = getTimeline(), favorites = getFavorites(), now = Date.now();
        const unfinished = favorites.filter(f => {
            if (f.category !== 'watching' || now - (f.updated||f.added) < 604800000) return false;
            let maxP = 0; const baseId = getBaseTmdbId(f.tmdb_id);
            for (const key in timeline) { if (getBaseTmdbId(timeline[key]?.tmdb_id) === baseId) maxP = Math.max(maxP, timeline[key].percent||0); }
            return maxP >= 20 && maxP <= 80;
        });
        if (unfinished.length > 0) {
            const titles = unfinished.slice(0,3).map(f => `"${f.data?.title||f.data?.name||'Без названия'}" (${getProgressPercent(f.tmdb_id)}%)`).join(', ');
            notify(`🎬 Не доcмотрено: ${titles}`);
        }
    }
    
    function getProgressPercent(tmdbId) {
        let maxP = 0; const baseId = getBaseTmdbId(tmdbId), timeline = getTimeline();
        for (const key in timeline) { if (getBaseTmdbId(timeline[key]?.tmdb_id) === baseId) maxP = Math.max(maxP, timeline[key].percent||0); }
        return maxP;
    }

     // ====================== АВТО-ПЕРЕМЕЩЕНИЕ ======================
    let returnedToWatchingMap = {}, syncTimelineTimer = null;
    
    function returnToWatching(tmdbId) {
        const favorites = getFavorites(), baseId = getBaseTmdbId(tmdbId);
        const item = favorites.find(f => getBaseTmdbId(f.tmdb_id) === baseId && (f.category==='abandoned'||f.category==='watched'));
        if (item) {
            const oldCat = item.category; item.category = 'watching'; item.updated = Date.now();
            applyCategoryRules(tmdbId, 'watching', favorites);
            logMove(oldCat==='abandoned'?'return_abandoned':'return_watched', item.data?.title||item.data?.name||'Без названия', oldCat, 'watching');
            saveFavorites(favorites); returnedToWatchingMap[baseId] = true;
            if (cfg().gist_token && cfg().gist_id) syncToGist('favorites', false);
            return true;
        }
        return false;
    }
    
    function moveToCategory(tmdbId, title, cardData, baseId, category) {
        const favorites = getFavorites(), exists = favorites.find(f => getBaseTmdbId(f.tmdb_id) === baseId);
        const mediaType = isSeries(cardData) ? 'tv' : 'movie';
        if (exists) {
            const oldCat = exists.category; exists.category = category; exists.updated = Date.now();
            applyCategoryRules(tmdbId, category, favorites);
            logMove('auto_'+category, title, oldCat, category);
        } else {
            favorites.push({ id: Date.now(), card_id: baseId, tmdb_id: baseId, media_type: mediaType, category, data: cardData, added: Date.now(), updated: Date.now() });
            logMove('auto_'+category, title, null, category);
        }
        saveFavorites(favorites); return true;
    }
    
    function moveToWatching(tmdbId, title, cardData, baseId) { return moveToCategory(tmdbId, title, cardData, baseId, 'watching'); }
    function moveToWatched(tmdbId, title, cardData, baseId) { return moveToCategory(tmdbId, title, cardData, baseId, 'watched'); }

    function syncTimelineWithCategories() {
        const c = cfg();
        console.log('[NSL] syncTimelineWithCategories called');
        
        if (!c.auto_watching && !c.auto_watched) {
            console.log('[NSL] Auto-move disabled, skipping');
            return;
        }
        
        if (syncTimelineTimer) { 
            clearTimeout(syncTimelineTimer); 
            syncTimelineTimer = null; 
        }
        
        const timeline = getTimeline();
        const favorites = getFavorites();
        console.log('[NSL] Timeline entries:', Object.keys(timeline).length, 'Favorites:', favorites.length);
        
        let changed = false;
        
        for (const [key, item] of Object.entries(timeline)) {
            const tmdbId = item.tmdb_id;
            if (!tmdbId) continue;
            
            const baseId = getBaseTmdbId(tmdbId);
            const percent = item.percent || 0;
            const time = item.time || 0;
            
            // Проверяем, не в abandoned ли уже
            if (favorites.some(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === 'abandoned')) {
                continue;
            }
            
            // Проверяем защиту от повторного возврата
            if (returnedToWatchingMap[baseId]) {
                continue;
            }
            
            const existingWatching = favorites.find(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === 'watching');
            const existingWatched = favorites.find(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === 'watched');
            const existingOther = favorites.find(f => getBaseTmdbId(f.tmdb_id) === baseId);
            
            const cardData = existingOther?.data || { id: tmdbId, title: 'ID: '+baseId };
            const title = cardData.title || cardData.name || 'ID: '+baseId;
            const isSeriesItem = key.includes('_s') || key.includes('_e');
            
            console.log('[NSL] Key:', key, 'baseId:', baseId, 'percent:', percent, 'time:', time,
                'isSeries:', isSeriesItem, 'inWatching:', !!existingWatching, 'inWatched:', !!existingWatched);
            
            // Для фильмов (не сериалов)
            if (!isSeriesItem) {
                // 1. Проверка: переместить в Просмотрено (95%+)
                if (c.auto_watched && !existingWatched && percent >= c.watched_min_progress) {
                    console.log('[NSL] ✅ MOVING to watched (movie):', title, percent + '%');
                    moveToWatched(tmdbId, title, cardData, baseId);
                    changed = true;
                    continue;
                }
                
                // 2. Проверка: переместить в Смотрю (5-95%)
                if (c.auto_watching && !existingWatching && !existingWatched && 
                    percent >= c.watching_min_progress && percent <= c.watching_max_progress) {
                    console.log('[NSL] ✅ MOVING to watching (movie):', title, percent + '%');
                    moveToWatching(tmdbId, title, cardData, baseId);
                    changed = true;
                    continue;
                }
                
                // 3. НОВОЕ: начал смотреть но percent < 5%, и time > 60 секунд
                if (c.auto_watching && !existingWatching && !existingWatched && 
                    time > 60 && percent < c.watching_min_progress) {
                    console.log('[NSL] ✅ MOVING to watching (movie, started):', title, 'time:', time + 's');
                    moveToWatching(tmdbId, title, cardData, baseId);
                    changed = true;
                }
                
                continue;
            }
            
            // Для сериалов
            // 1. Переместить в Смотрю
            if (c.auto_watching && !existingWatching && !existingWatched && 
                percent >= c.watching_min_progress && percent <= c.watching_max_progress) {
                console.log('[NSL] ✅ MOVING series to watching:', title);
                moveToWatching(tmdbId, title, cardData, baseId);
                changed = true;
                continue;
            }
            
            // 2. НОВОЕ: начал смотреть сериал
            if (c.auto_watching && !existingWatching && !existingWatched && 
                time > 60 && percent < c.watching_min_progress) {
                console.log('[NSL] ✅ MOVING series to watching (started):', title, 'time:', time + 's');
                moveToWatching(tmdbId, title, cardData, baseId);
                changed = true;
                continue;
            }
            
            // 3. Проверка на последний эпизод для перемещения в Просмотрено
            if (c.auto_watched && !existingWatched && existingWatching && percent >= c.watched_min_progress) {
                const match = key.match(/_s(\d+)_e(\d+)/);
                if (match) {
                    const season = parseInt(match[1]);
                    const episode = parseInt(match[2]);
                    
                    // Проверяем, последний ли это эпизод
                    const checkData = getSeriesCheck()[baseId];
                    let isLastEpisode = false;
                    
                    // Сначала проверяем TimeTable
                    const tableData = Lampa.TimeTable?.all() || [];
                    const showData = tableData.find(d => d.id == baseId);
                    
                    if (showData && showData.seasons && showData.seasons.length > 0) {
                        const seasonData = showData.seasons.find(s => s.season_number === season);
                        if (seasonData && seasonData.episodes && seasonData.episodes.length > 0) {
                            let lastEpNum = 0;
                            seasonData.episodes.forEach(ep => { 
                                if (ep.episode_number > lastEpNum) lastEpNum = ep.episode_number; 
                            });
                            isLastEpisode = (episode >= lastEpNum);
                            console.log('[NSL] TimeTable check:', baseId, 'S' + season + 'E' + episode, 
                                'lastEp:', lastEpNum, 'isLast:', isLastEpisode);
                        }
                    } else if (checkData && checkData.seasons_count > 0) {
                        // Если это последний сезон и последний эпизод
                        if (season === checkData.seasons_count && checkData.total_episodes > 0) {
                            isLastEpisode = (episode >= checkData.total_episodes);
                            console.log('[NSL] Cache check:', baseId, 'S' + season + 'E' + episode, 
                                'totalEp:', checkData.total_episodes, 'isLast:', isLastEpisode);
                        }
                    }
                    
                    if (isLastEpisode) {
                        console.log('[NSL] ✅ MOVING series to watched (last episode):', title, 'S' + season + 'E' + episode);
                        const fav = favorites.find(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === 'watching');
                        if (fav) {
                            fav.category = 'watched';
                            fav.updated = Date.now();
                            applyCategoryRules(tmdbId, 'watched', favorites);
                            logMove('auto_watched', title, 'watching', 'watched');
                            changed = true;
                        }
                    }
                }
            }
        }
        
        console.log('[NSL] Changes made:', changed);
        
        if (changed) {
            saveFavorites(favorites);
            refreshNewEpisodesBadge();
            console.log('[NSL] Favorites saved after auto-move');
        }
    }
    
    function clearAllFavorites() {
        confirmDialog('⚠️ Очистить всё избранное?', [{ title: '✅ Да, очистить всё', action: 'clear' }, { title: '❌ Отмена', action: 'cancel' }], (opt) => {
            if (opt.action === 'clear') { saveFavorites([]); notify('🗑️ Избранное очищено'); logMove('clear_all', 'Все фильмы', null, null); refreshNewEpisodesBadge(); if (cfg().sync_on_remove) syncToGist('favorites', false); }
        });
    }

    // ====================== ТАЙМКОДЫ (ПРЯМАЯ ЗАПИСЬ В FILE_VIEW) ======================
    let currentMovieTime = 0, currentMovieKey = null, lastSavedProgress = 0, videoDuration = 0;
    let currentMovie = null;
    let hashToMovie = {};

    // ====================== получить хеш Lampa ======================
    function getLampaHash(tmdbId, movie) {
        if (!tmdbId) return null;
        
        const pd = Lampa.Player.playdata();
        const activity = Lampa.Activity.active();
        const card = movie || activity?.movie || {};
        
        if (card.original_name) {
            const season = pd?.season || 1;
            const episode = pd?.episode || 1;
            const hashString = [season, season > 10 ? ':' : '', episode, card.original_name].join('');
            return Lampa.Utils.hash(hashString);  // ← ИСПРАВЛЕНО
        }
        else if (card.original_title) {
            return Lampa.Utils.hash(card.original_title);  // ← ИСПРАВЛЕНО
        }
        
        return null;
    }

    function getNslKeyFromLampaHash(lampaHash) {
        if (!lampaHash) return null;
        
        const activity = Lampa.Activity.active();
        const movie = activity?.movie;
        if (!movie) return null;
        
        const tmdbId = extractTmdbId(movie);
        if (!tmdbId) return null;
        
        if (movie.original_name) {
            const pd = Lampa.Player.playdata();
            const season = pd?.season || 1;
            const episode = pd?.episode || 1;
            return `${tmdbId}_s${season}_e${episode}`;
        } else {
            return tmdbId;
        }
    }
    
    function getCurrentMovieKey() {
        try {
            const activity = Lampa.Activity.active();
            if (!activity?.movie) return null;
            
            const tmdbId = extractTmdbId(activity.movie);
            if (!tmdbId) return null;
            
            const pd = Lampa.Player.playdata();
            
            if (activity.movie.original_name) {
                const season = pd?.season || 1;
                const episode = pd?.episode || 1;
                const hashString = [season, season > 10 ? ':' : '', episode, activity.movie.original_name].join('');
                return Lampa.Utils.hash(hashString);
            } else if (activity.movie.original_title) {
                return Lampa.Utils.hash(activity.movie.original_title);
            }
            
            return null;
        } catch(e) {}
        return null;
    }
    
    function getCurrentPlayerTime() {
        try {
            if (Lampa.Player.opened()) { const t = Lampa.Player.playdata()?.timeline?.time; if (t !== undefined) return t; }
            const video = document.querySelector('video'); if (video && !isNaN(video.currentTime) && video.currentTime > 0) return video.currentTime;
            if (typeof AndroidJS !== 'undefined' && typeof AndroidJS.getPlayerTime === 'function') { const t = AndroidJS.getPlayerTime(); if (t > 0) return t; }
        } catch(e) {}
        return null;
    }
    
    function getVideoDuration() {
        try {
            const d = Lampa.Player.playdata()?.timeline?.duration; if (d > 0) return d;
            const video = document.querySelector('video'); if (video?.duration > 0 && video.duration < 36000) return video.duration;
            if (typeof AndroidJS !== 'undefined' && typeof AndroidJS.getPlayerDuration === 'function') { const dur = AndroidJS.getPlayerDuration(); if (dur > 0) return dur; }
        } catch(e) {}
        return 0;
    }
    
    function isExternalPlayerActive() {
        if (typeof AndroidJS !== 'undefined') { try { if (typeof AndroidJS.isExternalPlayerActive === 'function') return AndroidJS.isExternalPlayerActive(); if (typeof AndroidJS.getPlayerTime === 'function') return AndroidJS.getPlayerTime() >= 0; } catch(e) {} }
        const video = document.querySelector('video'); return video && !video.paused && video.currentTime > 0;
    }

    /**
     * Прямая запись таймкода в file_view (ключ — наш NSL-ключ)
     * Это гарантирует что Lampa увидит таймкод при запуске плеера
     */
    function writeTimelineToFileView(key, time, duration, percent) {
        if (!key || !time) return;
        
        console.log('[NSL] writeTimelineToFileView:', key, 'time:', time, 'duration:', duration, 'percent:', percent);
        
        const fv = getFileView();
        fv[key] = { 
            time: time, 
            duration: duration || 0, 
            percent: percent || 0, 
            updated: Date.now(), 
            profile: getProfileId() 
        };
        saveFileView(fv);
        
        // Также сохраняем в безымянное хранилище
        const fvNoProfile = Lampa.Storage.get('file_view', {});
        fvNoProfile[key] = { 
            time: time, 
            duration: duration || 0, 
            percent: percent || 0, 
            updated: Date.now(), 
            profile: getProfileId() 
        };
        Lampa.Storage.set('file_view', fvNoProfile, true);
        
        // Обновить ОЗУ Lampa.Timeline
        if (Lampa.Timeline && typeof Lampa.Timeline.update === 'function') {
            Lampa.Timeline.update({
                hash: key,
                time: time,
                duration: duration || 0,
                percent: percent || 0,
                profile: getProfileId()
            });
            console.log('[NSL] Updated Lampa.Timeline in RAM');
        }
    }
    
    // ====================== получить NSL-ключ ======================
    function getNslKey() {
        try {
            const activity = Lampa.Activity.active();
            if (!activity?.movie) return null;
            
            const tmdbId = extractTmdbId(activity.movie);
            if (!tmdbId) return null;
            
            const pd = Lampa.Player.playdata();
            
            if (activity.movie.original_name && pd?.season && pd?.episode) {
                return `${tmdbId}_s${pd.season}_e${pd.episode}`;
            }
            
            return tmdbId;
        } catch(e) {}
        return null;
    }

    function onExternalPlayerTimeUpdate(time, duration) { 
        if (time > 0) { 
            currentMovieTime = time; 
            if (duration > 0) videoDuration = duration;
            lastExternalTime = time;
            
            const activity = Lampa.Activity.active();
            const movie = activity?.movie;
            if (movie) {
                const tmdbId = extractTmdbId(movie);
                if (tmdbId) {
                    const nslKey = currentMovieKey || `${tmdbId}_s1_e1`;
                    const timeline = getTimeline();
                    const percent = duration > 0 ? Math.round((time / duration) * 100) : 0;
                    timeline[nslKey] = {
                        time: time,
                        duration: duration || 0,
                        percent: percent,
                        updated: Date.now(),
                        tmdb_id: tmdbId
                    };
                    saveTimeline(timeline);
                }
            }
        } 
    }
    
    window.NSL.onExternalPlayerTimeUpdate = onExternalPlayerTimeUpdate;
    window.NSL.isExternalPlayerActive = isExternalPlayerActive;
    
    let currentTmdbId = null;
    let lastSavedTime = 0;
    let saveInterval = null;
    
    function startSaveInterval() {
        if (saveInterval) clearInterval(saveInterval);
        
        console.log('[NSL] Starting save interval');
        
        saveInterval = setInterval(() => {
            let time = null;
            let duration = 0;
            
            // Пробуем получить время из разных источников
            const pd = Lampa.Player.playdata();
            if (pd?.timeline?.time > 0) {
                time = pd.timeline.time;
                duration = pd.timeline.duration || 0;
            }
            
            if (!time) {
                const video = document.querySelector('video');
                if (video && video.currentTime > 0) {
                    time = video.currentTime;
                    duration = video.duration || 0;
                }
            }
            
            if (!time && typeof AndroidJS !== 'undefined' && typeof AndroidJS.getPlayerTime === 'function') {
                time = AndroidJS.getPlayerTime();
                if (typeof AndroidJS.getPlayerDuration === 'function') {
                    duration = AndroidJS.getPlayerDuration();
                }
            }
            
            if (time && time > 0 && Math.abs(time - lastSavedTime) >= 5) {
                lastSavedTime = time;
                currentMovieTime = time;
                
                console.log('[NSL] 💾 Interval save - time:', Math.floor(time), 'duration:', duration);
                
                if (currentTmdbId && currentMovie) {
                    let nslKey;
                    const pd = Lampa.Player.playdata();
                    
                    if (currentMovie.original_name && pd?.season && pd?.episode) {
                        nslKey = `${currentTmdbId}_s${pd.season}_e${pd.episode}`;
                    } else if (currentMovie.original_name) {
                        nslKey = `${currentTmdbId}_s1_e1`;
                    } else {
                        nslKey = String(currentTmdbId);
                    }
                    
                    if (!duration) duration = getVideoDuration();
                    const percent = duration > 0 ? Math.round((time / duration) * 100) : 0;
                    
                    // Сохраняем в NSL timeline
                    const nslTimeline = getTimeline();
                    nslTimeline[nslKey] = { 
                        time: time, 
                        percent, 
                        duration, 
                        updated: Date.now(), 
                        tmdb_id: currentTmdbId 
                    };
                    saveTimeline(nslTimeline);
                    
                    // Также сохраняем в file_view через хеш Lampa
                    if (currentMovie.original_name && pd?.season && pd?.episode) {
                        const hashString = [pd.season, pd.season > 10 ? ':' : '', pd.episode, currentMovie.original_name].join('');
                        const lampaHash = Lampa.Utils.hash(hashString);
                        writeTimelineToFileView(lampaHash, time, duration, percent);
                        console.log('[NSL] Also saved to file_view:', lampaHash);
                    } else if (currentMovie.original_title) {
                        const lampaHash = Lampa.Utils.hash(currentMovie.original_title);
                        writeTimelineToFileView(lampaHash, time, duration, percent);
                        console.log('[NSL] Also saved to file_view:', lampaHash);
                    }
                    
                    console.log('[NSL] 💾 Saved to NSL:', nslKey, 'time:', Math.floor(time), 'percent:', percent + '%');
                    
                    // Проверяем авто-возврат в "Смотрю"
                    if (currentTmdbId && time > 60 && !returnedToWatchingMap[getBaseTmdbId(currentTmdbId)]) {
                        returnToWatching(currentTmdbId);
                    }
                }
            }
        }, 10000);
    }
    
    function stopSaveInterval() {
        if (saveInterval) {
            clearInterval(saveInterval);
            saveInterval = null;
            console.log('[NSL] Stopped save interval');
        }
    }
    
    function onPlayerStart() {
        console.log('[NSL] ========== Player started ==========');
        
        const activity = Lampa.Activity.active();
        currentMovie = activity?.card || activity?.movie || null;
        currentTmdbId = currentMovie ? extractTmdbId(currentMovie) : null;
        lastSavedTime = 0;
        returnedToWatchingMap = {};
        
        console.log('[NSL] Movie:', currentMovie?.title || currentMovie?.name, 'tmdbId:', currentTmdbId);
        
        // Определяем сезон и эпизод
        let season = 1;
        let episode = 1;
        
        const pd = Lampa.Player.playdata();
        if (pd) {
            if (pd.season) season = pd.season;
            if (pd.episode) episode = pd.episode;
        }
        
        if (!pd?.season && currentMovieKey) {
            const match = currentMovieKey.match(/_s(\d+)_e(\d+)$/);
            if (match) {
                season = parseInt(match[1]);
                episode = parseInt(match[2]);
            }
        }
        
        // Устанавливаем правильный ключ
        if (currentMovie?.original_name) {
            currentMovieKey = `${currentTmdbId}_s${season}_e${episode}`;
        } else {
            currentMovieKey = String(currentTmdbId);
        }
        
        console.log('[NSL] Current key:', currentMovieKey);
        
        if (currentTmdbId && currentMovie) {
            const timeline = getTimeline();
            const baseId = getBaseTmdbId(currentTmdbId);
            const card = currentMovie;
            
            // Сохраняем маппинг для текущего ключа
            if (card.original_name) {
                const hashString = [season, season > 10 ? ':' : '', episode, card.original_name].join('');
                const lampaHash = Lampa.Utils.hash(hashString);
                hashToMovie[lampaHash] = { tmdbId: currentTmdbId, movie: card };
                console.log('[NSL] Mapped current hash:', lampaHash);
            }
            
            // Синхронизируем все NSL таймкоды в file_view
            for (const nslKey in timeline) {
                if (getBaseTmdbId(timeline[nslKey]?.tmdb_id) === baseId && timeline[nslKey].time > 0) {
                    let lampaHash = null;
                    const episodeMatch = nslKey.match(/^\d+_s(\d+)_e(\d+)$/);
                    
                    if (episodeMatch && card.original_name) {
                        const s = parseInt(episodeMatch[1]);
                        const e = parseInt(episodeMatch[2]);
                        const hashString = [s, s > 10 ? ':' : '', e, card.original_name].join('');
                        lampaHash = Lampa.Utils.hash(hashString);
                    } else if (card.original_title) {
                        lampaHash = Lampa.Utils.hash(card.original_title);
                    }
                    
                    if (lampaHash) {
                        writeTimelineToFileView(lampaHash, timeline[nslKey].time, 
                            timeline[nslKey].duration || 0, timeline[nslKey].percent || 0);
                        console.log('[NSL] Synced NSL → file_view:', nslKey, '→', lampaHash, 'time:', timeline[nslKey].time);
                    }
                }
            }
        }
        
        startSaveInterval();
        console.log('[NSL] ====================================');
    }
    
    function onPlayerDestroy() {
        console.log('[NSL] ========== Player destroyed ==========');
        
        stopSaveInterval();
        
        if (currentTmdbId && currentMovie) {
            console.log('[NSL] Final sync for tmdbId:', currentTmdbId);
            syncLampaTimelineToNSL(currentTmdbId, currentMovie);
        }
        
        setTimeout(() => {
            syncTimelineWithCategories();
            refreshCardUI();
            refreshAllCardStatuses();
            if (cfg().auto_sync && cfg().gist_token && cfg().gist_id) {
                syncToGist('timeline', false);
            }
        }, 1000);
        
        currentMovie = null;
        currentTmdbId = null;
        currentMovieTime = 0;
        lastSavedTime = 0;
        
        console.log('[NSL] =====================================');
    }
    
    function initPlayerHandler() {
        // Перехватываем Android.openPlayer
        const originalOpenPlayer = Lampa.Android.openPlayer;
        Lampa.Android.openPlayer = function(link, data) {
            console.log('[NSL] ========== Android.openPlayer ==========');
            console.log('[NSL] Link:', link);
            console.log('[NSL] Data:', JSON.stringify(data));
            
            const activity = Lampa.Activity.active();
            let movie = activity?.card || activity?.movie;
            
            console.log('[NSL] Movie from activity:', movie?.title || movie?.name || 'NOT FOUND');
            
            if (!movie && data.title) {
                console.log('[NSL] Trying to find by title:', data.title);
                const favorites = getFavorites();
                const found = favorites.find(f => 
                    f.data?.title === data.title || 
                    f.data?.name === data.title ||
                    f.data?.original_name === data.title
                );
                if (found) {
                    movie = found.data;
                    console.log('[NSL] Found by title:', movie.title || movie.name);
                }
            }
            
            if (movie) {
                const tmdbId = extractTmdbId(movie);
                console.log('[NSL] TMDB ID:', tmdbId);
                
                if (tmdbId) {
                    currentMovie = movie;
                    currentTmdbId = tmdbId;
                    
                    if (movie.original_name && data.season && data.episode) {
                        currentMovieKey = `${tmdbId}_s${data.season}_e${data.episode}`;
                        console.log('[NSL] Series, key:', currentMovieKey);
                        
                        // Сохраняем маппинг
                        const hashString = [data.season, data.season > 10 ? ':' : '', data.episode, movie.original_name].join('');
                        const hash = Lampa.Utils.hash(hashString);
                        hashToMovie[hash] = { tmdbId, movie };
                        console.log('[NSL] Mapped hash:', hash);
                        
                        // Сохраняем для соседних эпизодов
                        for (let ep = Math.max(1, data.episode - 1); ep <= data.episode + 1; ep++) {
                            if (ep === data.episode) continue;
                            const hashString2 = [data.season, data.season > 10 ? ':' : '', ep, movie.original_name].join('');
                            const hash2 = Lampa.Utils.hash(hashString2);
                            if (!hashToMovie[hash2]) {
                                hashToMovie[hash2] = { tmdbId, movie };
                            }
                        }
                        
                    } else if (movie.original_name) {
                        // Сериал без указания сезона
                        const timeline = getTimeline();
                        let lastKey = null;
                        let lastSeason = 1;
                        let lastEpisode = 1;
                        
                        for (const key in timeline) {
                            if (getBaseTmdbId(timeline[key]?.tmdb_id) === getBaseTmdbId(tmdbId)) {
                                const match = key.match(/_s(\d+)_e(\d+)/);
                                if (match) {
                                    const s = parseInt(match[1]);
                                    const e = parseInt(match[2]);
                                    if (s > lastSeason || (s === lastSeason && e > lastEpisode)) {
                                        lastSeason = s;
                                        lastEpisode = e;
                                        lastKey = key;
                                    }
                                }
                            }
                        }
                        
                        currentMovieKey = lastKey || `${tmdbId}_s1_e1`;
                        console.log('[NSL] Series (no season info), using:', currentMovieKey);
                        
                    } else {
                        // Фильм
                        currentMovieKey = String(tmdbId);
                        console.log('[NSL] Movie, key:', currentMovieKey);
                        
                        if (movie.original_title) {
                            const hash = Lampa.Utils.hash(movie.original_title);
                            hashToMovie[hash] = { tmdbId, movie };
                            console.log('[NSL] Mapped movie hash:', hash);
                        }
                    }
                    
                    console.log('[NSL] Final currentMovieKey:', currentMovieKey);
                    console.log('[NSL] hashToMovie size:', Object.keys(hashToMovie).length);
                    
                    // Запускаем интервал сохранения
                    startSaveInterval();
                }
            } else {
                console.log('[NSL] ❌ No movie found!');
            }
            
            console.log('[NSL] ========================================');
            
            return originalOpenPlayer.call(Lampa.Android, link, data);
        };
        
        // Слушаем события внутреннего плеера
        Lampa.Player.listener.follow('ready', onPlayerStart);
        Lampa.Player.listener.follow('destroy', onPlayerDestroy);
        
        console.log('[NSL] Player event listeners initialized');
    }
    
    // ====================== ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ: Синхронизация Lampa.Timeline → NSL ======================
    function syncLampaTimelineToNSL(tmdbId, movie) {
        if (!tmdbId || !movie) return false;
        
        const baseId = getBaseTmdbId(tmdbId);
        const nslTimeline = getTimeline();
        const fileView = Lampa.Storage.get('file_view', {});
        const c = cfg();
        const strategy = c.sync_strategy || 'max_time';
        let changed = false;
        let bestForNslKey = {}; // nslKey -> {time, duration, percent, updated}
        
        console.log('[NSL] Syncing Lampa.Timeline → NSL for tmdbId:', tmdbId);
        
        for (const hash in fileView) {
            const road = fileView[hash];
            if (!road.time || road.time <= 0) continue;
            
            // Пропускаем трейлеры (короткие видео с высоким процентом)
            if (road.duration > 0 && road.duration < 300 && road.percent > 90) {
                console.log('[NSL] Skipping likely trailer:', hash, 'duration:', road.duration);
                continue;
            }
            
            let nslKey = null;
            
            if (movie.original_name) {
                // Для сериала - ищем соответствующий NSL-ключ
                for (const key in nslTimeline) {
                    if (getBaseTmdbId(nslTimeline[key]?.tmdb_id) === baseId) {
                        const episodeMatch = key.match(/^(\d+)_s(\d+)_e(\d+)$/);
                        if (episodeMatch) {
                            const season = parseInt(episodeMatch[1]);
                            const episode = parseInt(episodeMatch[2]);
                            const expectedHash = Lampa.Utils.hash(
                                [season, season > 10 ? ':' : '', episode, movie.original_name].join('')
                            );
                            if (expectedHash === hash) {
                                nslKey = key;
                                break;
                            }
                        }
                    }
                }
            } else if (movie.original_title) {
                const expectedHash = Lampa.Utils.hash(movie.original_title);
                if (hash === expectedHash) {
                    nslKey = tmdbId;
                }
            }
            
            if (nslKey && road.time > 0) {
                const existing = bestForNslKey[nslKey];
                
                if (!existing) {
                    bestForNslKey[nslKey] = {
                        time: road.time,
                        duration: road.duration || 0,
                        percent: road.percent || 0,
                        updated: road.updated || 0
                    };
                } else {
                    // Применяем стратегию синхронизации
                    let isBetter = false;
                    
                    if (strategy === 'max_time') {
                        // По длительности просмотра
                        isBetter = road.time > existing.time;
                    } else {
                        // По дате просмотра (last_watch)
                        isBetter = (road.updated || 0) > (existing.updated || 0);
                    }
                    
                    if (isBetter) {
                        bestForNslKey[nslKey] = {
                            time: road.time,
                            duration: road.duration || 0,
                            percent: road.percent || 0,
                            updated: road.updated || 0
                        };
                    }
                }
            }
        }
        
        // Сохраняем лучшие таймкоды
        for (const nslKey in bestForNslKey) {
            const best = bestForNslKey[nslKey];
            const oldTime = nslTimeline[nslKey]?.time || 0;
            const oldUpdated = nslTimeline[nslKey]?.updated || 0;
            
            let shouldUpdate = false;
            
            if (strategy === 'max_time') {
                shouldUpdate = best.time > oldTime;
            } else {
                shouldUpdate = (best.updated || 0) > oldUpdated;
            }
            
            if (shouldUpdate) {
                nslTimeline[nslKey] = {
                    time: best.time,
                    duration: best.duration,
                    percent: best.percent,
                    updated: Date.now(),
                    tmdb_id: tmdbId
                };
                changed = true;
                console.log('[NSL] Updated NSL:', nslKey, 
                    'time:', Math.floor(best.time), 
                    'percent:', best.percent + '%',
                    'strategy:', strategy);
            }
        }
        
        if (changed) {
            saveTimeline(nslTimeline);
            refreshCardUI();
            refreshAllCardStatuses();
        }
        
        return changed;
    }
    
    // ====================== СЛУШАТЕЛЬ ИЗМЕНЕНИЙ Lampa.Timeline ======================
    function initTimelineListener() {
        // Вспомогательная функция сохранения
        function saveTimelineFromHash(hash, road, tmdbId, movie) {
            console.log('[NSL] saveTimelineFromHash: hash=', hash, 'tmdbId=', tmdbId, 'time=', road.time);
            
            const nslTimeline = getTimeline();
            const baseId = getBaseTmdbId(tmdbId);
            let saved = false;
            
            if (movie.original_name) {
                console.log('[NSL] Series detected:', movie.original_name);
                
                // Сначала ищем точное совпадение
                for (const key in nslTimeline) {
                    if (getBaseTmdbId(nslTimeline[key]?.tmdb_id) === baseId) {
                        const episodeMatch = key.match(/^(\d+)_s(\d+)_e(\d+)$/);
                        if (episodeMatch) {
                            const season = parseInt(episodeMatch[1]);
                            const episode = parseInt(episodeMatch[2]);
                            const expectedHash = Lampa.Utils.hash(
                                [season, season > 10 ? ':' : '', episode, movie.original_name].join('')
                            );
                            
                            if (expectedHash === hash) {
                                nslTimeline[key] = {
                                    time: road.time,
                                    duration: road.duration || 0,
                                    percent: road.percent || 0,
                                    updated: Date.now(),
                                    tmdb_id: tmdbId
                                };
                                saveTimeline(nslTimeline);
                                console.log('[NSL] ✅ Saved (exact match):', key, 'time:', road.time, 'percent:', road.percent);
                                saved = true;
                                break;
                            }
                        }
                    }
                }
                
                // Если не нашли точное совпадение - создаем НОВЫЙ ключ
                if (!saved) {
                    let nslKey = null;
                    
                    if (currentMovieKey && currentMovieKey.includes('_s')) {
                        nslKey = currentMovieKey;
                        console.log('[NSL] Using currentMovieKey:', nslKey);
                    } else {
                        // Пытаемся определить по активности
                        const activity = Lampa.Activity.active();
                        const pd = Lampa.Player.playdata();
                        if (pd && pd.season && pd.episode) {
                            nslKey = `${tmdbId}_s${pd.season}_e${pd.episode}`;
                            console.log('[NSL] Derived from playdata:', nslKey);
                        } else {
                            // Ищем последний известный ключ
                            let lastKey = null;
                            let lastEpNum = -1;
                            for (const key in nslTimeline) {
                                if (getBaseTmdbId(nslTimeline[key]?.tmdb_id) === baseId && key.includes('_s')) {
                                    const epMatch = key.match(/_s(\d+)_e(\d+)$/);
                                    if (epMatch) {
                                        const epNum = parseInt(epMatch[1]) * 1000 + parseInt(epMatch[2]);
                                        if (epNum > lastEpNum) {
                                            lastEpNum = epNum;
                                            lastKey = key;
                                        }
                                    }
                                }
                            }
                            
                            if (lastKey) {
                                const lastMatch = lastKey.match(/_s(\d+)_e(\d+)$/);
                                if (lastMatch) {
                                    const season = parseInt(lastMatch[1]);
                                    const episode = parseInt(lastMatch[2]) + 1;
                                    nslKey = `${tmdbId}_s${season}_e${episode}`;
                                    console.log('[NSL] Derived from last key:', lastKey, '-> new:', nslKey);
                                }
                            } else {
                                nslKey = `${tmdbId}_s1_e1`;
                                console.log('[NSL] Using default key:', nslKey);
                            }
                        }
                    }
                    
                    nslTimeline[nslKey] = {
                        time: road.time,
                        duration: road.duration || 0,
                        percent: road.percent || 0,
                        updated: Date.now(),
                        tmdb_id: tmdbId
                    };
                    saveTimeline(nslTimeline);
                    console.log('[NSL] ✅ Saved (new key):', nslKey, 'time:', road.time, 'percent:', road.percent);
                    saved = true;
                }
            } else if (movie.original_title) {
                // Для фильмов
                nslTimeline[tmdbId] = {
                    time: road.time,
                    duration: road.duration || 0,
                    percent: road.percent || 0,
                    updated: Date.now(),
                    tmdb_id: tmdbId
                };
                saveTimeline(nslTimeline);
                console.log('[NSL] ✅ Saved (movie):', tmdbId, 'time:', road.time, 'percent:', road.percent);
                saved = true;
            } else {
                // Фильм без original_title - сохраняем по tmdbId
                nslTimeline[tmdbId] = {
                    time: road.time,
                    duration: road.duration || 0,
                    percent: road.percent || 0,
                    updated: Date.now(),
                    tmdb_id: tmdbId
                };
                saveTimeline(nslTimeline);
                console.log('[NSL] ✅ Saved (movie by id):', tmdbId, 'time:', road.time, 'percent:', road.percent);
                saved = true;
            }
            
            if (saved) {
                refreshCardUI();
                refreshAllCardStatuses();
                syncTimelineWithCategories();
                if (cfg().auto_sync && cfg().gist_token && cfg().gist_id) {
                    setTimeout(() => syncToGist('timeline', false), 5000);
                }
            } else {
                console.log('[NSL] ❌ Could not save - no matching NSL key found');
                // Сохраняем в лог потерянных таймкодов
                const lostTimelines = Lampa.Storage.get('nsl_lost_timelines', {});
                lostTimelines[hash] = {
                    time: road.time,
                    duration: road.duration || 0,
                    percent: road.percent || 0,
                    timestamp: Date.now(),
                    tmdbId: tmdbId
                };
                Lampa.Storage.set('nsl_lost_timelines', lostTimelines, true);
            }
        }
        
        // Слушаем Timeline.listener (прямой слушатель)
        if (Lampa.Timeline && Lampa.Timeline.listener) {
            Lampa.Timeline.listener.follow('update', function(e) {
                if (!e.data || !e.data.hash || !e.data.road) return;
                
                const hash = e.data.hash;
                const road = e.data.road;
                
                if (!road.time || road.time <= 0) return;
                
                console.log('[NSL] ========== Timeline.update ==========');
                console.log('[NSL] Hash:', hash, 'Time:', road.time, 'Percent:', road.percent);
                
                // Пробуем найти сразу
                let info = hashToMovie[hash];
                
                if (!info) {
                    console.log('[NSL] No direct mapping for hash, looking for alternatives...');
                    
                    // Пробуем найти по активности
                    const activity = Lampa.Activity.active();
                    const movie = activity?.card || activity?.movie;
                    
                    if (movie) {
                        const tmdbId = extractTmdbId(movie);
                        if (tmdbId) {
                            console.log('[NSL] Using active movie:', tmdbId, movie.title || movie.name);
                            info = { tmdbId, movie };
                            hashToMovie[hash] = info;
                        }
                    }
                    
                    if (!info) {
                        // Ищем по file_view
                        console.log('[NSL] Checking file_view...');
                        const fileView = Lampa.Storage.get('file_view', {});
                        
                        // Последняя попытка - ищем по всем NSL ключам
                        const nslTimeline = getTimeline();
                        for (const nslKey in nslTimeline) {
                            const nslItem = nslTimeline[nslKey];
                            if (!nslItem.tmdb_id) continue;
                            
                            const movie2 = activity?.card || activity?.movie;
                            if (movie2 && movie2.original_name) {
                                const match = nslKey.match(/_s(\d+)_e(\d+)/);
                                if (match) {
                                    const season = parseInt(match[1]);
                                    const episode = parseInt(match[2]);
                                    const testHash = Lampa.Utils.hash(
                                        [season, season > 10 ? ':' : '', episode, movie2.original_name].join('')
                                    );
                                    if (testHash === hash) {
                                        info = { tmdbId: nslItem.tmdb_id, movie: movie2 };
                                        hashToMovie[hash] = info;
                                        console.log('[NSL] Found matching NSL key:', nslKey);
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
                
                if (info) {
                    console.log('[NSL] Found movie info, saving...');
                    saveTimelineFromHash(hash, road, info.tmdbId, info.movie);
                } else {
                    console.log('[NSL] ❌ Could not find movie for hash:', hash);
                    // Сохраняем в лог потерянных таймкодов
                    const lostTimelines = Lampa.Storage.get('nsl_lost_timelines', {});
                    lostTimelines[hash] = {
                        time: road.time,
                        duration: road.duration,
                        percent: road.percent,
                        timestamp: Date.now()
                    };
                    Lampa.Storage.set('nsl_lost_timelines', lostTimelines, true);
                }
                console.log('[NSL] ======================================');
            });
        }
        
        // Слушаем state:changed как запасной
        Lampa.Listener.follow('state:changed', function(e) {
            if (e.target !== 'timeline' || e.reason !== 'update') return;
            if (!e.data || !e.data.hash || !e.data.road) return;
            
            const hash = e.data.hash;
            const road = e.data.road;
            
            if (!road.time || road.time <= 0) return;
            
            console.log('[NSL] state:changed timeline:', hash, 'time:', road.time);
            
            const info = hashToMovie[hash];
            if (!info) return;
            
            syncLampaTimelineToNSL(info.tmdbId, info.movie);
        });
        
        // Слушаем событие destroy плеера
        Lampa.Player.listener.follow('destroy', function() {
            console.log('[NSL] Player destroyed event');
            setTimeout(() => {
                const movie = currentMovie || Lampa.Activity.active()?.card || Lampa.Activity.active()?.movie;
                if (!movie) {
                    console.log('[NSL] No movie found on destroy');
                    return;
                }
                
                const tmdbId = extractTmdbId(movie);
                if (!tmdbId) {
                    console.log('[NSL] No tmdbId found on destroy');
                    return;
                }
                
                console.log('[NSL] Syncing on destroy:', tmdbId, movie.title || movie.name);
                syncLampaTimelineToNSL(tmdbId, movie);
                syncTimelineWithCategories();
            }, 2000);
        });
        
        console.log('[NSL] Timeline listeners initialized');
    }
    // ====================== СТАТУС НА КАРТОЧКЕ ======================
    function getBestTimelineItem(tmdbId) {
        const timeline = getTimeline(), baseId = getBaseTmdbId(tmdbId);
        let bestKey = '', bestItem = null, bestEpisode = -1, bestTime = 0, bestUpdated = 0;
        const strategy = cfg().sync_strategy;
        
        for (const key in timeline) {
            if (getBaseTmdbId(timeline[key]?.tmdb_id) !== baseId) continue;
            const t = timeline[key], updated = t.updated || 0, time = t.time || 0;
            const isEpisode = key.includes('_s') && key.includes('_e');
            
            if (isEpisode) {
                const match = key.match(/_s(\d+)_e(\d+)/);
                const epNum = match ? parseInt(match[1]) * 1000 + parseInt(match[2]) : 0;
                if (epNum > bestEpisode) {
                    bestEpisode = epNum; bestTime = time; bestUpdated = updated; bestItem = t; bestKey = key;
                } else if (epNum === bestEpisode) {
                    let isBetter = (strategy === 'max_time') ? (time > bestTime) : (updated > bestUpdated);
                    if (isBetter) { bestTime = time; bestUpdated = updated; bestItem = t; bestKey = key; }
                }
            } else {
                let isBetter = (strategy === 'max_time') ? (time > bestTime) : (updated > bestUpdated);
                if (isBetter || bestEpisode === -1) { bestTime = time; bestUpdated = updated; bestItem = t; bestKey = key; }
            }
        }
        return { key: bestKey, item: bestItem, time: bestItem?.time || 0 };
    }
    
    function getSeriesInfoData(tmdbId) { const sc = getSeriesCheck(), cd = sc[getBaseTmdbId(tmdbId)]; return cd ? { totalSeasons: cd.seasons_count||0, totalEpisodesInSeason: cd.total_episodes||0, lastSeasonNumber: cd.last_season_number||0 } : { totalSeasons:0, totalEpisodesInSeason:0, lastSeasonNumber:0 }; }
    
    function getCategoryDisplay(category, tmdbId) {
        const base = CATEGORY_DISPLAYS[category]; 
        if (!base) return null;
        
        // Возвращаем только базовую информацию без сезонов/серий/времени
        return { 
            ...base, 
            displayText: base.text,  // Просто "Смотрю", "Просмотрено" и т.д.
            extraText: base.text,
            category 
        };
    }
    
    function getMovieStatus(movie) {
        const tmdbId = extractTmdbId(movie); if (!tmdbId) return null;
        const baseId = getBaseTmdbId(tmdbId), cats = getFavorites().filter(f => getBaseTmdbId(f.tmdb_id) === baseId).map(f => f.category);
        if (!cats.length) return null;
        let bestCat = null, bestP = 999;
        for (const cat of cats) { const p = STATUS_PRIORITY[cat]||999; if (p < bestP) { bestP = p; bestCat = cat; } }
        if (bestCat === 'collection' && cats.length > 1) { for (const cat of cats) { if (cat !== 'collection') { const p = STATUS_PRIORITY[cat]||999; if (p < bestP) { bestP = p; bestCat = cat; } } } }
        if (bestCat === 'favorite' && cats.length > 1) { for (const cat of cats) { if (cat !== 'favorite' && cat !== 'collection') return getCategoryDisplay(cat, tmdbId); } }
        return getCategoryDisplay(bestCat, tmdbId);
    }
    
    function renderStatusBadge(status) { return `<div class="full-start__status nsl-movie-status" ${STATUS_BADGE_STYLE} title="${status.extraText||status.text}"><span style="font-size:16px!important;line-height:1;">${status.icon}</span><span style="font-size:16px!important;line-height:1;">${status.displayText}</span></div>`; }
    
    function refreshCardUI() {
        const movie = Lampa.Activity.active()?.movie; if (!movie) return;
        $('.nsl-movie-status').remove(); const status = getMovieStatus(movie);
        if (status) { const container = $('.full-start__status').first(); if (container.length) container.after($(renderStatusBadge(status))); }
        const button = $('.nsl-favorite-button');
        if (button.length) { const baseId = getBaseTmdbId(extractTmdbId(movie)); button.find('path').attr('fill', getFavorites().some(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category !== 'collection') ? 'currentColor':'none'); }
    }
    
    function updateCardStatusElement(cardElement, cardData) {
        if (!cardElement || !cardData?.id || cfg().card_display_mode !== 'nsl_status') { const existing = cardElement.querySelector('.nsl-card-status'); if (existing) existing.remove(); return; }
        const tmdbId = extractTmdbId(cardData); if (!tmdbId) return;
        const best = getBestTimelineItem(tmdbId), fav = getFavorites().find(f => getBaseTmdbId(f.tmdb_id) === getBaseTmdbId(tmdbId));
        const status = fav ? getMovieStatus(cardData) : null, timelineItem = best.item;
        let existing = cardElement.querySelector('.nsl-card-status');
        if (!status && !timelineItem) { if (existing) existing.remove(); return; }
        if (!status) { if (existing) existing.remove(); return; }
        let iconHtml = `<span class="nsl-card-status__icon" style="color:${status.color}">${status.icon}</span>`, line1 = status.text, line2 = '';
        if (timelineItem && timelineItem.time > 0 && best.key) {
            const match = best.key.match(/_s(\d+)_e(\d+)/);
            if (match) {
                const si = getSeriesInfoData(tmdbId);
                const sStr = si.totalSeasons > 0 ? `Сезон ${match[1]} из ${si.totalSeasons}` : `Сезон ${match[1]}`;
                const eStr = si.totalEpisodesInSeason > 0 ? `Серия ${match[2]} из ${si.totalEpisodesInSeason}` : `Серия ${match[2]}`;
                line1 += `: ${sStr}`;
                line2 = `${eStr}; ${formatTimeShort(timelineItem.time) + (timelineItem.duration > 0 ? ` из ${formatTimeShort(timelineItem.duration)}` : '')}`;
            }
        }
        const contentHtml = iconHtml + `<span class="nsl-card-status__text"><span>${line1}</span><span>${line2}</span></span>`;
        if (existing) { existing.innerHTML = contentHtml; }
        else { const div = document.createElement('div'); div.className = 'nsl-card-status'; div.innerHTML = contentHtml; const viewEl = cardElement.querySelector('.card__view'); if (viewEl) viewEl.appendChild(div); else return; }
        const el = cardElement.querySelector('.nsl-card-status');
        if (el) { const pos = cfg().nsl_status_position||'bottom'; el.classList.remove('nsl-card-status--top','nsl-card-status--center','nsl-card-status--bottom'); el.classList.add(`nsl-card-status--${pos}`); }
    }
    
    function refreshAllCardStatuses() { document.querySelectorAll('.card').forEach(card => { const data = card._data||card.__data; if (data) updateCardStatusElement(card, data); }); }
    
    function refreshNewEpisodesBadge() {
        const badgeEl = $('.nsl-favorites-item .menu__text'); if (!badgeEl.length) return;
        badgeEl.find('.nsl-badge').remove(); const count = getNewEpisodesCount();
        if (count > 0) badgeEl.append(` <span class="nsl-badge" style="background:#f44336;color:#fff;border-radius:50%;padding:0 0.3em;font-size:0.8em;margin-left:0.5em;">🔔${count}</span>`);
    }

    // ====================== ОБРАБОТЧИК КАРТОЧКИ ======================
    function addFullCardHandler() {
        Lampa.Listener.follow('full', function(e) {
            if (e.type !== 'complite') return;
            setTimeout(() => {
                try {
                    const movie = e.data.movie || e.data.card;
                    if (!movie?.id || !e.object?.activity) return;
                    const render = e.object.activity.render();
                    const container = render.find('.full-start-new__buttons, .full-start__buttons').first();
                    const statusContainer = render.find('.full-start__status').first();
                    
                    if (statusContainer.length) {
                        render.find('.nsl-movie-status').remove();
                        const status = getMovieStatus(movie);
                        if (status) statusContainer.after($(renderStatusBadge(status)));
                    }
                    
                    if (container.length && !container.find('.nsl-favorite-button').length) {
                        const isFavorite = isInFavorites(movie, 'favorite');
                        const button = $(`<div class="full-start__button selector nsl-favorite-button" tabindex="0" role="button"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z"/></svg><span>В избранное</span></div>`);
                        button.on('hover:enter', () => {
                            const cats = FAVORITE_CATEGORIES.map(cat => ({ title: cat.name, checkbox: true, checked: isInFavorites(movie, cat.id), category: cat.id }));
                            cats.push({ title: '──────────', separator: true }, { title: '❌ Закрыть', action: 'close' });
                            Lampa.Select.show({
                                title: 'Добавить в избранное', items: cats,
                                onCheck: (item) => handleFavoriteToggle(movie, item, button),
                                onSelect: (item) => { if (item.action !== 'close') handleFavoriteToggle(movie, item, button); },
                                onBack: () => Lampa.Controller.toggle('content')
                            });
                        });
                        const bookBtn = container.find('.button--book').first();
                        if (bookBtn.length) bookBtn.before(button); else container.prepend(button);
                        if (cfg().hide_lampa_bookmark_button) container.find('.button--book').addClass('nsl-hidden-lampa-button');
                        if (isAndroid && Lampa.Controller) setTimeout(() => Lampa.Controller.collectionSet(container), 100);
                    }
                    
                    // ====================== СИНХРОНИЗАЦИЯ ТАЙМКОДОВ NSL → Lampa.Timeline ======================
                    const tmdbId = extractTmdbId(movie);
                    if (tmdbId) {
                        const timeline = getTimeline();
                        const baseId = getBaseTmdbId(tmdbId);
                        const card = movie;
                        
                        // Получаем лучший таймкод из NSL
                        const best = getBestTimelineItem(tmdbId);
                        
                        // ВАЖНО: Сначала сохраняем маппинг ВСЕХ NSL-ключей (независимо от time)
                        // Это гарантирует, что когда внешний плеер вернет время, мы найдем фильм по хешу
                        if (card.original_name) {
                            for (const nslKey in timeline) {
                                if (getBaseTmdbId(timeline[nslKey]?.tmdb_id) === baseId) {
                                    const epMatch = nslKey.match(/^(\d+)_s(\d+)_e(\d+)$/);
                                    if (epMatch) {
                                        const season = parseInt(epMatch[1]);
                                        const episode = parseInt(epMatch[2]);
                                        const hashString = [season, season > 10 ? ':' : '', episode, card.original_name].join('');
                                        const hash = Lampa.Utils.hash(hashString);
                                        hashToMovie[hash] = { tmdbId, movie: card };
                                    }
                                }
                            }
                        } else if (card.original_title) {
                            const hash = Lampa.Utils.hash(card.original_title);
                            hashToMovie[hash] = { tmdbId, movie: card };
                        }
                        
                        // Конвертируем все NSL-ключи этого фильма/сериала в хеши Lampa
                        // (только те, у которых есть time > 0)
                        for (const nslKey in timeline) {
                            if (getBaseTmdbId(timeline[nslKey]?.tmdb_id) !== baseId) continue;
                            if (!timeline[nslKey]?.time || timeline[nslKey].time <= 0) continue;
                            
                            let lampaHash = null;
                            
                            const episodeMatch = nslKey.match(/^\d+_s(\d+)_e(\d+)$/);
                            
                            if (episodeMatch && card.original_name) {
                                const season = parseInt(episodeMatch[1]);
                                const episode = parseInt(episodeMatch[2]);
                                const hashString = [season, season > 10 ? ':' : '', episode, card.original_name].join('');
                                lampaHash = Lampa.Utils.hash(hashString);
                            } else if (card.original_title) {
                                lampaHash = Lampa.Utils.hash(card.original_title);
                            } else if (card.original_name && !episodeMatch) {
                                const hashString = [1, 1 > 10 ? ':' : '', 1, card.original_name].join('');
                                lampaHash = Lampa.Utils.hash(hashString);
                            }
                            
                            if (lampaHash) {
                                writeTimelineToFileView(lampaHash, timeline[nslKey].time, 
                                    timeline[nslKey].duration || 0, 
                                    timeline[nslKey].percent || 0);
                                
                                console.log('[NSL] Synced NSL key:', nslKey, '→ Lampa hash:', lampaHash, 
                                    'time:', timeline[nslKey].time, 'percent:', timeline[nslKey].percent + '%');
                            }
                        }
                        
                        // Отдельно синхронизируем лучший таймкод
                        if (best.key && best.time > 0) {
                            const bestEpisodeMatch = best.key.match(/^\d+_s(\d+)_e(\d+)$/);
                            let bestLampaHash = null;
                            
                            if (bestEpisodeMatch && card.original_name) {
                                const season = parseInt(bestEpisodeMatch[1]);
                                const episode = parseInt(bestEpisodeMatch[2]);
                                const hashString = [season, season > 10 ? ':' : '', episode, card.original_name].join('');
                                bestLampaHash = Lampa.Utils.hash(hashString);
                            } else if (card.original_title) {
                                bestLampaHash = Lampa.Utils.hash(card.original_title);
                            }
                            
                            if (bestLampaHash) {
                                writeTimelineToFileView(bestLampaHash, best.time, 
                                    best.item?.duration || 0, 
                                    best.item?.percent || 0);
                                
                                console.log('[NSL] Best timeline synced:', best.key, '→', bestLampaHash, 
                                    'time:', best.time, 'percent:', best.item?.percent + '%');
                            }
                        }
                        
                        console.log('[NSL] Hash mapping updated for tmdbId:', tmdbId);
                    }
                } catch (err) { 
                    console.error('[NSL] Error in full handler:', err.message, err.stack); 
                }
            }, 500);
        });
    }
    
    function handleFavoriteToggle(movie, item, button) { setTimeout(() => { toggleFavorite(movie, item.category); button.find('path').attr('fill', isInFavorites(movie, 'favorite')?'currentColor':'none'); refreshCardUI(); }, 50); }

     // ====================== МЕНЮ ======================
    function addFavoritesToMenu() {
        const ml = $('.menu__list').eq(0); if (!ml.length || $('.nsl-favorites-item').length) return;
        const count = getNewEpisodesCount(), badge = count > 0 ? ` <span class="nsl-badge" style="background:#f44336;color:#fff;border-radius:50%;padding:0 0.3em;font-size:0.8em;margin-left:0.5em;">🔔${count}</span>` : '';
        const el = $(`<li class="menu__item selector nsl-favorites-item"><div class="menu__ico"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" stroke="currentColor" stroke-width="1" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg></div><div class="menu__text">Избpаннoe${badge}</div></li>`);
        el.on('hover:enter', (e) => { e.stopPropagation(); showFavoritesMenu(); }); ml.append(el);
    }
    
    function showFavoritesMenu() { 
        const movie = Lampa.Activity.active()?.movie || Lampa.Activity.active()?.card;
        let movieInfo = null;
        
        if (movie?.id) {
            const tmdbId = extractTmdbId(movie);
            if (tmdbId) {
                const status = getMovieStatus(movie);
                const bestTimeline = getBestTimelineItem(tmdbId);
                
                if (status || (bestTimeline.time > 0)) {
                    let lines = [];
                    
                    if (status) {
                        lines.push(`${status.icon} ${status.text}`);
                    }
                    
                    if (bestTimeline.time > 0 && bestTimeline.key) {
                        const match = bestTimeline.key.match(/_s(\d+)_e(\d+)/);
                        if (match) {
                            const si = getSeriesInfoData(tmdbId);
                            const sStr = `Сезон ${match[1]}${si.totalSeasons > 0 ? ` из ${si.totalSeasons}` : ''}`;
                            const eStr = `Серия ${match[2]}${si.totalEpisodesInSeason > 0 ? ` из ${si.totalEpisodesInSeason}` : ''}`;
                            const timeStr = formatTime(bestTimeline.time);
                            const durStr = bestTimeline.item?.duration > 0 ? ` из ${formatTime(bestTimeline.item.duration)}` : '';
                            
                            lines.push(sStr);
                            lines.push(eStr);
                            lines.push(`${timeStr}${durStr} (${bestTimeline.item?.percent || 0}%)`);
                        } else if (bestTimeline.time > 0) {
                            const timeStr = formatTime(bestTimeline.time);
                            lines.push(`${timeStr} (${bestTimeline.item?.percent || 0}%)`);
                        }
                    }
                    
                    if (lines.length > 0) {
                        movieInfo = {
                            title: lines.join(' · '),
                            separator: true,
                            style: `color:${status?.color || '#fff'};font-size:1.1em;padding:1em 1.5em;pointer-events:none;`
                        };
                    }
                }
            }
        }
        
        const items = [
            { title: '📋 Мои списки', onSelect: () => showMyLists() }, 
            { title: '🔧 Инструменты', onSelect: () => showTools() }, 
            { title: '──────────', separator: true }
        ];
        
        // Добавляем информацию о фильме перед кнопками
        if (movieInfo) {
            items.unshift(movieInfo);
        }
        
        items.push(
            { title: '🗑️ Очистить всё', onSelect: () => clearAllFavorites() }, 
            { title: '❌ Закрыть', onSelect: () => Lampa.Controller.toggle('content') }
        );
        
        Lampa.Select.show({ 
            title: '⭐ Избранное+', 
            items, 
            onBack: () => Lampa.Controller.toggle('content') 
        }); 
    }
    
    function showMyLists() {
        const newCount = getNewEpisodesCount(), unfinishedCount = getUnfinishedCount();
        const items = FAVORITE_CATEGORIES.map(cat => ({ title: `${cat.icon} ${cat.name} (${getFavoritesByCategory(cat.id).length})${cat.id==='watching'&&unfinishedCount>0?' 🔄':''}`, onSelect: () => showFavoritesByCategory(cat.id) }));
        if (newCount > 0) { items.push({ title: '──────────', separator: true }, { title: `🔔 Новые серии (${newCount})`, onSelect: () => showNewEpisodes() }); }
        items.push({ title: '──────────', separator: true }, { title: '◀ Назад', onSelect: () => showFavoritesMenu() }, { title: '❌ Закрыть', onSelect: () => Lampa.Controller.toggle('content') });
        Lampa.Select.show({ title: `📋 Мои списки${newCount>0?` 🔔${newCount}`:''}`, items, onBack: () => showFavoritesMenu() });
    }
    
    function getUnfinishedCount() { const now = Date.now(), timeline = getTimeline(); return getFavorites().filter(f => { if (f.category!=='watching'||now-(f.updated||f.added)<604800000) return false; let maxP=0; const baseId=getBaseTmdbId(f.tmdb_id); for (const key in timeline) { if (getBaseTmdbId(timeline[key]?.tmdb_id)===baseId) maxP=Math.max(maxP,timeline[key].percent||0); } return maxP>=20&&maxP<=80; }).length; }
    
    function showTools() { Lampa.Select.show({ title: '🔧 Инструменты', items: [{ title: '▶ Продолжить просмотр', onSelect: ()=>continueLastWatching() }, { title: '🎲 Случайный фильм', onSelect: ()=>showRandomMovie() }, { title: '🔍 Поиск по избранному', onSelect: ()=>searchFavorites() }, { title: '📊 Статистика просмотров', onSelect: ()=>showWatchStats() }, { title: '🕐 История просмотров', onSelect: ()=>showHistory() }, { title: '──────────', separator: true }, { title: '◀ Назад', onSelect: ()=>showFavoritesMenu() }, { title: '❌ Закрыть', onSelect: ()=>Lampa.Controller.toggle('content') }], onBack: ()=>showFavoritesMenu() }); }
    
    function showRandomMovie() { const pool = getFavorites().filter(f => f.category==='planned'||f.category==='favorite'); if (!pool.length) { notify('Добавьте фильмы в «Буду смотреть» или «Избранное»'); return; } const random = pool[Math.floor(Math.random()*pool.length)]; pushActivity(random); notify(`🎲 "${random.data?.title||random.data?.name}"`); }
    
    function showFavoritesByCategory(category) {
        const items = getFavoritesByCategory(category); if (!items.length) { notify(`В "${getCategoryName(category)}" ничего нет`); return; }
        const catName = getCategoryName(category), grouped = {}, menuItems = [];
        for (const type in MEDIA_TYPES) grouped[type] = items.filter(i => i.media_type === type);
        menuItems.push({ title: '📋 Сортировка: по названию', onSelect: ()=>showSortedFavoritesList(items, `${catName} (по названию)`, category, 'title') });
        menuItems.push({ title: '📋 Сортировка: по дате добавления', onSelect: ()=>showSortedFavoritesList(items, `${catName} (по дате)`, category, 'added') });
        menuItems.push({ title: '📋 Сортировка: по дате выхода', onSelect: ()=>showSortedFavoritesList(items, `${catName} (по году)`, category, 'year') });
        menuItems.push({ title: '──────────', separator: true });
        for (const [type, typeItems] of Object.entries(grouped)) { if (typeItems.length>0) { const ti=MEDIA_TYPES[type]; menuItems.push({ title: `${ti.icon} ${ti.name} (${typeItems.length})`, onSelect: ()=>showFavoritesList(typeItems, `${catName} - ${ti.name}`, category) }); } }
        menuItems.push({ title: '──────────', separator: true }, { title: '◀ Назад', onSelect: ()=>showFavoritesMenu() }, { title: '❌ Закрыть', onSelect: ()=>Lampa.Controller.toggle('content') });
        Lampa.Select.show({ title: catName, items: menuItems, onBack: ()=>showFavoritesMenu() });
    }
    
    function showSortedFavoritesList(items, title, category, sortMode) {
        let sorted = [...items];
        if (sortMode === 'added') {
            sorted.sort((a, b) => (b.added || 0) - (a.added || 0));
        } else if (sortMode === 'year') {
            sorted.sort((a, b) => {
                const yearA = a.data?.release_date || a.data?.first_air_date || '0000';
                const yearB = b.data?.release_date || b.data?.first_air_date || '0000';
                return yearB.localeCompare(yearA);
            });
        } else {
            sorted.sort((a, b) => {
                const titleA = (a.data?.title || a.data?.name || '').toLowerCase();
                const titleB = (b.data?.title || b.data?.name || '').toLowerCase();
                return titleA.localeCompare(titleB);
            });
        }
        showFavoritesList(sorted, title, category);
    }
    
    function showFavoritesList(items, title, currentCategory) {
        const timeline = getTimeline();
        
        // Сохраняем данные отдельно для кастомного рендеринга
        const menuItemsData = items.map(item => {
            const cd = item.data || {};
            const baseId = getBaseTmdbId(item.tmdb_id);
            const bestItem = getBestTimelineItem(item.tmdb_id);
            
            let seasonText = '';
            let episodeText = '';
            let timeText = '';
            let seriesInfoText = '';
            
            // Получаем информацию о сериале
            if (isSeries(cd)) {
                const checkData = getSeriesCheck()[baseId];
                if (checkData?.seasons_count > 0) {
                    seriesInfoText = `${checkData.seasons_count} сез.`;
                    if (checkData.total_episodes > 0) {
                        seriesInfoText += ` · ${checkData.total_episodes} сер.`;
                    }
                } else if (cd.number_of_seasons) {
                    seriesInfoText = `${cd.number_of_seasons} сез.`;
                }
            }
            
            // Для категории watching - детальная информация
            if (item.category === 'watching' && bestItem.key && bestItem.time > 0) {
                const match = bestItem.key.match(/_s(\d+)_e(\d+)/);
                if (match) {
                    const si = getSeriesInfoData(item.tmdb_id);
                    const seasonNum = parseInt(match[1]);
                    const episodeNum = parseInt(match[2]);
                    
                    seasonText = `📺 Сезон ${seasonNum}${si.totalSeasons > 0 ? ` из ${si.totalSeasons}` : ''}`;
                    episodeText = `🎬 Серия ${episodeNum}${si.totalEpisodesInSeason > 0 ? ` из ${si.totalEpisodesInSeason}` : ''}`;
                    
                    if (bestItem.item?.duration > 0) {
                        timeText = `⏱️ ${formatTime(bestItem.time)} из ${formatTime(bestItem.item.duration)}`;
                    } else if (bestItem.item?.percent > 0) {
                        timeText = `📊 ${bestItem.item.percent}%`;
                    }
                } else if (bestItem.time > 0) {
                    if (bestItem.item?.duration > 0) {
                        timeText = `⏱️ ${formatTime(bestItem.time)} из ${formatTime(bestItem.item.duration)}`;
                    } else if (bestItem.item?.percent > 0) {
                        timeText = `📊 ${bestItem.item.percent}%`;
                    }
                }
            }
            // Для остальных категорий
            else if (item.category === 'watched') {
                seriesInfoText = seriesInfoText ? `✅ Просмотрено · ${seriesInfoText}` : '✅ Просмотрено';
            } else if (item.category === 'abandoned') {
                seriesInfoText = seriesInfoText ? `❌ Брошено · ${seriesInfoText}` : '❌ Брошено';
            } else if (item.category === 'planned' && seriesInfoText) {
                seriesInfoText = `📋 ${seriesInfoText}`;
            } else if (item.category === 'favorite' && seriesInfoText) {
                seriesInfoText = `⭐ ${seriesInfoText}`;
            } else if (item.category === 'collection' && seriesInfoText) {
                seriesInfoText = `📦 ${seriesInfoText}`;
            }
            
            // Определяем высоту постера в зависимости от количества строк
            let linesCount = 1; // Название
            if (item.category === 'watching') {
                if (seasonText) linesCount++;
                if (episodeText) linesCount++;
                if (timeText) linesCount++;
            } else if (seriesInfoText) {
                linesCount++;
            }
            
            // Высота строки ~1.3em, плюс отступы
            const posterHeight = Math.max(4, linesCount * 1.3 + 0.5); // em
            
            const posterUrl = getPosterUrl(cd);
            const year = extractYear(cd);
            const itemTitle = cd.title || cd.name || 'Без названия';
            const yearStr = year ? ` (${year})` : '';
            
            return {
                item,
                posterUrl,
                posterHeight,
                itemTitle,
                yearStr,
                seriesInfoText,
                seasonText,
                episodeText,
                timeText,
                category: item.category
            };
        });
        
        // Создаем элементы для Select
        const menuItems = menuItemsData.map(data => ({
            title: '', // Пустой, будем использовать onFullDraw
            data: data,
            onSelect: () => openItem(data.item),
            onLongPress: null
        }));
        
        menuItems.push(
            { title: '──────────', separator: true },
            { title: '◀ Назад', onSelect: () => showFavoritesByCategory(currentCategory) },
            { title: '❌ Закрыть', onSelect: () => Lampa.Controller.toggle('content') }
        );
        
        Lampa.Select.show({
            title: title,
            items: menuItems,
            onBack: () => showFavoritesByCategory(currentCategory),
            onFullDraw: (scroll) => {
                const itemsElements = scroll.render().find('.selectbox-item');
                
                itemsElements.each((index, element) => {
                    const data = menuItemsData[index];
                    if (!data) return;
                    
                    const $el = $(element);
                    const posterHeightEm = data.posterHeight;
                    
                    // Строим HTML для элемента с динамической высотой постера
                    let html = `<div style="display:flex;align-items:flex-start;gap:0.8em;min-height:${posterHeightEm}em;padding:0.4em 0;">`;
                    
                    // Постер - теперь динамической высоты
                    if (data.posterUrl) {
                        html += `<img src="${data.posterUrl}" style="width:auto;height:${posterHeightEm}em;border-radius:0.4em;flex-shrink:0;object-fit:cover;" onerror="this.style.display='none'">`;
                    } else {
                        const iconSize = Math.min(3, posterHeightEm - 0.5);
                        html += `<div style="width:auto;height:${posterHeightEm}em;aspect-ratio:2/3;background:linear-gradient(135deg,#2a2a2a,#1a1a1a);border-radius:0.4em;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:${iconSize}em;">🎬</div>`;
                    }
                    
                    html += '<div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:0.2em;">';
                    html += `<div style="font-size:1em;line-height:1.3;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${data.itemTitle}${data.yearStr}</div>`;
                    
                    // Для категории watching - многострочный статус
                    if (data.category === 'watching' && (data.seasonText || data.episodeText || data.timeText)) {
                        if (data.seasonText) {
                            html += `<div style="font-size:0.85em;opacity:0.9;line-height:1.3;">${data.seasonText}</div>`;
                        }
                        if (data.episodeText) {
                            html += `<div style="font-size:0.85em;opacity:0.9;line-height:1.3;">${data.episodeText}</div>`;
                        }
                        if (data.timeText) {
                            html += `<div style="font-size:0.85em;opacity:0.7;line-height:1.3;">${data.timeText}</div>`;
                        }
                    }
                    // Для остальных категорий
                    else if (data.seriesInfoText) {
                        html += `<div style="font-size:0.85em;opacity:0.8;line-height:1.3;">${data.seriesInfoText}</div>`;
                    }
                    
                    html += '</div></div>';
                    
                    $el.html(html);
                    $el.css({
                        'min-height': `${posterHeightEm}em`,
                        'display': 'flex',
                        'align-items': 'center'
                    });
                    
                    // Long press для дополнительных действий
                    $el.off('hover:long').on('hover:long', (e) => {
                        e.stopPropagation();
                        const item = data.item;
                        Lampa.Select.show({
                            title: `Действия с "${data.itemTitle}"`,
                            items: [
                                { title: '📋 Переместить в...', action: 'move' },
                                { title: '🗑️ Удалить из категории', action: 'remove' },
                                { title: '💥 Удалить из Избранное+', action: 'delete_all' },
                                { title: '❌ Отмена', action: 'cancel' }
                            ],
                            onSelect: (opt) => {
                                if (opt.action === 'move') showMoveMenu(item);
                                else if (opt.action === 'remove') {
                                    removeFromFavorites(item.data, item.category);
                                    showFavoritesByCategory(currentCategory);
                                }
                                else if (opt.action === 'delete_all') {
                                    confirmDialog('⚠️ Удалить полностью?', [
                                        { title: '✅ Да, удалить всё', action: 'confirm' },
                                        { title: '❌ Отмена', action: 'cancel' }
                                    ], (opt2) => {
                                        if (opt2.action === 'confirm') {
                                            deleteCompletely(item);
                                            showFavoritesByCategory(currentCategory);
                                        }
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
        const cats = FAVORITE_CATEGORIES.filter(c => c.id !== item.category).map(cat => ({
            title: `${cat.icon} ${cat.name}`,
            category: cat.id,
            onSelect: () => {
                const favorites = getFavorites();
                const baseId = getBaseTmdbId(item.tmdb_id);
                const target = favorites.find(f => getBaseTmdbId(f.tmdb_id) === baseId && f.category === item.category);
                if (target) {
                    const oldCat = target.category;
                    target.category = cat.id;
                    target.updated = Date.now();
                    applyCategoryRules(item.tmdb_id, cat.id, favorites);
                    saveFavorites(favorites);
                    logMove('move', target.data?.title || target.data?.name || 'Без названия', oldCat, cat.id);
                    notify(`📦 "${target.data?.title || target.data?.name}" → ${cat.name}`);
                    if (cfg().gist_token && cfg().gist_id) syncToGist('favorites', false);
                }
            }
        }));
        cats.push({ title: '❌ Отмена', action: 'cancel' });
        Lampa.Select.show({
            title: `Переместить "${item.data?.title || item.data?.name || 'Без названия'}"`,
            items: cats,
            onBack: () => Lampa.Controller.toggle('content')
        });
    }
    
    function continueLastWatching() { const timeline=getTimeline(); let bestItem=null, bestTime=0; getFavorites().filter(f=>f.category==='watching').forEach(f=>{ const baseId=getBaseTmdbId(f.tmdb_id); for (const key in timeline){ if (getBaseTmdbId(timeline[key]?.tmdb_id)===baseId){ const t=timeline[key]; if ((t.updated||0)>bestTime&&(t.percent||0)>=5&&(t.percent||0)<=95){ bestTime=t.updated||0; bestItem=f; } } } }); if (!bestItem){ notify('Нет фильмов для продолжения просмотра'); return; } pushActivity(bestItem); notify(`▶ ${bestItem.data?.title||bestItem.data?.name||'Без названия'}`); }
    
    function searchFavorites() { Lampa.Input.edit({ title:'Поиск по избранному',value:'',free:true },(query)=>{ if (!query?.trim()){ notify('Введите название для поиска'); return; } const q=query.toLowerCase().trim(), allItems=getFavorites().filter(item=>(item.data?.title||item.data?.name||'').toLowerCase().includes(q)); if (!allItems.length){ notify('Ничего не найдено'); return; } const menuItems=allItems.map(item=>{ const cd=item.data||{}, ri=renderCardItemHTML(cd,item,{ sub:(isSeries(cd)?(getSeriesCheck()[getBaseTmdbId(item.tmdb_id)]?.seasons_count?`${getSeriesCheck()[getBaseTmdbId(item.tmdb_id)].seasons_count} сез.`:'')+` · ${getCategoryName(item.category)}`:`${getCategoryName(item.category)}`) }); return { title:ri.html, item, onSelect:()=>pushActivity(item) }; }); menuItems.push({ title:'❌ Закрыть',onSelect:()=>Lampa.Controller.toggle('content') }); Lampa.Select.show({ title:`🔍 Найдено: ${allItems.length}`, items:menuItems, onBack:()=>Lampa.Controller.toggle('content') }); },()=>{}); }

    // ====================== НОВЫЕ СЕРИИ ======================
    function getNewEpisodesCount() { if (!cfg().check_new_episodes) return 0; let count=0; const sc=getSeriesCheck(); for (const key in sc){ if (sc[key].has_new) count++; } return count; }
    function getNewEpisodesList() { if (!cfg().check_new_episodes) return[]; const sc=getSeriesCheck(), favs=getFavorites(), result=[]; for (const key in sc){ if (sc[key].has_new){ const item=favs.find(f=>getBaseTmdbId(f.tmdb_id)===key); if (item) result.push({...item, old_seasons:sc[key].old_seasons, new_seasons:sc[key].new_seasons, total_episodes:sc[key].total_episodes||0, aired_episodes:sc[key].aired_episodes||0, last_season_number:sc[key].last_season_number||0, last_check:sc[key].checked_at}); } } return result; }
    function markNewEpisodesSeen(tmdbId) { const sc=getSeriesCheck(), baseId=getBaseTmdbId(tmdbId); for (const key in sc){ if (key===baseId||getBaseTmdbId(key)===baseId){ sc[key].has_new=false; sc[key].seen_at=Date.now(); } } saveSeriesCheck(sc); refreshNewEpisodesBadge(); }
    function clearAllNewEpisodes() { const sc=getSeriesCheck(); for (const key in sc){ sc[key].has_new=false; sc[key].seen_at=Date.now(); } saveSeriesCheck(sc); refreshNewEpisodesBadge(); }
    function showNewEpisodes() { const newEpisodes=getNewEpisodesList(); if (!newEpisodes.length){ notify('Новых серий нет'); return; } const menuItems=newEpisodes.map(item=>{ const cd=item.data||{}; let episodeInfo=''; if (item.aired_episodes>0&&item.total_episodes>0) episodeInfo=`${item.aired_episodes} из ${item.total_episodes} серий`; else if (item.new_seasons) episodeInfo=`S${item.new_seasons}`; const newInfo=item.old_seasons&&item.new_seasons>item.old_seasons?` +${item.new_seasons-item.old_seasons} сезон`:' 🔔', ri=renderCardItemHTML(cd,item,{ sub:`${newInfo}${episodeInfo?' · '+episodeInfo:''}`, multiLine:true }); return { title:ri.html, item, onSelect:()=>{ openItem(item); markNewEpisodesSeen(item.tmdb_id); } }; }); menuItems.push({ title:'──────────',separator:true },{ title:'✅ Отметить всё просмотренным',onSelect:()=>confirmDialog('⚠️ Отметить все новые серии просмотренными?',[{ title:'✅ Да',action:'confirm'},{ title:'❌ Отмена',action:'cancel'}],(opt)=>{ if (opt.action==='confirm'){ clearAllNewEpisodes(); notify('✅ Все новые серии отмечены'); } }) },{ title:'◀ Назад',onSelect:()=>showFavoritesMenu()},{ title:'❌ Закрыть',onSelect:()=>Lampa.Controller.toggle('content')}); Lampa.Select.show({ title:'🔔 Новые серии', items:menuItems, onBack:()=>showFavoritesMenu()}); }
    function checkNewEpisodes(showNotifyFlag=false) { const c=cfg(); if (!c.check_new_episodes) return; const favorites=getFavorites(), sc=getSeriesCheck(), now=Date.now(), interval=(c.new_episodes_check_interval||24)*3600000; const toCheck=favorites.filter(f=>(f.category==='watching'||f.category==='planned')&&isSeries(f.data||{})); if (!toCheck.length){ if (showNotifyFlag) notify('Нет сериалов для проверки'); return; } let checkCount=0, newFound=0, completed=0; const checkFinal=()=>{ if (completed>=toCheck.length&&showNotifyFlag) notify(checkCount>0&&newFound>0?`🔔 Найдено новых серий: ${newFound}`:'✅ Новых серий нет'); }; toCheck.forEach(item=>{ const baseId=getBaseTmdbId(item.tmdb_id); if (!baseId) return; if (now-(sc[baseId]?.checked_at||0)<interval&&!sc[baseId]?.error){ if (sc[baseId]?.has_new) newFound++; completed++; checkFinal(); return; } checkCount++; try{ if (typeof Lampa.TMDB!=='undefined'&&Lampa.TMDB.api){ $.ajax({ url:Lampa.TMDB.api('tv/'+baseId+'?api_key='+Lampa.TMDB.key()), method:'GET', timeout:10000, success:(data)=>{ completed++; const newSeasons=data.number_of_seasons||0, oldSeasons=sc[baseId]?.seasons_count||item.data?.number_of_seasons||0, hasNew=newSeasons>oldSeasons&&oldSeasons>0, lastSeason=data.seasons?.[data.seasons.length-1], totalEp=lastSeason?.episode_count||0, airedEp=lastSeason?countAiredEpisodes(lastSeason):0; sc[baseId]={ checked_at:now, seasons_count:newSeasons, old_seasons:oldSeasons, new_seasons:newSeasons, has_new:hasNew, last_air_date:data.last_air_date||'', title:data.name||item.data?.title||item.data?.name||'', total_episodes:totalEp, aired_episodes:airedEp, last_season_number:lastSeason?.season_number||0, error:false }; if (newSeasons!==item.data?.number_of_seasons){ item.data.number_of_seasons=newSeasons; item.data.number_of_episodes=data.number_of_episodes; item.data.last_air_date=data.last_air_date; item.updated=now; saveFavorites(favorites); } if (hasNew){ newFound++; if (c.new_episodes_notify&&showNotifyFlag) notify(`🔔 Новый сезон: "${data.name||item.data?.title||item.data?.name}" S${newSeasons}${airedEp>0?` (${airedEp} из ${totalEp} серий)`:''}`); } saveSeriesCheck(sc); refreshNewEpisodesBadge(); checkFinal(); }, error:()=>{ completed++; sc[baseId]={ checked_at:now, seasons_count:item.data?.number_of_seasons||0, old_seasons:item.data?.number_of_seasons||0, new_seasons:item.data?.number_of_seasons||0, has_new:false, last_air_date:item.data?.last_air_date||'', title:item.data?.title||item.data?.name||'', total_episodes:sc[baseId]?.total_episodes||0, aired_episodes:sc[baseId]?.aired_episodes||0, last_season_number:sc[baseId]?.last_season_number||0, error:true }; saveSeriesCheck(sc); checkFinal(); } }); } else { completed++; checkFinal(); } } catch(e){ completed++; console.error('[NSL] Error checking episodes:',e); } }); }
    function checkUpcomingEpisodes() { const c=cfg(); if (!c.check_new_episodes||!c.new_episodes_notify) return; const sc=getSeriesCheck(), favs=getFavorites(), now=new Date(), today=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime(), upcoming=[]; for (const key in sc){ if (!sc[key].last_air_date) continue; try{ const airTime=new Date(new Date(sc[key].last_air_date).getFullYear(),new Date(sc[key].last_air_date).getMonth(),new Date(sc[key].last_air_date).getDate()).getTime(); if (airTime>=today&&airTime<today+86400000){ const item=favs.find(f=>getBaseTmdbId(f.tmdb_id)===key); if (item&&(item.category==='watching'||item.category==='planned')) upcoming.push({ title:sc[key].title||item.data?.title||item.data?.name||'Без названия', date:sc[key].last_air_date, hasNew:sc[key].has_new }); } } catch(e){} } if (upcoming.length>0){ const todayList=upcoming.filter(u=>new Date(u.date).toDateString()===now.toDateString()), tomorrowList=upcoming.filter(u=>new Date(u.date).toDateString()===new Date(now.getTime()+86400000).toDateString()); if (todayList.length>0) notify(`📅 Премьера сегодня: ${todayList.slice(0,3).map(u=>(u.hasNew?'🔔 ':'')+'"'+u.title+'"').join(', ')}${todayList.length>3?' и ещё '+(todayList.length-3):''}`); if (tomorrowList.length>0) setTimeout(()=>notify(`📅 Завтра: ${tomorrowList.slice(0,3).map(u=>(u.hasNew?'🔔 ':'')+'"'+u.title+'"').join(', ')}${tomorrowList.length>3?' и ещё '+(tomorrowList.length-3):''}`),3000); } }
    function countAiredEpisodes(season) { if (!season?.episodes) return 0; const now=new Date(); return season.episodes.filter(ep=>ep.air_date&&new Date(ep.air_date)<=now).length; }
    function startSeriesCheckTimer() { if (!cfg().check_new_episodes) return; if (seriesCheckTimer) clearInterval(seriesCheckTimer); setTimeout(()=>checkNewEpisodes(true),30000); seriesCheckTimer=setInterval(()=>checkNewEpisodes(false),3600000); }
    function loadSeriesDataQuick(tmdbId, callback) { const baseId=getBaseTmdbId(tmdbId), sc=getSeriesCheck(), now=Date.now(); if (sc[baseId]&&(now-sc[baseId].checked_at<3600000)){ callback(sc[baseId]); return; } try{ if (typeof Lampa.TMDB!=='undefined'&&Lampa.TMDB.api){ $.ajax({ url:Lampa.TMDB.api('tv/'+baseId+'?api_key='+Lampa.TMDB.key()), method:'GET', timeout:5000, success:(data)=>{ const seasonsCount=data.number_of_seasons||0, lastSeason=data.seasons?.[data.seasons.length-1], checkData={ checked_at:now, seasons_count:seasonsCount, old_seasons:sc[baseId]?.old_seasons||seasonsCount, new_seasons:seasonsCount, has_new:sc[baseId]?.has_new||false, last_air_date:data.last_air_date||'', title:data.name||'', total_episodes:lastSeason?.episode_count||0, aired_episodes:lastSeason?countAiredEpisodes(lastSeason):0, last_season_number:data.last_episode_to_air?.season_number||lastSeason?.season_number||0 }; sc[baseId]=checkData; saveSeriesCheck(sc); const item=getFavorites().find(f=>getBaseTmdbId(f.tmdb_id)===baseId); if (item){ item.data.number_of_seasons=seasonsCount; item.data.number_of_episodes=data.number_of_episodes; item.data.last_air_date=data.last_air_date; } callback(checkData); }, error:()=>{ const item=getFavorites().find(f=>getBaseTmdbId(f.tmdb_id)===baseId), cd=item?.data||{}, fb={ checked_at:now, seasons_count:cd.number_of_seasons||0, total_episodes:0, aired_episodes:0, last_season_number:0, error:true }; sc[baseId]=fb; saveSeriesCheck(sc); callback(fb); } }); } else callback(null); } catch(e){ callback(null); } }
    function formatSeriesInfo(checkData, cardData) { if (!checkData||checkData.error) return cardData?.number_of_seasons?`${cardData.number_of_seasons} сез.`:''; const parts=[]; if (checkData.seasons_count>0) parts.push(`${checkData.seasons_count} сез.`); if (checkData.total_episodes>0) parts.push(checkData.aired_episodes>0?`${checkData.aired_episodes} из ${checkData.total_episodes} сер.`:`${checkData.total_episodes} сер.`); return parts.join(' · '); }

    // ====================== ИСТОРИЯ ======================
    function addToHistory(card) { if (!card?.id) return; const history=getHistory(), existingIndex=history.findIndex(h=>h.id===card.id); if (existingIndex>=0) history.splice(existingIndex,1); history.unshift({ id:card.id, tmdb_id:extractTmdbId(card), media_type:getMediaType(card), data:cleanCardData(card), time:Date.now() }); if (history.length>50) history.length=50; saveHistory(history); if (cfg().gist_token&&cfg().gist_id) syncToGist('history',false); }
    function showHistory() { const history=getHistory(); if (!history.length){ notify('История пуста'); return; } const menuItems=history.map(item=>{ const cd=item.data||{}, ri=renderCardItemHTML(cd,item,{ sub:getTimeAgo(item.time) }); return { title:ri.html, item, onSelect:()=>openItem(item) }; }); menuItems.push({ title:'──────────',separator:true },{ title:'🗑️ Очистить историю',onSelect:()=>confirmDialog('⚠️ Очистить историю просмотров?',[{ title:'✅ Да, очистить',action:'confirm'},{ title:'❌ Отмена',action:'cancel'}],(opt)=>{ if (opt.action==='confirm'){ saveHistory([]); notify('История очищена'); if (cfg().gist_token&&cfg().gist_id) syncToGist('history',false); } }) },{ title:'◀ Назад',onSelect:()=>showFavoritesMenu()},{ title:'❌ Закрыть',onSelect:()=>Lampa.Controller.toggle('content')}); Lampa.Select.show({ title:'🕐 История просмотров', items:menuItems, onBack:()=>showFavoritesMenu()}); }

    // ====================== GIST СИНХРОНИЗАЦИЯ ======================
    function getGistData() { const c=cfg(); return (c.gist_token&&c.gist_id)?{ token:c.gist_token, id:c.gist_id }:null; }
    function syncToGist(type, showNotify) { const gist=getGistData(); if (!gist){ if (showNotify) notify('⚠️ GitHub Gist не настроен'); return; } let fileName, data, flag; if (type==='favorites'){ if (syncFlags.fav) return; const fav=getFavorites(); if (fav.length===0) return; syncFlags.fav=true; flag=()=>syncFlags.fav=false; fileName='nsl_favorites.json'; data={ version:5, profile_id:PROFILE_ID, updated:new Date().toISOString(), bookmarks:getBookmarks(), favorites:fav }; } else if (type==='timeline'){ if (syncFlags.time) return; const tl=getTimeline(); if (Object.keys(tl).length===0) return; syncFlags.time=true; flag=()=>syncFlags.time=false; fileName='nsl_timeline.json'; data={ version:5, profile_id:PROFILE_ID, updated:new Date().toISOString(), timeline:tl }; } else if (type==='bookmarks'){ if (syncFlags.book) return; const bm=getBookmarks(); if (bm.length===0) return; syncFlags.book=true; flag=()=>syncFlags.book=false; fileName='nsl_bookmarks.json'; data={ version:5, profile_id:PROFILE_ID, updated:new Date().toISOString(), bookmarks:bm }; } else if (type==='history'){ if (syncFlags.his) return; const his=getHistory(); if (his.length===0) return; syncFlags.his=true; flag=()=>syncFlags.his=false; fileName='nsl_history.json'; data={ version:5, profile_id:PROFILE_ID, updated:new Date().toISOString(), history:his }; } else return;
        $.ajax({ url:`https://api.github.com/gists/${gist.id}`, method:'PATCH', headers:{ 'Authorization':`token ${gist.token}`,'Accept':'application/vnd.github.v3+json','Content-Type':'application/json' }, data:JSON.stringify({ description:'NSL Sync Data', public:false, files:{[fileName]:{ content:JSON.stringify(data) }} }), success:()=>{ Lampa.Storage.set(GIST_CACHE+'_last_sync',Date.now()); flag(); }, error:()=>{ flag(); }, timeout:15000, crossDomain:true }); }
    function syncFromGist(showNotify) { const gist=getGistData(); if (!gist){ if (showNotify) notify('⚠️ GitHub Gist не настроен'); return; } syncingFromGist=true; $.ajax({ url:`https://api.github.com/gists/${gist.id}`, method:'GET', dataType:'json', headers:{ 'Authorization':`token ${gist.token}`,'Accept':'application/vnd.github.v3+json' }, crossDomain:true, timeout:20000, success:(data)=>{ try{ let changed=false; const favContent=data.files['nsl_favorites.json']?.content; if (favContent){ const favData=JSON.parse(favContent); if (favData.favorites){ saveFavorites(favData.favorites); changed=true; } if (favData.bookmarks){ saveBookmarks(favData.bookmarks); changed=true; } } const timeContent=data.files['nsl_timeline.json']?.content; if (timeContent){ const timeData=JSON.parse(timeContent); if (timeData.timeline){ saveTimeline(timeData.timeline); changed=true; } } const bookContent=data.files['nsl_bookmarks.json']?.content; if (bookContent){ const bookData=JSON.parse(bookContent); if (bookData.bookmarks){ saveBookmarks(bookData.bookmarks); changed=true; } } const hisContent=data.files['nsl_history.json']?.content; if (hisContent){ const hisData=JSON.parse(hisContent); if (hisData.history){ saveHistory(hisData.history); changed=true; } } if (!favContent&&!timeContent){ const oldContent=data.files['nsl_sync.json']?.content; if (oldContent){ const oldData=JSON.parse(oldContent); if (oldData.timeline) saveTimeline(oldData.timeline); if (oldData.favorites) saveFavorites(oldData.favorites); if (oldData.bookmarks) saveBookmarks(oldData.bookmarks); changed=true; } } syncingFromGist=false; if (changed){ cleanupDuplicateCategories(); syncTimelineWithCategories(); checkNewEpisodes(false); } Lampa.Storage.set(GIST_CACHE+'_last_sync',Date.now()); setTimeout(()=>renderBookmarks(),500); refreshCardUI(); refreshNewEpisodesBadge(); if (showNotify) notify(changed?'📥 Данные загружены с Gist':'✅ Актуально'); } catch(e){ syncingFromGist=false; console.error('[NSL] Parse error:',e); if (showNotify) notify('❌ Ошибка чтения данных'); } }, error:(xhr)=>{ syncingFromGist=false; console.error('[NSL] Load error:',xhr.status); if (showNotify) notify('❌ Ошибка загрузки с Gist'); } }); }
    function checkAutoSync() { if (!cfg().sync_auto_interval) return; if (Date.now()-Lampa.Storage.get(GIST_CACHE+'_last_sync',0)>(cfg().sync_interval_minutes||60)*60000) syncFromGist(false); }
    let syncTimer=null; function startAutoSync() { if (syncTimer) clearInterval(syncTimer); syncTimer=setInterval(()=>checkAutoSync(),300000); }
    let autoBackupTimer=null; function startAutoBackup() { if (!cfg().auto_backup) return; if (autoBackupTimer) clearInterval(autoBackupTimer); setTimeout(()=>doAutoBackup(),60000); autoBackupTimer=setInterval(()=>doAutoBackup(),(cfg().auto_backup_interval||24)*3600000); }
    function doAutoBackup() { try{ Lampa.Storage.set(`nsl_autobackup_${PROFILE_ID}`,{ version:5, profile_id:PROFILE_ID, updated:new Date().toISOString(), bookmarks:getBookmarks(), favorites:getFavorites(), timeline:getTimeline() }); Lampa.Storage.set(`nsl_autobackup_time_${PROFILE_ID}`,Date.now()); } catch(e){ console.error('[NSL] Auto-backup failed:',e); } }

    // ====================== СТАТИСТИКА ======================
    function getWatchStats() { const timeline=getTimeline(), favorites=getFavorites(); let totalTime=0, totalMovies=0, totalEpisodes=0; for (const key in timeline){ if (timeline[key].time>0){ totalTime+=timeline[key].time; if (key.includes('_s')||key.includes('_e')) totalEpisodes++; else totalMovies++; } } const categoryStats={}; FAVORITE_CATEGORIES.forEach(cat=>categoryStats[cat.id]={ name:cat.name, icon:cat.icon, count:0, time:0 }); favorites.forEach(fav=>{ if (categoryStats[fav.category]) categoryStats[fav.category].count++; const baseId=getBaseTmdbId(fav.tmdb_id); for (const key in timeline){ if (getBaseTmdbId(timeline[key].tmdb_id)===baseId&&timeline[key].time>0&&categoryStats[fav.category]) categoryStats[fav.category].time+=timeline[key].time; } }); return { totalTime, totalTimeFormatted:formatTotalTime(totalTime), totalMovies, totalEpisodes, favoritesCount:favorites.length, timelineCount:Object.keys(timeline).length, categoryStats }; }
    function showWatchStats() { const stats=getWatchStats(), items=[{ title:`⏱️ Общее время просмотра: ${stats.totalTimeFormatted}` },{ title:`🎬 Просмотрено фильмов: ${stats.totalMovies}` },{ title:`📺 Просмотрено эпизодов: ${stats.totalEpisodes}` },{ title:`⭐ В избранном: ${stats.favoritesCount}` },{ title:`📊 Всего таймкодов: ${stats.timelineCount}` },{ title:'──────────',separator:true},{ title:'📋 По категориям:',separator:true}]; FAVORITE_CATEGORIES.forEach(cat=>{ const stat=stats.categoryStats[cat.id]; if (stat.count>0) items.push({ title:`${stat.icon} ${stat.name}: ${stat.count} шт.${stat.time>0?` | ${formatTotalTime(stat.time)}`:''}` }); }); const topItems=Object.entries(getTimeline()).filter(([,t])=>t.time>0).sort((a,b)=>b[1].time-a[1].time).slice(0,5); if (topItems.length>0){ items.push({ title:'──────────',separator:true},{ title:'🏆 Топ-5 по времени:',separator:true}); topItems.forEach(([,topItem],index)=>{ const baseId=getBaseTmdbId(topItem.tmdb_id), fav=getFavorites().find(f=>getBaseTmdbId(f.tmdb_id)===baseId), cd=fav?.data||{}, ri=renderCardItemHTML(cd,fav||{},{ sub:`${formatTotalTime(topItem.time)} · ${FAVORITE_CATEGORIES.find(c=>c.id===fav?.category)?.icon||''} ${FAVORITE_CATEGORIES.find(c=>c.id===fav?.category)?.name||''}` }); items.push({ title:ri.html, onSelect:()=>{ if (fav) openItem(fav); } }); }); } items.push({ title:'──────────',separator:true},{ title:'◀ Назад',onSelect:()=>showFavoritesMenu()},{ title:'❌ Закрыть',onSelect:()=>Lampa.Controller.toggle('content')}); Lampa.Select.show({ title:'📊 Статистика просмотров', items, onBack:()=>showFavoritesMenu()}); }

    // ====================== ОТОБРАЖЕНИЕ ======================
    function getCardStyles() { const c=cfg(); if (c.card_display_mode==='nsl_status') return `.card .card-watched,.card-watched__item,.card .icon--history{display:none!important}.nsl-card-status{position:absolute;left:0.8em;right:0.8em;z-index:5;display:flex;align-items:flex-start;gap:0.4em;padding:0.5em 0.8em;background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);border-radius:0.5em;pointer-events:none;font-size:0.7em;line-height:1.5}.nsl-card-status__icon{flex-shrink:0;font-size:1.2em;line-height:1.5}.nsl-card-status__text{color:#fff;font-weight:500;text-align:left;flex:1;min-width:0;display:flex;flex-direction:column}.nsl-card-status--top{top:0.5em;bottom:auto}.nsl-card-status--center{top:50%;bottom:auto;transform:translateY(-50%)}.nsl-card-status--bottom{bottom:2.5em;top:auto}@media screen and (max-width:480px){.nsl-card-status{left:0.5em;right:0.5em;font-size:0.65em}}`; if (c.card_display_mode==='lampa_default') return `.nsl-card-status{display:none!important}.card .card-watched,.card-watched__item,.card .icon--history{display:block!important}`; return '.nsl-card-status{display:none!important}'; }
    function updateCardStyles() { let s=document.getElementById('nsl-card-display-styles'); if (!s){ s=document.createElement('style'); s.id='nsl-card-display-styles'; document.head.appendChild(s); } s.textContent=getCardStyles(); }
    function patchCardDisplay() { if (!cfg().enabled||cfg().card_display_mode!=='nsl_status'){ cardDisplayPatched=false; return; } if (cardDisplayPatched) return; if (!Lampa.Maker?.map){ setTimeout(patchCardDisplay,1000); return; } try{ const cardMap=Lampa.Maker.map('Card'); if (!cardMap?.Watched){ setTimeout(patchCardDisplay,1000); return; } const origCreate=cardMap.Watched.onCreate, origDestroy=cardMap.Watched.onDestroy; cardMap.Watched.onCreate=function(){ if (origCreate) origCreate.call(this); const updateCard=()=>{ if (this.data?.id) updateCardStatusElement(this.render().get(0),this.data); }; setTimeout(updateCard,150); const handler=()=>setTimeout(updateCard,100); if (this._nslUnsubscribe) Lampa.Listener.remove('state:changed',this._nslUnsubscribe); Lampa.Listener.follow('state:changed',handler); this._nslUnsubscribe=handler; }; cardMap.Watched.onDestroy=function(){ if (this._nslUnsubscribe){ Lampa.Listener.remove('state:changed',this._nslUnsubscribe); this._nslUnsubscribe=null; } if (origDestroy) origDestroy.call(this); }; cardDisplayPatched=true; } catch(e){ console.error('[NSL] Error patching card display:',e); } }
    function applyCardDisplayMode() { cardDisplayPatched=false; updateCardStyles(); if (cfg().card_display_mode==='nsl_status'){ patchCardDisplay(); setTimeout(refreshAllCardStatuses,500); } }
    function applyHideLampaElements() { $('.button--book').toggleClass('nsl-hidden-lampa-button',!!cfg().hide_lampa_bookmark_button); }

    // ====================== ЛОГИРОВАНИЕ ======================
    function logMove(action, title, fromCategory, toCategory) { const c=cfg(); if (!c.show_move_notifications&&fromCategory) return; const log=getMoveLog(); log.push({ time:Date.now(), action, title, from:fromCategory||'none', to:toCategory||'none' }); saveMoveLog(log); if (!c.show_move_notifications) return; const actions={ move:`📦 "${title}" → ${getCategoryName(toCategory)}`, auto_watching:`👁️ "${title}" → Смотрю`, auto_watched:`✅ "${title}" → Просмотрено`, auto_abandoned:`❌ "${title}" → Брошено`, return_abandoned:`🔄 "${title}" возвращён в Смотрю`, return_watched:`🔄 "${title}" возвращён в Смотрю (повторный просмотр)` }; if (actions[action]) notify(actions[action]); }
    function showMoveLog() { const log=getMoveLog(); if (!log.length){ notify('📋 Лог пуст'); return; } const items=log.slice(-30).reverse().map(entry=>{ const actions={ move:`📦 "${entry.title}" ${getCategoryName(entry.from)} → ${getCategoryName(entry.to)}`, auto_watching:`👁️ "${entry.title}" → Смотрю`, auto_watched:`✅ "${entry.title}" → Просмотрено`, auto_abandoned:`❌ "${entry.title}" → Брошено`, return_abandoned:`🔄 "${entry.title}" возвращён в Смотрю`, return_watched:`🔄 "${entry.title}" возвращён в Смотрю (повтор)`, delete:`🗑️ "${entry.title}" удалён полностью`, clear_all:'🗑️ Всё избранное очищено', cleanup:'🧹 Системная очистка дубликатов', auto_remove_watched:`🧹 "${entry.title}" авто-удалён из Просмотрено` }; return { title:actions[entry.action]||`${entry.action}: ${entry.title}`, sub:new Date(entry.time).toLocaleString() }; }); items.push({ title:'──────────',separator:true},{ title:'🗑️ Очистить лог',action:'clear'},{ title:'❌ Закрыть',onSelect:()=>{} }); Lampa.Select.show({ title:'📋 Лог перемещений', items, onSelect:(item)=>{ if (item.action==='clear') confirmDialog('⚠️ Очистить лог перемещений?',[{ title:'✅ Да, очистить',action:'confirm'},{ title:'❌ Отмена',action:'cancel'}],(opt)=>{ if (opt.action==='confirm'){ saveMoveLog([]); notify('📋 Лог очищен'); } }); }, onBack:()=>showMainMenu() }); }
    function cleanupDuplicateCategories() { const favorites=getFavorites(), tmdbMap=new Map(); let changed=false; for (const item of favorites){ const baseId=getBaseTmdbId(item.tmdb_id); if (!tmdbMap.has(baseId)) tmdbMap.set(baseId,[]); tmdbMap.get(baseId).push(item); } for (const [baseId,items] of tmdbMap){ if (items.length<=1) continue; const cats=items.map(i=>i.category); let keep=[...cats]; if (cats.includes('abandoned')) keep=keep.filter(c=>c==='abandoned'||c==='collection'); else if (cats.includes('watched')) keep=keep.filter(c=>c==='watched'||c==='collection'); else if (cats.includes('watching')) keep=keep.filter(c=>c==='watching'||c==='collection'); else if (cats.includes('planned')&&cats.includes('favorite')) keep=['planned','collection']; const uniqueKeep=[...new Set(keep)]; for (const item of items){ if (!uniqueKeep.includes(item.category)){ const idx=favorites.findIndex(f=>f.id===item.id); if (idx>=0){ favorites.splice(idx,1); changed=true; } } } for (const cat of uniqueKeep){ const catItems=items.filter(i=>i.category===cat); if (catItems.length>1){ catItems.sort((a,b)=>(b.updated||0)-(a.updated||0)); for (let i=1;i<catItems.length;i++){ const idx=favorites.findIndex(f=>f.id===catItems[i].id); if (idx>=0){ favorites.splice(idx,1); changed=true; } } } } } if (changed){ saveFavorites(favorites); logMove('cleanup','Система',null,null); } return changed; }
    function mergeTimeline(localT, remoteT, strategy) { const merged={...localT}; let changes=0; for (const key in remoteT){ const rr=remoteT[key], lr=merged[key]; if (!rr.updated) rr.updated=rr.saved_at||0; if (!lr){ merged[key]=rr; changes++; } else { if (!lr.updated) lr.updated=lr.saved_at||0; let update=false; if (strategy==='max_time'){ if ((rr.time||0)>(lr.time||0)) update=true; } else { if ((rr.updated||0)>(lr.updated||0)||((rr.updated||0)===(lr.updated||0)&&(rr.time||0)>(lr.time||0))) update=true; } if (update){ merged[key]=rr; changes++; } } } return { merged, changes }; }
    
    function clearAllTimeline() {
        Lampa.Controller.toggle('content');
        setTimeout(() => {
            Lampa.Select.show({
                title: '⚠️ Очистить все локальные таймкоды?',
                items: [{ title: '✅ Да, очистить всё', action: 'confirm' }, { title: '❌ Отмена', action: 'cancel' }],
                onSelect: (opt) => {
                    if (opt.action === 'confirm') {
                        const timeline = getTimeline();
                        const idsToClean = [];
                        for (const key in timeline) { const baseId = getBaseTmdbId(key); if (baseId && !idsToClean.includes(baseId)) idsToClean.push(baseId); }
                        Lampa.Storage.set('file_view', {}, true);
                        Lampa.Storage.set(FILE_VIEW_KEY, {}, true);
                        if (Lampa.Cache && typeof Lampa.Cache.rewriteData === 'function') { idsToClean.forEach(baseId => { Lampa.Cache.rewriteData('timetable', baseId, null).catch(() => {}); }); }
                        saveTimeline({});
                        if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') Lampa.Timeline.read(true);
                        setTimeout(() => { refreshCardUI(); refreshAllCardStatuses(); }, 300);
                        notify('🗑️ Все локальные таймкоды очищены');
                    }
                },
                onBack: () => Lampa.Controller.toggle('content')
            });
        }, 300);
    }
    function cleanupTimeline() { const c=cfg(), timeline=getTimeline(), now=Date.now(); let removed=0; if (c.cleanup_older_days>0){ const threshold=c.cleanup_older_days*86400000; for (const key in timeline){ if ((timeline[key]?.updated||0)>0&&(now-timeline[key].updated)>threshold){ delete timeline[key]; removed++; } } } if (c.cleanup_completed){ for (const key in timeline){ if ((timeline[key]?.percent||0)>=95){ delete timeline[key]; removed++; } } } if (removed>0){ saveTimeline(timeline); notify(`🧹 Удалено таймкодов: ${removed}`); } else notify('✅ Нечего очищать'); }

    // ====================== НАСТРОЙКИ ======================
    function showMainMenu() { const c=cfg(), cardModeNames={ none:'Выкл', nsl_status:'Избранное+', lampa_default:'Стандарт Lampa' }, posNames={ top:'Сверху', center:'По центру', bottom:'Снизу' }, newCount=getNewEpisodesCount(); Lampa.Select.show({ title:'Избранное+', items:[{ title:`📌 Закладки разделов (${getBookmarks().length})`, action:'sections' },{ title:`⭐ Избранное (${getFavorites().length})${newCount>0?` 🔔${newCount}`:''}`, action:'favorites' },{ title:`⏱️ Таймкоды (${Object.keys(getTimeline()).length})`, action:'timeline' },{ title:'☁️ GitHub Gist', action:'gist' },{ title:'──────────',separator:true},{ title:`🎨 Отображение: ${cardModeNames[c.card_display_mode]||'Выкл'}`, action:'card_display_mode'},{ title:`📍 Позиция: ${posNames[c.nsl_status_position]||'Снизу'}`, action:'nsl_status_position'},{ title:'──────────',separator:true},{ title:`🔔 Новые серии: ${c.check_new_episodes?'Вкл':'Выкл'}`, action:'toggle_new_episodes'},{ title:`📢 Уведомления: ${c.new_episodes_notify?'Вкл':'Выкл'}`, action:'toggle_new_episodes_notify'},{ title:`⏱️ Интервал: ${c.new_episodes_check_interval} ч.`, action:'set_episodes_check_interval'},{ title:`🔍 Проверить сейчас${newCount>0?` (${newCount})`:''}`, action:'check_episodes_now'},{ title:'──────────',separator:true},{ title:`👁 Скрыть кнопку: ${c.hide_lampa_bookmark_button?'Да':'Нет'}`, action:'toggle_hide_bookmark_btn'},{ title:'──────────',separator:true},{ title:'🔄 Синхронизировать сейчас', action:'sync_now'},{ title:'🧹 Очистить дубликаты', action:'cleanup_duplicates'},{ title:'📋 Лог перемещений', action:'show_log'},{ title:'❌ Закрыть', action:'cancel'}], onSelect:(item)=>{ const c=cfg(); if (item.action==='sections') showSectionsSettings(); else if (item.action==='favorites') showFavoritesSettings(); else if (item.action==='timeline') showTimelineSettings(); else if (item.action==='gist') showGistSetup(); else if (item.action==='card_display_mode'){ Lampa.Select.show({ title:'Отображение на карточках', items:[{ title:'❌ Выкл',action:'none'},{ title:'⭐ Избранное+',action:'nsl_status'},{ title:'🔄 Стандарт Lampa',action:'lampa_default'}], onSelect:(si)=>{ if (si.action){ c.card_display_mode=si.action; saveCfg(c); applyCardDisplayMode(); } showMainMenu(); }, onBack:()=>showMainMenu() }); } else if (item.action==='nsl_status_position'){ Lampa.Select.show({ title:'Позиция статуса', items:[{ title:'⬆️ Сверху',action:'top'},{ title:'↕️ По центру',action:'center'},{ title:'⬇️ Снизу',action:'bottom'}], onSelect:(si)=>{ if (si.action){ c.nsl_status_position=si.action; saveCfg(c); updateCardStyles(); refreshAllCardStatuses(); } showMainMenu(); }, onBack:()=>showMainMenu() }); } else if (item.action==='toggle_new_episodes'){ c.check_new_episodes=!c.check_new_episodes; saveCfg(c); c.check_new_episodes?startSeriesCheckTimer():clearInterval(seriesCheckTimer); showMainMenu(); } else if (item.action==='toggle_new_episodes_notify'){ c.new_episodes_notify=!c.new_episodes_notify; saveCfg(c); showMainMenu(); } else if (item.action==='set_episodes_check_interval'){ editNumberSetting('Интервал (часов)',c.new_episodes_check_interval||24,(v)=>{ if (v>0){ c.new_episodes_check_interval=v; saveCfg(c); startSeriesCheckTimer(); } showMainMenu(); }); } else if (item.action==='check_episodes_now'){ checkNewEpisodes(true); showMainMenu(); } else if (item.action==='toggle_hide_bookmark_btn'){ c.hide_lampa_bookmark_button=!c.hide_lampa_bookmark_button; saveCfg(c); applyHideLampaElements(); showMainMenu(); } else if (item.action==='sync_now'){ syncToGist('favorites',false); syncToGist('timeline',false); syncToGist('bookmarks',false); notify('🔄 Синхронизация...'); setTimeout(()=>syncFromGist(true),1500); } else if (item.action==='cleanup_duplicates'){ notify(cleanupDuplicateCategories()?'🧹 Дубликаты очищены':'✅ Дубликатов не найдено'); showMainMenu(); } else if (item.action==='show_log') showMoveLog(); }, onBack:()=>Lampa.Controller.toggle('content') }); }
    function showSectionsSettings() { const c=cfg(); Lampa.Select.show({ title:'📌 Закладки разделов', items:[{ title:`📍 Кнопка: ${c.button_position==='side'?'Боковое меню':'Верхняя панель'}`, action:'toggle_position'},{ title:'📌 Сохранить раздел', action:'save_section'},{ title:`🗑️ Очистить (${getBookmarks().length})`, action:'clear_sections'},{ title:'◀ Назад', action:'back'}], onSelect:(item)=>{ if (item.action==='toggle_position'){ c.button_position=c.button_position==='side'?'top':'side'; saveCfg(c); notify('После перезагрузки'); showSectionsSettings(); } else if (item.action==='save_section'){ saveBookmark(); setTimeout(()=>showSectionsSettings(),1000); } else if (item.action==='clear_sections') confirmDialog('⚠️ Удалить все закладки?',[{ title:'✅ Да',action:'confirm'},{ title:'❌ Отмена',action:'cancel'}],(opt)=>{ if (opt.action==='confirm'){ saveBookmarks([]); notify('🗑️ Удалены'); } showSectionsSettings(); }); else if (item.action==='back') showMainMenu(); }, onBack:()=>showMainMenu() }); }
    function showFavoritesSettings() { const c=cfg(); Lampa.Select.show({ title:'⭐ Избранное', items:[{ title:`🔄 Авто в Брошено: ${c.auto_abandoned?'Вкл':'Выкл'}`, action:'toggle_auto_abandoned'},{ title:`📅 Дней: ${c.abandoned_days}`, action:'set_abandoned_days'},{ title:'──────────',separator:true},{ title:`👁️ Авто в Смотрю: ${c.auto_watching?'Вкл':'Выкл'}`, action:'toggle_auto_watching'},{ title:`📊 Порог: ${c.watching_min_progress}%-${c.watching_max_progress}%`, action:'set_watching_range'},{ title:'──────────',separator:true},{ title:`✅ Авто в Просмотрено: ${c.auto_watched?'Вкл':'Выкл'}`, action:'toggle_auto_watched'},{ title:`📊 Порог: ${c.watched_min_progress}%`, action:'set_watched_threshold'},{ title:'──────────',separator:true},{ title:'🗑️ Очистить всё', action:'clear_favorites'},{ title:'◀ Назад', action:'back'}], onSelect:(item)=>{ if (item.action==='toggle_notifications'){ c.show_move_notifications=!c.show_move_notifications; saveCfg(c); showFavoritesSettings(); } else if (item.action==='toggle_auto_abandoned'){ c.auto_abandoned=!c.auto_abandoned; saveCfg(c); showFavoritesSettings(); } else if (item.action==='set_abandoned_days') editNumberSetting('Дней',c.abandoned_days,(v)=>{ if (v>0){ c.abandoned_days=v; saveCfg(c); } showFavoritesSettings(); }); else if (item.action==='toggle_auto_watching'){ c.auto_watching=!c.auto_watching; saveCfg(c); showFavoritesSettings(); } else if (item.action==='set_watching_range') showWatchingRangeSettings(); else if (item.action==='toggle_auto_watched'){ c.auto_watched=!c.auto_watched; saveCfg(c); showFavoritesSettings(); } else if (item.action==='set_watched_threshold') editNumberSetting('Порог (%)',c.watched_min_progress,(v)=>{ if (v>=0&&v<=100){ c.watched_min_progress=v; saveCfg(c); } showFavoritesSettings(); }); else if (item.action==='clear_favorites'){ clearAllFavorites(); showFavoritesSettings(); } else if (item.action==='back') showMainMenu(); }, onBack:()=>showMainMenu() }); }
    function showWatchingRangeSettings() { const c=cfg(); Lampa.Select.show({ title:'📊 Порог "Смотрю"', items:[{ title:`Мин: ${c.watching_min_progress}%`, action:'set_min'},{ title:`Макс: ${c.watching_max_progress}%`, action:'set_max'},{ title:'◀ Назад', action:'back'}], onSelect:(item)=>{ if (item.action==='set_min') editNumberSetting('Мин. %',c.watching_min_progress,(v)=>{ if (v>=0&&v<=100){ c.watching_min_progress=v; saveCfg(c); } showWatchingRangeSettings(); }); else if (item.action==='set_max') editNumberSetting('Макс. %',c.watching_max_progress,(v)=>{ if (v>=0&&v<=100){ c.watching_max_progress=v; saveCfg(c); } showWatchingRangeSettings(); }); else if (item.action==='back') showFavoritesSettings(); }, onBack:()=>showFavoritesSettings() }); }
    function showTimelineSettings() { const c=cfg(); Lampa.Select.show({ title:'⏱️ Таймкоды', items:[{ title:`✅ Автосохранение: ${c.auto_save?'Вкл':'Выкл'}`, action:'t_auto_save'},{ title:`✅ Автосинхр.: ${c.auto_sync?'Вкл':'Выкл'}`, action:'t_auto_sync'},{ title:`⏱️ Интервал: ${c.sync_interval} сек`, action:'t_interval'},{ title:`📊 Стратегия: ${c.sync_strategy==='max_time'?'По длительности':'По дате'}`, action:'t_strategy'},{ title:'──────────',separator:true},{ title:`🗑️ Старше дней: ${c.cleanup_older_days||'никогда'}`, action:'t_cleanup_days'},{ title:`✅ Удалять завершённые: ${c.cleanup_completed?'Вкл':'Выкл'}`, action:'t_cleanup_comp'},{ title:'──────────',separator:true},{ title:`🗑️ Авто-удаление: ${c.auto_remove_watched?'Вкл':'Выкл'}`, action:'t_auto_remove'},{ title:`📅 Через дней: ${c.auto_remove_watched_days}`, action:'t_auto_remove_days'},{ title:'──────────',separator:true},{ title:'🗑️ Очистить всё', action:'t_clear'},{ title:'🧹 Очистить старые', action:'t_cleanup'},{ title:'◀ Назад', action:'back'}], onSelect:(item)=>{ if (item.action==='t_auto_save'){ c.auto_save=!c.auto_save; saveCfg(c); showTimelineSettings(); } else if (item.action==='t_auto_sync'){ c.auto_sync=!c.auto_sync; saveCfg(c); showTimelineSettings(); } else if (item.action==='t_interval') editNumberSetting('Интервал (сек)',c.sync_interval,(v)=>{ if (v>0){ c.sync_interval=v; saveCfg(c); } showTimelineSettings(); }); else if (item.action==='t_strategy'){ c.sync_strategy=c.sync_strategy==='max_time'?'last_watch':'max_time'; saveCfg(c); showTimelineSettings(); } else if (item.action==='t_cleanup_days') editNumberSetting('Дней (0=откл)',c.cleanup_older_days,(v)=>{ if (v>=0){ c.cleanup_older_days=v; saveCfg(c); } showTimelineSettings(); }); else if (item.action==='t_cleanup_comp'){ c.cleanup_completed=!c.cleanup_completed; saveCfg(c); showTimelineSettings(); } else if (item.action==='t_auto_remove'){ c.auto_remove_watched=!c.auto_remove_watched; saveCfg(c); showTimelineSettings(); } else if (item.action==='t_auto_remove_days') editNumberSetting('Дней',c.auto_remove_watched_days,(v)=>{ if (v>0){ c.auto_remove_watched_days=v; saveCfg(c); } showTimelineSettings(); }); else if (item.action==='t_clear'){ clearAllTimeline(); showTimelineSettings(); } else if (item.action==='t_cleanup'){ cleanupTimeline(); showTimelineSettings(); } else if (item.action==='back') showMainMenu(); }, onBack:()=>showMainMenu() }); }
    function showGistSetup() { const c=cfg(), lastSync=Lampa.Storage.get(GIST_CACHE+'_last_sync',0), status=lastSync?(Date.now()-lastSync<60000?'Только что':`${Math.floor((Date.now()-lastSync)/3600000)} ч назад`):'Никогда'; Lampa.Select.show({ title:'☁️ GitHub Gist', items:[{ title:`🔑 Токен: ${c.gist_token?'✓':'❌'}`, action:'token'},{ title:`📄 ID: ${c.gist_id?c.gist_id.substring(0,8)+'…':'❌'}`, action:'id'},{ title:'──────────',separator:true},{ title:'📤 Экспорт на Gist', action:'upload'},{ title:'📥 Импорт с Gist', action:'download'},{ title:'──────────',separator:true},{ title:'💾 В файл', action:'export'},{ title:'📂 Из файла', action:'import'},{ title:'──────────',separator:true},{ title:`🔄 Статус: ${status}`, action:'sync_status'},{ title:'◀ Назад', action:'back'}], onSelect:(item)=>{ if (item.action==='token') Lampa.Input.edit({ title:'Token', value:c.gist_token||'', free:true },(v)=>{ if (v!==null){ c.gist_token=v; saveCfg(c); } showGistSetup(); }); else if (item.action==='id') Lampa.Input.edit({ title:'Gist ID', value:c.gist_id||'', free:true },(v)=>{ if (v!==null){ c.gist_id=v; saveCfg(c); } showGistSetup(); }); else if (item.action==='upload'){ syncToGist('favorites',false); syncToGist('timeline',false); syncToGist('bookmarks',false); notify('📤 Отправлено'); setTimeout(()=>showGistSetup(),1500); } else if (item.action==='download'){ syncFromGist(true); setTimeout(()=>showGistSetup(),1500); } else if (item.action==='export'){ const data=JSON.stringify({ version:5, profile_id:PROFILE_ID, updated:new Date().toISOString(), bookmarks:getBookmarks(), favorites:getFavorites(), timeline:getTimeline() },null,2), blob=new Blob([data],{ type:'application/json' }), a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`nsl_backup_${new Date().toISOString().slice(0,10)}.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a); notify('📤 Сохранено'); setTimeout(()=>showGistSetup(),500); } else if (item.action==='import'){ const input=document.createElement('input'); input.type='file'; input.accept='.json'; input.style.display='none'; document.body.appendChild(input); input.onchange=(e)=>{ const file=e.target.files[0]; if (!file){ document.body.removeChild(input); return; } const reader=new FileReader(); reader.onload=(ev)=>{ try{ const data=JSON.parse(ev.target.result); if (data.timeline) saveTimeline(data.timeline); if (data.favorites) saveFavorites(data.favorites); if (data.bookmarks) saveBookmarks(data.bookmarks); cleanupDuplicateCategories(); syncTimelineWithCategories(); notify('📥 Загружено'); } catch(err){ notify('❌ Ошибка'); } document.body.removeChild(input); }; reader.readAsText(file); }; input.click(); } else if (item.action==='sync_status'){ syncFromGist(true); setTimeout(()=>showGistSetup(),1500); } else if (item.action==='back') showMainMenu(); }, onBack:()=>showMainMenu() }); }
    function addSettingsButton() { setTimeout(()=>{ let ml=$('.menu__list').eq(2); if (!ml.length) ml=$('.menu__list').last(); if (ml.length&&!$('.nsl-settings-item').length){ const el=$(`<li class="menu__item selector nsl-settings-item"><div class="menu__ico"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg></div><div class="menu__text">Избранное+</div></li>`); el.on('hover:enter',(e)=>{ e.stopPropagation(); showMainMenu(); }); ml.append(el); } },2000); }

    // ====================== ИНИЦИАЛИЗАЦИЯ ======================
    function onAppClose() { const c=cfg(); if (c.sync_on_close&&c.gist_token&&c.gist_id){ syncToGist('favorites',false); syncToGist('timeline',false); syncToGist('bookmarks',false); } }
    function onAppStart() { if (cfg().sync_on_start&&cfg().gist_token&&cfg().gist_id) setTimeout(()=>syncFromGist(false),5000); }
    
    function init() {
        if (!cfg().enabled) return;
        console.log('[NSL] Init v30 for profile:', PROFILE_ID);
        $('<style>').text('.nsl-hidden-lampa-item{display:none!important}.nsl-hidden-lampa-button{display:none!important}').appendTo('head');
        setTimeout(() => { 
            addBookmarkButton(); 
            addFavoritesToMenu(); 
            addSettingsButton(); 
            renderBookmarks(); 
            applyHideLampaElements();
            
            // Обновляем навигацию, чтобы закладки стали доступны для выбора
            if (Lampa.Controller.enabled().name === 'menu') {
                Lampa.Controller.toggle('menu');
            }
        }, 1000);
        addFullCardHandler();
        initPlayerHandler();
        initTimelineListener();
        startAutoSync();
        onAppStart();
        const c = cfg();
        if (c.auto_backup) startAutoBackup();
        if (c.check_new_episodes) startSeriesCheckTimer();
        updateCardStyles();
        patchCardDisplay();
        
        setTimeout(() => {
            cleanupDuplicateCategories();
            syncTimelineWithCategories();
            checkNewEpisodes(false);
            checkAutoRemoveWatched();
            checkUnfinishedWatching();
            checkUpcomingEpisodes();
        }, 5500);
        
        window.addEventListener('beforeunload', onAppClose);
        
        window.NSL = {
            cfg, getFavorites, getBookmarks, getTimeline,
            syncToGist, syncFromGist, addToFavorites, toggleFavorite,
            getMoveLog, getMovieStatus, refreshCardUI,
            cleanupDuplicateCategories, applyCardDisplayMode,
            checkNewEpisodes, getNewEpisodesCount, getNewEpisodesList
        };
        
        console.log('[NSL] Init complete');
    }
    if (window.appready) init();
    else Lampa.Listener.follow('app', e => { if (e.type === 'ready') init(); });
})();
