// plugins/favplus.js - Improved version
(function() {
    const CONFIG = {
        version: '1.1.0',
        storagePrefix: 'favplus_',
        autoWatchThreshold: 5,
        autoViewedThreshold: 95,
        autoThrownDays: 30,
        autoViewedCleanupDays: 90,
        syncInterval: 60 * 60 * 1000,
        gistFileName: 'lampa_favplus_data.json'
    };

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
    
    // Хранилища (с привязкой к профилю)
    const STORE_FAVORITES = `favplus_favorites_${PROFILE_ID}`;
    const STORE_TIMELINE = `favplus_timeline_${PROFILE_ID}`;
    const STORE_MOVE_LOG = `favplus_movelog_${PROFILE_ID}`;
    const STORE_HISTORY = `favplus_history_${PROFILE_ID}`;
    const STORE_SERIES_CHECK = `favplus_seriescheck_${PROFILE_ID}`;
    const CFG = `favplus_cfg_${PROFILE_ID}`;
    
    // Категории
    const CATEGORIES = {
        BOOKMARK: 'book',
        LIKE: 'like',
        WATCH_LATER: 'wath',
        HISTORY: 'history',
        LOOK: 'look',
        VIEWED: 'viewed',
        SCHEDULED: 'scheduled',
        THROWN: 'thrown',
        COLLECTION: 'collection'
    };

    const CATEGORY_PRIORITY = {
        [CATEGORIES.LOOK]: 100,
        [CATEGORIES.VIEWED]: 90,
        [CATEGORIES.SCHEDULED]: 80,
        [CATEGORIES.BOOKMARK]: 70,
        [CATEGORIES.LIKE]: 60,
        [CATEGORIES.WATCH_LATER]: 50,
        [CATEGORIES.THROWN]: 40,
        [CATEGORIES.COLLECTION]: 30,
        [CATEGORIES.HISTORY]: 10
    };

    const CATEGORY_NAMES = {
        [CATEGORIES.BOOKMARK]: 'Избранное',
        [CATEGORIES.LIKE]: 'Нравится',
        [CATEGORIES.WATCH_LATER]: 'Позже',
        [CATEGORIES.HISTORY]: 'История',
        [CATEGORIES.LOOK]: 'Смотрю',
        [CATEGORIES.VIEWED]: 'Просмотрено',
        [CATEGORIES.SCHEDULED]: 'Буду смотреть',
        [CATEGORIES.THROWN]: 'Брошено',
        [CATEGORIES.COLLECTION]: 'Коллекция'
    };

    // Данные
    let data = {
        logs: [],
        customTimelines: {},
        sectionBookmarks: [],
        lastSync: 0,
        gistId: null,
        gistToken: null
    };

    // Карта хешей для синхронизации с file_view
    let hashMap = {};
    let returnedToWatchingMap = {};
    let syncTimelineTimer = null;
    let seriesCheckTimer = null;
    let gistSyncingFav = false;
    let gistSyncingTime = false;
    let syncingFromGist = false;

    //=================================================================
    // ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
    //=================================================================
    
    function addFavoriteButtonToFullPage() {
        Lampa.Listener.follow('full', function(e) {
            if (e.type === 'complite') {
                setTimeout(() => {
                    const movie = e.data.movie || e.data.card;
                    if (!movie || !movie.id) return;
                    
                    const render = e.object.activity.render();
                    const container = render.find('.full-start-new__buttons, .full-start__buttons').first();
                    if (!container.length) return;
                    
                    // Удаляем старую кнопку, если есть
                    container.find('.favplus-favorite-btn').remove();
                    
                    // Определяем текущие статусы
                    const isFavorite = isInCategory(movie, CATEGORIES.BOOKMARK);
                    const isWatching = isInCategory(movie, CATEGORIES.LOOK);
                    const isViewed = isInCategory(movie, CATEGORIES.VIEWED);
                    const isScheduled = isInCategory(movie, CATEGORIES.SCHEDULED);
                    const isAbandoned = isInCategory(movie, CATEGORIES.THROWN);
                    const isCollection = isInCategory(movie, CATEGORIES.COLLECTION);
                    
                    // Создаём кнопку
                    const button = $(`
                        <div class="full-start__button selector favplus-favorite-btn" style="position:relative;">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 2L15 8H22L16 12L19 18L12 14L5 18L8 12L2 8H9L12 2Z" 
                                      fill="${isFavorite || isWatching || isViewed || isScheduled ? 'currentColor' : 'none'}" 
                                      stroke="currentColor" stroke-width="1.5"/>
                            </svg>
                            <span>В избранное+</span>
                            <span class="favplus-status-badge" style="position:absolute;top:-5px;right:-5px;background:#f44336;color:white;border-radius:10px;padding:0 5px;font-size:10px;line-height:16px;min-width:16px;text-align:center;">
                                ${getActiveCategoriesCount(movie)}
                            </span>
                        </div>
                    `);
                    
                    // Обработчик нажатия
                    button.on('hover:enter', () => {
                        showCategoryMenu(movie, button);
                    });
                    
                    // Находим штатную кнопку и вставляем рядом
                    const bookBtn = container.find('.button--book').first();
                    if (bookBtn.length) {
                        bookBtn.before(button);
                    } else {
                        container.prepend(button);
                    }
                    
                    // Скрываем штатную кнопку, если нужно
                    if (cfg().hide_lampa_bookmark_button) {
                        container.find('.button--book').addClass('favplus-hidden');
                    }
                    
                }, 500);
            }
        });
    }
    
    // Подсчёт активных категорий
    function getActiveCategoriesCount(movie) {
        let count = 0;
        for (const cat of [CATEGORIES.BOOKMARK, CATEGORIES.LOOK, CATEGORIES.VIEWED, 
                           CATEGORIES.SCHEDULED, CATEGORIES.THROWN, CATEGORIES.COLLECTION]) {
            if (isInCategory(movie, cat)) count++;
        }
        return count > 0 ? count : '';
    }
    
    // Меню выбора категорий
    function showCategoryMenu(card, buttonElement) {
        const items = [];
        
        // Список категорий для отображения в меню
        const menuCategories = [
            { id: CATEGORIES.BOOKMARK, name: '⭐ Избранное', icon: '⭐' },
            { id: CATEGORIES.LOOK, name: '👁️ Смотрю', icon: '👁️' },
            { id: CATEGORIES.SCHEDULED, name: '📋 Буду смотреть', icon: '📋' },
            { id: CATEGORIES.VIEWED, name: '✅ Просмотрено', icon: '✅' },
            { id: CATEGORIES.THROWN, name: '❌ Брошено', icon: '❌' },
            { id: CATEGORIES.COLLECTION, name: '📦 Коллекция', icon: '📦' }
        ];
        
        for (const cat of menuCategories) {
            const isChecked = isInCategory(card, cat.id);
            items.push({
                title: `${cat.icon} ${cat.name}`,
                category: cat.id,
                checkbox: true,
                checked: isChecked,
                onCheck: (item) => {
                    if (item.checked) {
                        addToCategory(card, item.category);
                        applyAutoRules(card, item.category);
                        notify(`✅ "${card.title || card.name}" добавлено в ${cat.name}`);
                    } else {
                        removeFromCategory(card, item.category);
                        notify(`❌ "${card.title || card.name}" удалено из ${cat.name}`);
                    }
                    // Обновляем бейдж на кнопке
                    const badge = buttonElement.find('.favplus-status-badge');
                    const newCount = getActiveCategoriesCount(card);
                    badge.text(newCount);
                    // Обновляем иконку
                    const hasAny = getActiveCategoriesCount(card) > 0;
                    buttonElement.find('path').attr('fill', hasAny ? 'currentColor' : 'none');
                }
            });
        }
        
        items.push({ separator: true });
        items.push({
            title: '🗑️ Удалить из всех категорий',
            onSelect: () => {
                clearAllCategories(card);
                const badge = buttonElement.find('.favplus-status-badge');
                badge.text('');
                buttonElement.find('path').attr('fill', 'none');
                notify(`🗑️ "${card.title || card.name}" удалён из Избранное+`);
            }
        });
        items.push({
            title: '❌ Закрыть',
            onSelect: () => {}
        });
        
        Lampa.Select.show({
            title: card.title || card.name,
            items: items,
            onBack: () => Lampa.Controller.toggle('content')
        });
    }

    function getBaseTmdbId(tmdbId) {
        if (!tmdbId) return null;
        return String(tmdbId).replace(/[_-].*$/, '');
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

    function extractTmdbId(card) {
        if (!card) return null;
        if (card.tmdb_id) return String(card.tmdb_id);
        if (card.id && /^\d{6,8}$/.test(String(card.id))) return String(card.id);
        return null;
    }

    function cleanCardData(card) {
        const cleaned = {};
        const allowedFields = ['id', 'title', 'name', 'original_title', 'original_name', 
            'poster_path', 'backdrop_path', 'vote_average', 'release_date', 'first_air_date',
            'overview', 'genre_ids', 'source', 'animation', 'anime', 'kp_rating',
            'number_of_seasons', 'number_of_episodes'];
        for (const field of allowedFields) {
            if (card[field] !== undefined) cleaned[field] = card[field];
        }
        return cleaned;
    }

    function formatTime(seconds) {
        if (!seconds || seconds < 0) return '0:00';
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (hours > 0) return `${hours}:${minutes.toString().padStart(2, '0')}`;
        return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
    }

    function formatTimeShort(seconds) {
        if (!seconds || seconds < 0) return '';
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (hours > 0) return `${hours} ч ${minutes} м`;
        if (minutes > 0) return `${minutes} м`;
        return `${Math.floor(seconds)} с`;
    }

    function notify(text) { 
        if (Lampa.Noty) Lampa.Noty.show(text);
    }

    function logMove(action, title, fromCategory, toCategory) {
        data.logs.unshift({
            timestamp: Date.now(),
            action: action,
            title: title,
            from: fromCategory,
            to: toCategory
        });
        if (data.logs.length > 200) data.logs = data.logs.slice(0, 200);
        saveData();
        
        const c = cfg();
        if (c.show_move_notifications && fromCategory) {
            const fromName = CATEGORY_NAMES[fromCategory] || fromCategory;
            const toName = CATEGORY_NAMES[toCategory] || toCategory;
            if (action === 'move') notify(`📦 "${title}" → ${toName}`);
            else if (action === 'auto_watching') notify(`👁️ "${title}" → Смотрю`);
            else if (action === 'auto_watched') notify(`✅ "${title}" → Просмотрено`);
            else if (action === 'auto_abandoned') notify(`❌ "${title}" → Брошено`);
        }
    }

    //=================================================================
    // ХРАНЕНИЕ ДАННЫХ
    //=================================================================

    function cfg() {
        return Lampa.Storage.get(CFG, {
            enabled: true,
            auto_watching: true,
            auto_watched: true,
            auto_abandoned: false,
            abandoned_days: 30,
            watching_min_progress: 5,
            watching_max_progress: 95,
            watched_min_progress: 95,
            show_move_notifications: true,
            check_new_episodes: true,
            new_episodes_notify: true,
            new_episodes_check_interval: 24,
            hide_lampa_bookmark_button: false,
            card_display_mode: 'favplus',
            nsl_status_position: 'bottom',
            button_position: 'side',
            gist_token: '',
            gist_id: '',
            sync_on_start: true,
            sync_on_close: false,
            sync_interval: 30,
            auto_save: true,
            auto_remove_watched: false,
            auto_remove_watched_days: 90,
            cleanup_older_days: 0,
            cleanup_completed: false,
            sync_strategy: 'max_time'
        });
    }

    function saveCfg(c) { Lampa.Storage.set(CFG, c, true); }

    function getFavorites() { return Lampa.Storage.get(STORE_FAVORITES, []) || []; }
    function saveFavorites(f) { 
        Lampa.Storage.set(STORE_FAVORITES, f, true);
        if (!syncingFromGist) setTimeout(() => Lampa.Listener.send('state:changed', { target: 'favplus_favorites', reason: 'update' }), 100);
    }

    function getTimeline() { return Lampa.Storage.get(STORE_TIMELINE, {}) || {}; }
    function saveTimeline(t) { Lampa.Storage.set(STORE_TIMELINE, t, true); }

    function getMoveLog() { return Lampa.Storage.get(STORE_MOVE_LOG, []) || []; }
    function saveMoveLog(l) { 
        if (l.length > 200) l = l.slice(-200);
        Lampa.Storage.set(STORE_MOVE_LOG, l, true); 
    }

    function getSeriesCheck() { return Lampa.Storage.get(STORE_SERIES_CHECK, {}) || {}; }
    function saveSeriesCheck(s) { Lampa.Storage.set(STORE_SERIES_CHECK, s, true); }

    function getHistory() { return Lampa.Storage.get(STORE_HISTORY, []) || []; }
    function saveHistory(h) { 
        if (h.length > 100) h = h.slice(-100);
        Lampa.Storage.set(STORE_HISTORY, h, true); 
    }

    function saveData() {
        Lampa.Storage.set(CONFIG.storagePrefix + 'data', {
            logs: data.logs,
            customTimelines: data.customTimelines,
            sectionBookmarks: data.sectionBookmarks,
            lastSync: data.lastSync,
            gistId: data.gistId,
            gistToken: data.gistToken
        });
    }

    function loadData() {
        const saved = Lampa.Storage.get(CONFIG.storagePrefix + 'data', {});
        data.logs = saved.logs || [];
        data.customTimelines = saved.customTimelines || {};
        data.sectionBookmarks = saved.sectionBookmarks || [];
        data.lastSync = saved.lastSync || 0;
        data.gistId = saved.gistId || null;
        data.gistToken = saved.gistToken || null;
        
        // Загружаем карту хешей
        hashMap = Lampa.Storage.get(`favplus_hash_map_${PROFILE_ID}`, {});
    }

    //=================================================================
    // РАБОТА С КАТЕГОРИЯМИ
    //=================================================================

    function isInCategory(card, category) {
        if (!card || !card.id) return false;
        const items = getFavorites().filter(f => f.category === category);
        return items.some(item => item.card_id === card.id || item.tmdb_id === extractTmdbId(card));
    }

    function addToCategory(card, category) {
        if (!card || !card.id) return false;
        if (isInCategory(card, category)) return false;
        
        const tmdbId = extractTmdbId(card);
        const favorites = getFavorites();
        
        favorites.push({
            id: Date.now(),
            card_id: card.id,
            tmdb_id: tmdbId,
            media_type: getMediaType(card),
            category: category,
            data: cleanCardData(card),
            added: Date.now(),
            updated: Date.now()
        });
        
        saveFavorites(favorites);
        logMove('add', card.title || card.name, null, category);
        return true;
    }

    function removeFromCategory(card, category) {
        if (!card || !card.id) return false;
        const tmdbId = extractTmdbId(card);
        const favorites = getFavorites();
        const filtered = favorites.filter(f => !(f.category === category && (f.card_id === card.id || f.tmdb_id === tmdbId)));
        if (filtered.length !== favorites.length) {
            saveFavorites(filtered);
            logMove('remove', card.title || card.name, category, null);
            return true;
        }
        return false;
    }

    function getPrimaryCategory(card) {
        if (!card || !card.id) return null;
        const tmdbId = extractTmdbId(card);
        const favorites = getFavorites();
        let primary = null;
        let maxPriority = -1;
        
        for (const item of favorites) {
            if (item.card_id === card.id || item.tmdb_id === tmdbId) {
                const priority = CATEGORY_PRIORITY[item.category] || 0;
                if (priority > maxPriority) {
                    maxPriority = priority;
                    primary = item.category;
                }
            }
        }
        return primary;
    }

    function applyAutoRules(card, targetCategory) {
        if (!card) return;
        
        if (targetCategory === CATEGORIES.VIEWED) {
            if (isInCategory(card, CATEGORIES.LOOK)) removeFromCategory(card, CATEGORIES.LOOK);
            if (isInCategory(card, CATEGORIES.SCHEDULED)) removeFromCategory(card, CATEGORIES.SCHEDULED);
        }
        else if (targetCategory === CATEGORIES.LOOK) {
            if (isInCategory(card, CATEGORIES.SCHEDULED)) removeFromCategory(card, CATEGORIES.SCHEDULED);
            if (isInCategory(card, CATEGORIES.THROWN)) removeFromCategory(card, CATEGORIES.THROWN);
        }
        else if (targetCategory === CATEGORIES.THROWN) {
            for (const cat of [CATEGORIES.LOOK, CATEGORIES.SCHEDULED, CATEGORIES.BOOKMARK, CATEGORIES.WATCH_LATER]) {
                if (isInCategory(card, cat)) removeFromCategory(card, cat);
            }
        }
    }

    function clearAllCategories(card) {
        if (!card || !card.id) return;
        const tmdbId = extractTmdbId(card);
        let favorites = getFavorites();
        favorites = favorites.filter(f => !(f.card_id === card.id || f.tmdb_id === tmdbId));
        saveFavorites(favorites);
        clearTimelinesForCard(card);
        logMove('clear_all', card.title || card.name, 'all', null);
    }

    //=================================================================
    // ПРОДВИНУТЫЕ ТАЙМКОДЫ
    //=================================================================

    function getCurrentMovieKey() {
        try {
            const activity = Lampa.Activity.active();
            if (!activity || !activity.movie) return null;
            const movie = activity.movie;
            const tmdbId = extractTmdbId(movie);
            if (!tmdbId) return null;
            
            // 1. Из playdata (сторонние источники)
            const playerData = Lampa.Player.playdata();
            if (playerData?.season && playerData?.episode) {
                return `${tmdbId}_s${playerData.season}_e${playerData.episode}`;
            }
            
            // 2. Из плейлиста Lampa
            try {
                if (typeof Lampa.Playlist !== 'undefined' && typeof Lampa.Playlist.get === 'function') {
                    const playlist = Lampa.Playlist.get();
                    if (playlist && playlist.length) {
                        const current = playlist.find(p => p.active || p.current) || playlist[0];
                        if (current) {
                            const urlMatch = (current.url || '').match(/[Ss](\d+)[Ee](\d+)/);
                            if (urlMatch) return `${tmdbId}_s${urlMatch[1]}_e${urlMatch[2]}`;
                            const titleMatch = (current.title || '').match(/[Ss](\d+)[Ee](\d+)/);
                            if (titleMatch) return `${tmdbId}_s${titleMatch[1]}_e${titleMatch[2]}`;
                        }
                    }
                }
            } catch(e) {}
            
            // 3. Из video.src
            const video = document.querySelector('video');
            if (video && video.src) {
                const match = video.src.match(/[Ss](\d+)[Ee](\d+)/);
                if (match) return `${tmdbId}_s${match[1]}_e${match[2]}`;
            }
            
            // 4. Для фильмов
            if (!movie.original_name) return String(tmdbId);
            
            return null;
        } catch (e) { return null; }
    }

    function getCurrentPlayerTime() {
        try {
            if (Lampa.Player.opened()) {
                const playerData = Lampa.Player.playdata();
                if (playerData?.timeline?.time !== undefined) return playerData.timeline.time;
            }
            
            const video = document.querySelector('video');
            if (video && !isNaN(video.currentTime) && video.currentTime > 0) {
                return video.currentTime;
            }
            
            if (typeof AndroidJS !== 'undefined' && typeof AndroidJS.getPlayerTime === 'function') {
                const time = AndroidJS.getPlayerTime();
                if (time > 0) return time;
            }
        } catch (e) {}
        return null;
    }

    function getVideoDuration() {
        try {
            const playerData = Lampa.Player.playdata();
            if (playerData?.timeline?.duration && playerData.timeline.duration > 0) return playerData.timeline.duration;
            
            const video = document.querySelector('video');
            if (video && video.duration && !isNaN(video.duration) && video.duration > 0 && video.duration < 36000) {
                return video.duration;
            }
            
            if (typeof AndroidJS !== 'undefined' && typeof AndroidJS.getPlayerDuration === 'function') {
                const duration = AndroidJS.getPlayerDuration();
                if (duration > 0) return duration;
            }
        } catch (e) {}
        return 0;
    }

    function saveTimelineProgress(currentTime, duration, percent) {
        const movieKey = getCurrentMovieKey();
        if (!movieKey) return false;
        
        const timeline = getTimeline();
        const tmdbId = extractTmdbId(Lampa.Activity.active()?.movie) || 
                       (timeline[movieKey]?.tmdb_id) || 
                       getBaseTmdbId(movieKey);
        
        timeline[movieKey] = { 
            time: currentTime, 
            percent: percent, 
            duration: duration, 
            updated: Date.now(), 
            tmdb_id: tmdbId
        };
        saveTimeline(timeline);
        
        // Сохраняем маппинг для синхронизации с file_view
        const fileViewHash = getFileViewHash(movieKey);
        if (fileViewHash) {
            hashMap[fileViewHash] = movieKey;
            Lampa.Storage.set(`favplus_hash_map_${PROFILE_ID}`, hashMap, true);
        }
        
        return true;
    }

    function getFileViewHash(nslKey) {
        try {
            const activity = Lampa.Activity.active();
            const movie = activity?.movie;
            if (!movie) return null;
            
            if (nslKey.includes('_s') && nslKey.includes('_e')) {
                const match = nslKey.match(/_s(\d+)_e(\d+)/);
                if (match && movie.original_name) {
                    const rawKey = [match[1], parseInt(match[1]) > 10 ? ':' : '', match[2], movie.original_name].join('');
                    return String(Lampa.Utils.hash(rawKey));
                }
            } else {
                const name = movie.original_title || movie.title || movie.original_name || movie.name;
                if (name) return String(Lampa.Utils.hash(name));
            }
        } catch(e) {}
        return null;
    }

    function syncFromFileView() {
        const fileName = 'file_view' + (PROFILE_ID !== 'default' ? '_' + PROFILE_ID : '');
        const fileView = Lampa.Storage.get(fileName, {});
        const timeline = getTimeline();
        let changed = false;
        
        for (const hash in fileView) {
            const fvItem = fileView[hash];
            if (!fvItem || !fvItem.time || fvItem.time <= 0) continue;
            
            let nslKey = hashMap[hash];
            if (!nslKey) {
                // Пытаемся найти соответствие через избранное
                const favorites = getFavorites();
                for (const fav of favorites) {
                    const cardData = fav.data || {};
                    if (cardData.original_name) {
                        for (let s = 1; s <= 30; s++) {
                            for (let e = 1; e <= 50; e++) {
                                const rawKey = [s, s > 10 ? ':' : '', e, cardData.original_name].join('');
                                if (String(Lampa.Utils.hash(rawKey)) === hash) {
                                    nslKey = `${fav.tmdb_id}_s${s}_e${e}`;
                                    break;
                                }
                            }
                            if (nslKey) break;
                        }
                    } else {
                        const name = cardData.original_title || cardData.title;
                        if (name && String(Lampa.Utils.hash(name)) === hash) {
                            nslKey = String(fav.tmdb_id);
                            break;
                        }
                    }
                    if (nslKey) break;
                }
                if (nslKey) {
                    hashMap[hash] = nslKey;
                    Lampa.Storage.set(`favplus_hash_map_${PROFILE_ID}`, hashMap, true);
                }
            }
            
            if (nslKey) {
                const existing = timeline[nslKey];
                if (!existing || fvItem.time > existing.time) {
                    timeline[nslKey] = {
                        time: fvItem.time,
                        duration: fvItem.duration || 0,
                        percent: fvItem.percent || 0,
                        updated: Date.now(),
                        tmdb_id: getBaseTmdbId(nslKey)
                    };
                    changed = true;
                }
            }
        }
        
        if (changed) {
            saveTimeline(timeline);
            syncTimelineWithCategories();
        }
    }

    //=================================================================
    // АВТОМАТИЧЕСКИЕ СТАТУСЫ
    //=================================================================

    function checkAutoStatuses(card, percent) {
        if (!card) return;
        
        if (percent >= CONFIG.autoWatchThreshold && percent <= CONFIG.autoViewedThreshold) {
            if (!isInCategory(card, CATEGORIES.VIEWED) && !isInCategory(card, CATEGORIES.LOOK)) {
                addToCategory(card, CATEGORIES.LOOK);
                logMove('auto_watching', card.title || card.name, null, CATEGORIES.LOOK);
            }
        }
        
        if (percent >= CONFIG.autoViewedThreshold) {
            if (!isInCategory(card, CATEGORIES.VIEWED)) {
                addToCategory(card, CATEGORIES.VIEWED);
                logMove('auto_watched', card.title || card.name, null, CATEGORIES.VIEWED);
                if (isInCategory(card, CATEGORIES.LOOK)) removeFromCategory(card, CATEGORIES.LOOK);
                if (isInCategory(card, CATEGORIES.SCHEDULED)) removeFromCategory(card, CATEGORIES.SCHEDULED);
            }
        }
    }

    function syncTimelineWithCategories() {
        const timeline = getTimeline();
        const favorites = getFavorites();
        let changed = false;
        
        for (const [key, item] of Object.entries(timeline)) {
            const tmdbId = item.tmdb_id;
            if (!tmdbId) continue;
            const percent = item.percent || 0;
            
            const isWatched = favorites.some(f => f.tmdb_id === tmdbId && f.category === CATEGORIES.VIEWED);
            if (isWatched) continue;
            
            // Возврат в "Смотрю" при продолжении просмотра
            const isAbandoned = favorites.some(f => f.tmdb_id === tmdbId && f.category === CATEGORIES.THROWN);
            if (isAbandoned && percent > 5 && !returnedToWatchingMap[tmdbId]) {
                removeFromCategory({ id: tmdbId, title: item.title }, CATEGORIES.THROWN);
                addToCategory({ id: tmdbId, title: item.title }, CATEGORIES.LOOK);
                returnedToWatchingMap[tmdbId] = true;
                changed = true;
            }
        }
        
        if (changed) saveFavorites(favorites);
    }

    function clearTimelinesForCard(card) {
        if (!card || !card.id) return;
        const tmdbId = extractTmdbId(card);
        const timeline = getTimeline();
        for (const key in timeline) {
            if (timeline[key].tmdb_id === tmdbId || key.includes(tmdbId)) {
                delete timeline[key];
            }
        }
        saveTimeline(timeline);
    }

    //=================================================================
    // ПЛЕЕР
    //=================================================================

    let playerInterval = null;
    let currentMovieTime = 0;
    let lastSavedProgress = 0;

    function initPlayerHandler() {
        if (playerInterval) clearInterval(playerInterval);
        
        playerInterval = setInterval(() => {
            const c = cfg();
            if (!c.enabled || !c.auto_save) return;
            
            const isPlayerOpen = Lampa.Player.opened();
            if (!isPlayerOpen) return;
            
            const currentTime = getCurrentPlayerTime();
            if (currentTime === null || currentTime <= 0) return;
            
            currentMovieTime = currentTime;
            const duration = getVideoDuration();
            const percent = duration > 0 ? (currentTime / duration) * 100 : 0;
            
            if (Math.floor(currentTime) - lastSavedProgress >= 10) {
                saveTimelineProgress(currentTime, duration, percent);
                lastSavedProgress = Math.floor(currentTime);
                
                const card = Lampa.Activity.active()?.movie;
                if (card) checkAutoStatuses(card, percent);
            }
        }, 1000);
    }

    //=================================================================
    // GITHUB GIST СИНХРОНИЗАЦИЯ
    //=================================================================

    function getGistData() {
        const c = cfg();
        if (!c.gist_token || !c.gist_id) return null;
        return { token: c.gist_token, id: c.gist_id };
    }

    function syncToGist(type, showNotify) {
        const gist = getGistData();
        if (!gist) { if (showNotify) notify('GitHub Gist не настроен'); return; }
        
        let fileName, dataToSend;
        if (type === 'favorites') {
            if (gistSyncingFav) return;
            gistSyncingFav = true;
            fileName = 'favplus_favorites.json';
            dataToSend = { version: 2, profile_id: PROFILE_ID, updated: Date.now(), favorites: getFavorites() };
        } else if (type === 'timeline') {
            if (gistSyncingTime) return;
            gistSyncingTime = true;
            fileName = 'favplus_timeline.json';
            dataToSend = { version: 2, profile_id: PROFILE_ID, updated: Date.now(), timeline: getTimeline() };
        } else return;
        
        $.ajax({
            url: `https://api.github.com/gists/${gist.id}`,
            method: 'PATCH',
            headers: { 'Authorization': `token ${gist.token}`, 'Accept': 'application/vnd.github.v3+json' },
            data: JSON.stringify({ files: { [fileName]: { content: JSON.stringify(dataToSend) } } }),
            success: () => { gistSyncingFav = false; gistSyncingTime = false; if (showNotify) notify('Синхронизировано'); },
            error: () => { gistSyncingFav = false; gistSyncingTime = false; if (showNotify) notify('Ошибка синхронизации'); },
            timeout: 15000
        });
    }

    //=================================================================
    // ВИЗУАЛЬНЫЕ КОМПОНЕНТЫ
    //=================================================================

    function getBestTimelineItem(tmdbId) {
        const timeline = getTimeline();
        const baseId = getBaseTmdbId(tmdbId);
        let bestItem = null;
        let bestTime = 0;
        
        for (const key in timeline) {
            if (getBaseTmdbId(timeline[key]?.tmdb_id) === baseId) {
                const time = timeline[key]?.time || 0;
                if (time > bestTime) {
                    bestTime = time;
                    bestItem = timeline[key];
                }
            }
        }
        return { item: bestItem, time: bestTime };
    }

    function getMovieStatus(movie) {
        const tmdbId = extractTmdbId(movie);
        if (!tmdbId) return null;
        
        const primary = getPrimaryCategory(movie);
        if (!primary) return null;
        
        const statusInfo = {
            [CATEGORIES.LOOK]: { text: 'Смотрю', icon: '👁️', color: '#4CAF50' },
            [CATEGORIES.VIEWED]: { text: 'Просмотрено', icon: '✅', color: '#2196F3' },
            [CATEGORIES.SCHEDULED]: { text: 'Буду смотреть', icon: '📋', color: '#FF9800' },
            [CATEGORIES.BOOKMARK]: { text: 'В избранном', icon: '⭐', color: '#FFC107' },
            [CATEGORIES.LIKE]: { text: 'Нравится', icon: '❤️', color: '#f44336' },
            [CATEGORIES.THROWN]: { text: 'Брошено', icon: '❌', color: '#9E9E9E' },
            [CATEGORIES.COLLECTION]: { text: 'В коллекции', icon: '📦', color: '#9C27B0' }
        };
        
        const base = statusInfo[primary];
        if (!base) return null;
        
        let extra = '';
        if (primary === CATEGORIES.LOOK) {
            const best = getBestTimelineItem(tmdbId);
            if (best.item && best.item.time > 0) {
                extra = ` · ${formatTimeShort(best.item.time)}`;
                if (best.item.duration > 0) extra += ` / ${formatTimeShort(best.item.duration)}`;
            }
        }
        
        return { ...base, displayText: base.text + extra };
    }

    function addStatusToCard() {
        Lampa.Listener.follow('full', function(e) {
            if (e.type === 'complite') {
                setTimeout(() => {
                    const movie = e.data.movie || e.data.card;
                    if (!movie || !movie.id) return;
                    
                    const status = getMovieStatus(movie);
                    if (!status) return;
                    
                    const render = e.object.activity.render();
                    const statusContainer = render.find('.full-start__status').first();
                    if (!statusContainer.length) return;
                    
                    render.find('.favplus-movie-status').remove();
                    const statusEl = $(`<div class="full-start__status favplus-movie-status" style="margin-left:8px;display:flex;align-items:center;gap:6px;padding:0 12px;height:32px;border-radius:4px;background:rgba(0,0,0,0.4);color:#fff;backdrop-filter:blur(8px);" title="${status.text}"><span>${status.icon}</span><span>${status.displayText}</span></div>`);
                    statusContainer.after(statusEl);
                }, 300);
            }
        });
    }

    //=================================================================
    // МЕНЮ
    //=================================================================

    function addMenuItem() {
        Lampa.Menu.addButton(
            '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L15 8H22L16 12L19 18L12 14L5 18L8 12L2 8H9L12 2Z" fill="currentColor"/></svg>',
            'Избранное+',
            () => openMainMenu()
        );
    }

    function openMainMenu() {
        const c = cfg();
        const newEpisodesCount = getNewEpisodesCount();
        
        Lampa.Select.show({
            title: 'Избранное+',
            items: [
                { title: `👁️ Смотрю (${getCategoryCount(CATEGORIES.LOOK)})`, action: 'look' },
                { title: `✅ Просмотрено (${getCategoryCount(CATEGORIES.VIEWED)})`, action: 'viewed' },
                { title: `📋 Буду смотреть (${getCategoryCount(CATEGORIES.SCHEDULED)})`, action: 'scheduled' },
                { title: `⭐ Избранное (${getCategoryCount(CATEGORIES.BOOKMARK)})`, action: 'bookmark' },
                { title: `❤️ Нравится (${getCategoryCount(CATEGORIES.LIKE)})`, action: 'like' },
                { title: `❌ Брошено (${getCategoryCount(CATEGORIES.THROWN)})`, action: 'thrown' },
                { title: `📦 Коллекция (${getCategoryCount(CATEGORIES.COLLECTION)})`, action: 'collection' },
                { title: '──────────', separator: true },
                { title: `🔔 Новые серии${newEpisodesCount > 0 ? ` (${newEpisodesCount})` : ''}`, action: 'new_episodes' },
                { title: '▶ Продолжить просмотр', action: 'continue' },
                { title: '🎲 Случайный фильм', action: 'random' },
                { title: '📊 Статистика', action: 'stats' },
                { title: '──────────', separator: true },
                { title: '⚙️ Настройки', action: 'settings' },
                { title: '❌ Закрыть', action: 'close' }
            ],
            onSelect: (item) => {
                if (item.action === 'settings') openSettings();
                else if (item.action === 'continue') continueWatching();
                else if (item.action === 'random') openRandomMovie();
                else if (item.action === 'stats') showStatistics();
                else if (item.action === 'new_episodes') showNewEpisodes();
                else if (['look', 'viewed', 'scheduled', 'bookmark', 'like', 'thrown', 'collection'].includes(item.action)) {
                    openCategoryView(item.action);
                }
            },
            onBack: () => Lampa.Controller.toggle('menu')
        });
    }

    function getCategoryCount(category) {
        return getFavorites().filter(f => f.category === category).length;
    }

    function openCategoryView(category) {
        const items = getFavorites().filter(f => f.category === category);
        if (items.length === 0) { notify(`В "${CATEGORY_NAMES[category]}" ничего нет`); return; }
        
        const selectItems = items.map(item => ({
            title: item.data?.title || item.data?.name || 'Без названия',
            subtitle: item.data?.original_name ? 'Сериал' : 'Фильм',
            card: item.data,
            onSelect: () => {
                Lampa.Activity.push({
                    url: '', component: 'full',
                    id: item.card_id,
                    method: item.data?.original_name ? 'tv' : 'movie',
                    card: item.data
                });
            }
        }));
        
        Lampa.Select.show({
            title: CATEGORY_NAMES[category],
            items: selectItems,
            onBack: () => openMainMenu()
        });
    }

    function continueWatching() {
        let bestItem = null;
        let bestTime = 0;
        const timeline = getTimeline();
        const favorites = getFavorites().filter(f => f.category === CATEGORIES.LOOK);
        
        for (const fav of favorites) {
            const baseId = getBaseTmdbId(fav.tmdb_id);
            for (const key in timeline) {
                if (getBaseTmdbId(timeline[key]?.tmdb_id) === baseId) {
                    const time = timeline[key].updated || 0;
                    const percent = timeline[key].percent || 0;
                    if (time > bestTime && percent >= 5 && percent <= 95) {
                        bestTime = time;
                        bestItem = fav;
                    }
                }
            }
        }
        
        if (!bestItem) { notify('Нет фильмов для продолжения просмотра'); return; }
        
        Lampa.Activity.push({
            url: '', component: 'full',
            id: bestItem.card_id,
            method: bestItem.data?.original_name ? 'tv' : 'movie',
            card: bestItem.data
        });
    }

    function openRandomMovie() {
        const favorites = getFavorites();
        const pool = favorites.filter(f => f.category === CATEGORIES.SCHEDULED || f.category === CATEGORIES.BOOKMARK);
        if (pool.length === 0) { notify('Добавьте фильмы в "Буду смотреть" или "Избранное"'); return; }
        
        const random = pool[Math.floor(Math.random() * pool.length)];
        Lampa.Activity.push({
            url: '', component: 'full',
            id: random.card_id,
            method: random.data?.original_name ? 'tv' : 'movie',
            card: random.data
        });
        notify(`🎲 "${random.data?.title || random.data?.name}"`);
    }

    //=================================================================
    // НОВЫЕ СЕРИИ
    //=================================================================

    function getNewEpisodesCount() {
        const seriesCheck = getSeriesCheck();
        let count = 0;
        for (const key in seriesCheck) {
            if (seriesCheck[key].has_new) count++;
        }
        return count;
    }

    function checkNewEpisodes(showNotify) {
        const c = cfg();
        if (!c.check_new_episodes) return;
        
        const favorites = getFavorites();
        const seriesToCheck = favorites.filter(f => 
            (f.category === CATEGORIES.LOOK || f.category === CATEGORIES.SCHEDULED) &&
            (f.media_type === 'tv' || f.data?.original_name)
        );
        
        if (seriesToCheck.length === 0) return;
        
        const seriesCheck = getSeriesCheck();
        const now = Date.now();
        let newFound = 0;
        
        seriesToCheck.forEach(item => {
            const baseId = getBaseTmdbId(item.tmdb_id);
            const lastCheck = seriesCheck[baseId]?.checked_at || 0;
            if (now - lastCheck < (c.new_episodes_check_interval * 60 * 60 * 1000)) return;
            
            const url = Lampa.TMDB.api('tv/' + baseId + '?api_key=' + Lampa.TMDB.key());
            $.ajax({
                url, method: 'GET', timeout: 10000,
                success: (data) => {
                    const newSeasons = data.number_of_seasons || 0;
                    const oldSeasons = seriesCheck[baseId]?.seasons_count || item.data?.number_of_seasons || 0;
                    const hasNew = newSeasons > oldSeasons && oldSeasons > 0;
                    
                    seriesCheck[baseId] = {
                        checked_at: now,
                        seasons_count: newSeasons,
                        old_seasons: oldSeasons,
                        new_seasons: newSeasons,
                        has_new: hasNew,
                        title: data.name || item.data?.title
                    };
                    
                    if (hasNew) newFound++;
                    saveSeriesCheck(seriesCheck);
                    
                    if (showNotify && hasNew && c.new_episodes_notify) {
                        notify(`🔔 Новый сезон: "${data.name}" S${newSeasons}`);
                    }
                },
                error: () => {}
            });
        });
        
        if (showNotify && newFound === 0) notify('✅ Новых серий нет');
    }

    function showNewEpisodes() {
        const seriesCheck = getSeriesCheck();
        const favorites = getFavorites();
        const newItems = [];
        
        for (const baseId in seriesCheck) {
            if (seriesCheck[baseId].has_new) {
                const item = favorites.find(f => getBaseTmdbId(f.tmdb_id) === baseId);
                if (item) newItems.push(item);
            }
        }
        
        if (newItems.length === 0) { notify('Новых серий нет'); return; }
        
        const selectItems = newItems.map(item => ({
            title: item.data?.title || item.data?.name,
            subtitle: `Новый сезон! S${seriesCheck[getBaseTmdbId(item.tmdb_id)].new_seasons}`,
            onSelect: () => {
                Lampa.Activity.push({
                    url: '', component: 'full',
                    id: item.card_id,
                    method: 'tv',
                    card: item.data
                });
                const check = seriesCheck[getBaseTmdbId(item.tmdb_id)];
                if (check) check.has_new = false;
                saveSeriesCheck(seriesCheck);
            }
        }));
        
        Lampa.Select.show({
            title: '🔔 Новые серии',
            items: selectItems,
            onBack: () => openMainMenu()
        });
    }

    //=================================================================
    // СТАТИСТИКА
    //=================================================================

    function showStatistics() {
        const timeline = getTimeline();
        let totalTime = 0;
        let totalMovies = 0;
        let totalEpisodes = 0;
        const topByTime = [];
        
        for (const key in timeline) {
            const tl = timeline[key];
            if (tl.duration && tl.percent) {
                const watchedTime = tl.duration * (tl.percent / 100);
                totalTime += watchedTime;
                if (key.includes('_s') && key.includes('_e')) totalEpisodes++;
                else totalMovies++;
                
                topByTime.push({ title: tl.title || 'Unknown', time: watchedTime });
            }
        }
        
        topByTime.sort((a, b) => b.time - a.time);
        const top5 = topByTime.slice(0, 5);
        const hours = Math.floor(totalTime / 3600);
        const minutes = Math.floor((totalTime % 3600) / 60);
        
        let statsHtml = `<div style="padding: 1em; line-height: 1.8;">
            <div><strong>Общее время:</strong> ${hours}ч ${minutes}м</div>
            <div><strong>Фильмов просмотрено:</strong> ${totalMovies}</div>
            <div><strong>Серий просмотрено:</strong> ${totalEpisodes}</div>
            <div style="margin-top: 1em;"><strong>Топ-5 по времени:</strong></div>
            <div style="font-size: 0.9em;">`;
        
        top5.forEach((item, i) => {
            const itemHours = Math.floor(item.time / 3600);
            const itemMins = Math.floor((item.time % 3600) / 60);
            statsHtml += `<div>${i+1}. ${item.title} — ${itemHours}ч ${itemMins}м</div>`;
        });
        
        statsHtml += `</div></div>`;
        
        Lampa.Modal.open({
            title: 'Статистика просмотров',
            html: $(statsHtml),
            size: 'medium',
            onBack: () => Lampa.Modal.close()
        });
    }

    //=================================================================
    // НАСТРОЙКИ
    //=================================================================

    function openSettings() {
        const c = cfg();
        
        Lampa.Select.show({
            title: 'Настройки Избранное+',
            items: [
                { title: `👁️ Авто-Смотрю: ${c.auto_watching ? 'Вкл' : 'Выкл'}`, action: 'toggle_watching' },
                { title: `📊 Порог Смотрю: ${c.watching_min_progress}% - ${c.watching_max_progress}%`, action: 'set_watching_range' },
                { title: `✅ Авто-Просмотрено: ${c.auto_watched ? 'Вкл' : 'Выкл'}`, action: 'toggle_watched' },
                { title: `📊 Порог Просмотрено: ${c.watched_min_progress}%`, action: 'set_watched_threshold' },
                { title: `❌ Авто-Брошено: ${c.auto_abandoned ? 'Вкл' : 'Выкл'}`, action: 'toggle_abandoned' },
                { title: `📅 Дней до Брошено: ${c.abandoned_days}`, action: 'set_abandoned_days' },
                { title: '──────────', separator: true },
                { title: `🔔 Новые серии: ${c.check_new_episodes ? 'Вкл' : 'Выкл'}`, action: 'toggle_new_episodes' },
                { title: `📢 Уведомления: ${c.new_episodes_notify ? 'Вкл' : 'Выкл'}`, action: 'toggle_new_episodes_notify' },
                { title: `⏱️ Интервал проверки: ${c.new_episodes_check_interval} ч`, action: 'set_check_interval' },
                { title: '──────────', separator: true },
                { title: `👁 Скрыть кнопку Lampa: ${c.hide_lampa_bookmark_button ? 'Да' : 'Нет'}`, action: 'toggle_hide_button' },
                { title: '──────────', separator: true },
                { title: `☁️ GitHub Gist`, action: 'gist_setup' },
                { title: '❌ Закрыть', action: 'close' }
            ],
            onSelect: (item) => {
                if (item.action === 'toggle_watching') { c.auto_watching = !c.auto_watching; saveCfg(c); openSettings(); }
                else if (item.action === 'toggle_watched') { c.auto_watched = !c.auto_watched; saveCfg(c); openSettings(); }
                else if (item.action === 'toggle_abandoned') { c.auto_abandoned = !c.auto_abandoned; saveCfg(c); openSettings(); }
                else if (item.action === 'toggle_new_episodes') { c.check_new_episodes = !c.check_new_episodes; saveCfg(c); openSettings(); }
                else if (item.action === 'toggle_new_episodes_notify') { c.new_episodes_notify = !c.new_episodes_notify; saveCfg(c); openSettings(); }
                else if (item.action === 'toggle_hide_button') { c.hide_lampa_bookmark_button = !c.hide_lampa_bookmark_button; saveCfg(c); applyHideLampaButton(); openSettings(); }
                else if (item.action === 'set_watching_range') setWatchingRange();
                else if (item.action === 'set_watched_threshold') setWatchedThreshold();
                else if (item.action === 'set_abandoned_days') setAbandonedDays();
                else if (item.action === 'set_check_interval') setCheckInterval();
                else if (item.action === 'gist_setup') showGistSetup();
            },
            onBack: () => openMainMenu()
        });
    }

    function setWatchingRange() {
        const c = cfg();
        Lampa.Input.edit({ title: 'Мин. прогресс для "Смотрю" (%)', value: String(c.watching_min_progress), free: true, number: true }, (val) => {
            if (val !== null && !isNaN(val) && val >= 0 && val <= 100) {
                c.watching_min_progress = parseInt(val);
                saveCfg(c);
            }
            openSettings();
        });
    }

    function setWatchedThreshold() {
        const c = cfg();
        Lampa.Input.edit({ title: 'Порог "Просмотрено" (%)', value: String(c.watched_min_progress), free: true, number: true }, (val) => {
            if (val !== null && !isNaN(val) && val >= 0 && val <= 100) {
                c.watched_min_progress = parseInt(val);
                saveCfg(c);
            }
            openSettings();
        });
    }

    function setAbandonedDays() {
        const c = cfg();
        Lampa.Input.edit({ title: 'Дней без просмотра до "Брошено"', value: String(c.abandoned_days), free: true, number: true }, (val) => {
            if (val !== null && !isNaN(val) && val > 0) {
                c.abandoned_days = parseInt(val);
                saveCfg(c);
            }
            openSettings();
        });
    }

    function setCheckInterval() {
        const c = cfg();
        Lampa.Input.edit({ title: 'Интервал проверки (часов)', value: String(c.new_episodes_check_interval), free: true, number: true }, (val) => {
            if (val !== null && !isNaN(val) && val > 0) {
                c.new_episodes_check_interval = parseInt(val);
                saveCfg(c);
            }
            openSettings();
        });
    }

    function showGistSetup() {
        const c = cfg();
        
        Lampa.Select.show({
            title: '☁️ GitHub Gist',
            items: [
                { title: `🔑 Токен: ${c.gist_token ? '✓ Установлен' : '❌ Не установлен'}`, action: 'token' },
                { title: `📄 Gist ID: ${c.gist_id ? c.gist_id.substring(0, 8) + '…' : '❌ Не установлен'}`, action: 'id' },
                { title: '──────────', separator: true },
                { title: '📤 Синхронизировать на Gist', action: 'upload' },
                { title: '📥 Загрузить с Gist', action: 'download' },
                { title: '◀ Назад', action: 'back' }
            ],
            onSelect: (item) => {
                if (item.action === 'token') {
                    Lampa.Input.edit({ title: 'GitHub Token', value: c.gist_token || '', free: true }, (val) => {
                        if (val !== null) { c.gist_token = val; saveCfg(c); }
                        showGistSetup();
                    });
                } else if (item.action === 'id') {
                    Lampa.Input.edit({ title: 'Gist ID', value: c.gist_id || '', free: true }, (val) => {
                        if (val !== null) { c.gist_id = val; saveCfg(c); }
                        showGistSetup();
                    });
                } else if (item.action === 'upload') {
                    syncToGist('favorites', true);
                    syncToGist('timeline', true);
                    setTimeout(() => showGistSetup(), 1500);
                } else if (item.action === 'download') {
                    syncFromGist(true);
                    setTimeout(() => showGistSetup(), 1500);
                } else if (item.action === 'back') openSettings();
            },
            onBack: () => openSettings()
        });
    }

    function syncFromGist(showNotify) {
        const gist = getGistData();
        if (!gist) { if (showNotify) notify('GitHub Gist не настроен'); return; }
        
        syncingFromGist = true;
        
        $.ajax({
            url: `https://api.github.com/gists/${gist.id}`,
            method: 'GET',
            headers: { 'Authorization': `token ${gist.token}`, 'Accept': 'application/vnd.github.v3+json' },
            success: (data) => {
                try {
                    const favContent = data.files['favplus_favorites.json']?.content;
                    if (favContent) {
                        const favData = JSON.parse(favContent);
                        if (favData.favorites) saveFavorites(favData.favorites);
                    }
                    const timeContent = data.files['favplus_timeline.json']?.content;
                    if (timeContent) {
                        const timeData = JSON.parse(timeContent);
                        if (timeData.timeline) saveTimeline(timeData.timeline);
                    }
                    if (showNotify) notify('Данные загружены с Gist');
                } catch(e) { if (showNotify) notify('Ошибка чтения данных'); }
                syncingFromGist = false;
            },
            error: () => { syncingFromGist = false; if (showNotify) notify('Ошибка загрузки'); },
            timeout: 20000
        });
    }

    function applyHideLampaButton() {
        if (cfg().hide_lampa_bookmark_button) {
            $('.button--book').addClass('favplus-hidden');
        } else {
            $('.favplus-hidden').removeClass('favplus-hidden');
        }
    }

    //=================================================================
    // ИНИЦИАЛИЗАЦИЯ
    //=================================================================

    function init() {
        console.log(`[FavPlus] Initializing v${CONFIG.version} for profile: ${PROFILE_ID}`);

        $('<style>').text(`
            .favplus-hidden { display: none !important; }
            .favplus-favorite-btn { position: relative; }
            .favplus-status-badge { 
                position: absolute;
                top: -5px;
                right: -5px;
                background: #f44336;
                color: white;
                border-radius: 10px;
                padding: 0 5px;
                font-size: 10px;
                line-height: 16px;
                min-width: 16px;
                text-align: center;
                font-weight: bold;
            }
        `).appendTo('head');
        
        loadData();
        initPlayerHandler();
        addMenuItem();
        addStatusToCard();
        addFavoriteButtonToFullPage();
        applyHideLampaButton();
        
        $('<style>').text('.favplus-hidden{display:none!important}').appendTo('head');
        
        setTimeout(() => syncFromFileView(), 3000);
        setTimeout(() => checkNewEpisodes(false), 5000);
        
        Lampa.Listener.follow('full', (e) => {
            if (e.type === 'complite' && e.data?.movie) {
                setTimeout(() => syncFromFileView(), 2000);
            }
        });
        
        window.FavPlus = {
            cfg, getFavorites, getTimeline,
            addToCategory, removeFromCategory, getPrimaryCategory,
            syncFromFileView, checkNewEpisodes
        };
    }

    if (window.appready) init();
    else Lampa.Listener.follow('app', (e) => { if (e.type === 'ready') init(); });
})();
