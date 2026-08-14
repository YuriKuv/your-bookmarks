(function() {
    'use strict';

    if (window.timeline_gist_sync_v5) return;
    window.timeline_gist_sync_v5 = true;

    // ============== КОНФИГУРАЦИЯ ==============
    const PLUGIN_NAME = 'TimelineSyncV5';
    const CFG_KEY = 'timeline_gist_config_v4'; // Используем тот же ключ что и V4
    const GIST_API = 'https://api.github.com/gists';
    const SYNC_INTERVAL = 300000; // 5 минут (было 30 сек)
    const LOAD_INTERVAL = 600000; // 10 минут (было 60 сек)
    const SAVE_DEBOUNCE = 10000;  // 10 секунд ожидания (было 2 сек)
    const DEBUG = true;

    // ============== ЛОГГИРОВАНИЕ ==============
    const log = (...args) => DEBUG && console.log(`[${PLUGIN_NAME}]`, ...args);
    const logError = (...args) => console.error(`[${PLUGIN_NAME}] ERROR:`, ...args);

    // ============== КОНФИГ ==============
    function getConfig() {
        return Lampa.Storage.get(CFG_KEY, {
            token: '',
            gistId: '',
            lastSync: 0,
            autoSync: true,
            cleanEnabled: false,
            cleanMaxCount: 5000,
            cleanPercentThreshold: 95,
            cleanDaysThreshold: 90,
            cleanSeriesOnly: true
        });
    }

    function saveConfig(cfg) {
        Lampa.Storage.set(CFG_KEY, cfg);
    }

    function notify(text) {
        Lampa.Noty.show(text);
    }

    // ============== PROFILE ID ==============
    function getProfileId() {
        try {
            const account = Lampa.Storage.get('account', {});
            return String((account.profile || {}).id || '');
        } catch(e) {
            return '';
        }
    }

    // ============== КЛЮЧ ХРАНИЛИЩА ==============
    function getTimelineKey() {
        const profileId = getProfileId();
        const profileKey = profileId ? 'file_view_' + profileId : 'file_view';
        
        const baseData = Lampa.Storage.get('file_view', null);
        const profileData = profileId ? Lampa.Storage.get(profileKey, null) : null;
        
        if (profileData && typeof profileData === 'object' && Object.keys(profileData).length > 0) {
            return profileKey;
        }
        
        if (baseData && typeof baseData === 'object' && Object.keys(baseData).length > 0) {
            return 'file_view';
        }
        
        return profileKey;
    }

    // ============== ХЕШ-ФУНКЦИЯ ==============
    function lampaHash(input) {
        let str = (input || '') + '';
        let hash = 0;
        
        if (str.length === 0) return hash;
        
        for (let i = 0; i < str.length; i++) {
            let char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        
        return Math.abs(hash) + '';
    }

    function generateHash(movie, season, episode) {
        if (!movie) return null;
        
        try {
            let hashString;
            
            if (movie.original_name) {
                const s = season || 1;
                const e = episode || 1;
                hashString = s + (s > 10 ? ':' : '') + e + movie.original_name;
            } else if (movie.original_title) {
                hashString = movie.original_title;
            } else if (movie.title) {
                hashString = movie.title;
            } else {
                return null;
            }
            
            return lampaHash(hashString);
        } catch(e) {
            logError('Hash error:', e);
            return null;
        }
    }

    // ============== ПОЛУЧЕНИЕ ВСЕХ ТАЙМЛАЙНОВ (ОПТИМИЗИРОВАНО) ==============
    function getAllTimelines() {
        const result = {};
        
        const keys = ['file_view'];
        const profileId = getProfileId();
        if (profileId) {
            keys.push('file_view_' + profileId);
        }
        
        keys.forEach(key => {
            try {
                const data = Lampa.Storage.get(key, {});
                
                if (typeof data === 'object' && data !== null) {
                    for (const hash in data) {
                        const item = data[hash];
                        if (!item || typeof item === 'number') continue;
                        
                        const updated = item.updated || 0;
                        
                        if (!result[hash] || updated > (result[hash].updated || 0)) {
                            result[hash] = {
                                time: Math.round(item.time || 0),
                                duration: Math.round(item.duration || 0),
                                percent: Math.round(item.percent || 0),
                                updated: updated
                            };
                        }
                    }
                }
            } catch(e) {
                logError(`Error reading ${key}:`, e);
            }
        });
        
        return result;
    }

    // ============== СОХРАНЕНИЕ ВО ВСЕ КЛЮЧИ (ОПТИМИЗИРОВАНО) ==============
    function saveToAllKeys(hash, time, duration, percent) {
        const keys = ['file_view'];
        const profileId = getProfileId();
        if (profileId) {
            keys.push('file_view_' + profileId);
        }
        
        keys.forEach(key => {
            try {
                const data = Lampa.Storage.get(key, {});
                data[hash] = {
                    time: Math.round(time),
                    duration: Math.round(duration || 0),
                    percent: Math.round(percent || 0),
                    updated: Date.now()
                };
                Lampa.Storage.set(key, data);
            } catch(e) {
                logError(`Error saving to ${key}:`, e);
            }
        });
    }

    // ============== УМНАЯ ОЧИСТКА ==============
    function cleanTimelines(timelines) {
        const cfg = getConfig();
        
        if (!cfg.cleanEnabled) {
            return timelines;
        }
        
        const now = Date.now();
        const cleaned = {};
        const seriesEpisodes = {};
        
        // Получаем карточки для определения сериалов
        const favoriteCards = getFavoriteCards();
        
        // Создаем карту сериалов
        favoriteCards.forEach(card => {
            if (card.original_name) {
                const seasons = card.number_of_seasons || 1;
                const episodes = card.number_of_episodes || 24;
                
                for (let s = 1; s <= seasons; s++) {
                    for (let e = 1; e <= episodes; e++) {
                        const hash = generateHash(card, s, e);
                        if (hash) {
                            seriesEpisodes[hash] = {
                                cardId: card.id,
                                seriesName: card.original_name,
                                season: s,
                                episode: e,
                                totalSeasons: seasons,
                                totalEpisodes: episodes
                            };
                        }
                    }
                }
            }
        });
        
        // Сортируем по дате обновления (новые первыми)
        const sortedHashes = Object.keys(timelines).sort((a, b) => {
            return (timelines[b].updated || 0) - (timelines[a].updated || 0);
        });
        
        let count = 0;
        
        sortedHashes.forEach(hash => {
            const item = timelines[hash];
            let shouldRemove = false;
            
            // 1. Проверяем количество
            if (cfg.cleanMaxCount > 0 && count >= cfg.cleanMaxCount) {
                shouldRemove = true;
            }
            
            // 2. Проверяем процент просмотра
            if (!shouldRemove && cfg.cleanPercentThreshold > 0) {
                if (item.percent >= cfg.cleanPercentThreshold) {
                    if (seriesEpisodes[hash]) {
                        const seriesInfo = seriesEpisodes[hash];
                        let allWatched = true;
                        const seriesCard = favoriteCards.find(c => c.id === seriesInfo.cardId);
                        
                        if (seriesCard && cfg.cleanSeriesOnly) {
                            const seasons = seriesInfo.totalSeasons;
                            const episodes = seriesInfo.totalEpisodes;
                            
                            for (let s = 1; s <= seasons && allWatched; s++) {
                                for (let e = 1; e <= episodes && allWatched; e++) {
                                    const epHash = generateHash(seriesCard, s, e);
                                    if (epHash && (!timelines[epHash] || timelines[epHash].percent < cfg.cleanPercentThreshold)) {
                                        allWatched = false;
                                    }
                                }
                            }
                        }
                        
                        if (allWatched || !cfg.cleanSeriesOnly) {
                            shouldRemove = true;
                        }
                    } else {
                        shouldRemove = true;
                    }
                }
            }
            
            // 3. Проверяем давность
            if (!shouldRemove && cfg.cleanDaysThreshold > 0) {
                const daysPassed = (now - (item.updated || 0)) / (1000 * 60 * 60 * 24);
                if (daysPassed >= cfg.cleanDaysThreshold) {
                    shouldRemove = true;
                }
            }
            
            if (!shouldRemove) {
                cleaned[hash] = item;
                count++;
            }
        });
        
        log(`Cleaned: ${Object.keys(timelines).length} -> ${Object.keys(cleaned).length}`);
        return cleaned;
    }

    // ============== ПОЛУЧЕНИЕ КАРТОЧЕК ИЗ FAVORITE (ОПТИМИЗИРОВАНО) ==============
    let favoriteCache = null;
    let favoriteCacheTime = 0;

    function getFavoriteCards() {
        // Кешируем на 5 минут
        if (favoriteCache && Date.now() - favoriteCacheTime < 300000) {
            return favoriteCache;
        }
        
        const cards = [];
        
        try {
            if (Lampa.Favorite && Lampa.Favorite.full) {
                const fav = Lampa.Favorite.full();
                if (fav.card && Array.isArray(fav.card)) {
                    cards.push(...fav.card);
                }
            }
            
            const favData = Lampa.Storage.get('favorite', {});
            if (favData.card && Array.isArray(favData.card)) {
                favData.card.forEach(card => {
                    if (!cards.find(c => c.id === card.id)) {
                        cards.push(card);
                    }
                });
            }
            
            if (Lampa.Account && Lampa.Account.Bookmarks && Lampa.Account.Bookmarks.all) {
                const bookmarks = Lampa.Account.Bookmarks.all();
                if (Array.isArray(bookmarks)) {
                    bookmarks.forEach(card => {
                        if (!cards.find(c => c.id === card.id)) {
                            cards.push(card);
                        }
                    });
                }
            }
        } catch(e) {
            logError('Error getting favorite cards:', e);
        }
        
        favoriteCache = cards;
        favoriteCacheTime = Date.now();
        
        return cards;
    }

    // ============== GIST API (АСИНХРОННО) ==============
    let syncInProgress = false;
    let syncQueue = [];

    function processSyncQueue() {
        if (syncQueue.length === 0 || syncInProgress) return;
        
        const task = syncQueue.shift();
        syncInProgress = true;
        
        task.fn()
            .finally(() => {
                syncInProgress = false;
                // Пауза перед следующей задачей
                setTimeout(() => processSyncQueue(), 1000);
            });
    }

    function queueTask(fn) {
        syncQueue.push({ fn });
        if (!syncInProgress) {
            processSyncQueue();
        }
    }

    function syncToGistAsync(showNotify = false) {
        return new Promise((resolve, reject) => {
            queueTask(() => {
                return new Promise((res, rej) => {
                    const cfg = getConfig();
                    
                    if (!cfg.token || !cfg.gistId) {
                        res(false);
                        return;
                    }
                    
                    let timelines = getAllTimelines();
                    
                    if (cfg.cleanEnabled) {
                        timelines = cleanTimelines(timelines);
                    }
                    
                    const count = Object.keys(timelines).length;
                    
                    if (count === 0) {
                        res(false);
                        return;
                    }
                    
                    log(`Syncing ${count} timelines to Gist...`);
                    
                    const gistData = {
                        description: 'Lampa Timeline Sync',
                        public: false,
                        files: {
                            'timeline.json': {
                                content: JSON.stringify({
                                    updated: new Date().toISOString(),
                                    count: count,
                                    timelines: timelines
                                })
                            }
                        }
                    };
                    
                    fetch(`${GIST_API}/${cfg.gistId}`, {
                        method: 'PATCH',
                        headers: {
                            'Authorization': `token ${cfg.token}`,
                            'Accept': 'application/vnd.github.v3+json',
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(gistData)
                    })
                    .then(response => {
                        if (response.status === 404) {
                            return createGist(timelines);
                        }
                        if (!response.ok) {
                            throw new Error(`HTTP ${response.status}`);
                        }
                        return response.json();
                    })
                    .then(() => {
                        cfg.lastSync = Date.now();
                        saveConfig(cfg);
                        if (showNotify) notify(`✅ Синхронизировано ${count}`);
                        log('Sync completed');
                        res(true);
                    })
                    .catch(err => {
                        logError('Sync error:', err);
                        if (showNotify) notify('❌ Ошибка синхронизации');
                        rej(err);
                    });
                });
            });
            
            // Резолвим сразу, не ждем завершения
            resolve(true);
        });
    }

    function createGist(timelines) {
        const cfg = getConfig();
        const count = Object.keys(timelines).length;
        
        return fetch(GIST_API, {
            method: 'POST',
            headers: {
                'Authorization': `token ${cfg.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                description: 'Lampa Timeline Sync',
                public: false,
                files: {
                    'timeline.json': {
                        content: JSON.stringify({
                            updated: new Date().toISOString(),
                            count: count,
                            timelines: timelines
                        })
                    }
                }
            })
        })
        .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        })
        .then(data => {
            cfg.gistId = data.id;
            cfg.lastSync = Date.now();
            saveConfig(cfg);
            notify(`✅ Gist создан: ${data.id}`);
            log('Gist created:', data.id);
        });
    }

    function syncFromGistAsync(showNotify = false) {
        return new Promise((resolve, reject) => {
            queueTask(() => {
                return new Promise((res, rej) => {
                    const cfg = getConfig();
                    
                    if (!cfg.token || !cfg.gistId) {
                        res(false);
                        return;
                    }
                    
                    log('Loading from Gist...');
                    
                    fetch(`${GIST_API}/${cfg.gistId}`, {
                        headers: {
                            'Authorization': `token ${cfg.token}`,
                            'Accept': 'application/vnd.github.v3+json'
                        }
                    })
                    .then(response => {
                        if (!response.ok) throw new Error(`HTTP ${response.status}`);
                        return response.json();
                    })
                    .then(data => {
                        const content = data.files?.['timeline.json']?.content;
                        if (!content) {
                            res(false);
                            return;
                        }
                        
                        const remote = JSON.parse(content);
                        const remoteTimelines = remote.timelines || {};
                        const remoteCount = Object.keys(remoteTimelines).length;
                        
                        log(`Gist has ${remoteCount} timelines`);
                        
                        if (remoteCount === 0) {
                            res(false);
                            return;
                        }
                        
                        // Применяем небольшими партиями
                        const hashes = Object.keys(remoteTimelines);
                        const batchSize = 50;
                        let applied = 0;
                        
                        function applyBatch(startIndex) {
                            if (startIndex >= hashes.length) {
                                log(`Applied ${applied} timelines`);
                                
                                if (applied > 0) {
                                    refreshUIAsync();
                                    if (showNotify) notify(`📥 Загружено ${applied}`);
                                }
                                
                                cfg.lastSync = Date.now();
                                saveConfig(cfg);
                                res(true);
                                return;
                            }
                            
                            const endIndex = Math.min(startIndex + batchSize, hashes.length);
                            
                            for (let i = startIndex; i < endIndex; i++) {
                                const hash = hashes[i];
                                const item = remoteTimelines[hash];
                                
                                saveToAllKeys(hash, item.time, item.duration, item.percent);
                                
                                if (Lampa.Timeline && typeof Lampa.Timeline.update === 'function') {
                                    try {
                                        Lampa.Timeline.update({
                                            hash: hash,
                                            time: Math.round(item.time || 0),
                                            duration: Math.round(item.duration || 0),
                                            percent: Math.round(item.percent || 0),
                                            force: true
                                        });
                                        applied++;
                                    } catch(e) {
                                        // Игнорируем ошибки применения
                                    }
                                }
                            }
                            
                            // Пауза между партиями для освобождения UI
                            setTimeout(() => applyBatch(endIndex), 100);
                        }
                        
                        applyBatch(0);
                    })
                    .catch(err => {
                        logError('Load error:', err);
                        if (showNotify) notify('❌ Ошибка загрузки');
                        rej(err);
                    });
                });
            });
            
            resolve(true);
        });
    }

    // ============== ОБНОВЛЕНИЕ ИНТЕРФЕЙСА (АСИНХРОННО) ==============
    function refreshUIAsync() {
        setTimeout(() => {
            try {
                if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
                    Lampa.Timeline.read(true);
                }
                
                if (Lampa.Favorite && typeof Lampa.Favorite.read === 'function') {
                    Lampa.Favorite.read(true);
                }
                
                if (Lampa.Listener) {
                    Lampa.Listener.send('state:changed', {
                        target: 'timeline',
                        reason: 'refresh'
                    });
                }
                
                updateTimelineDOM();
                
                const activity = Lampa.Activity.active();
                if (activity && activity.activity) {
                    if (typeof activity.activity.render === 'function') {
                        activity.activity.render();
                    }
                }
            } catch(e) {
                logError('Refresh UI error:', e);
            }
        }, 300);
    }

    function updateTimelineDOM() {
        try {
            const layers = Lampa.Activity.renderLayers ? Lampa.Activity.renderLayers() : [];
            layers.push($(document));
            
            layers.forEach(layer => {
                $('.time-line', layer).each(function() {
                    const hash = $(this).data('hash');
                    if (hash && Lampa.Timeline) {
                        const timeline = Lampa.Timeline.view(hash);
                        if (timeline && timeline.percent > 0) {
                            $(this).toggleClass('hide', false);
                            $('> div', this).css('width', timeline.percent + '%');
                        }
                    }
                });
            });
        } catch(e) {
            // Игнорируем ошибки DOM
        }
    }

    // ============== ОБРАБОТЧИКИ СОБЫТИЙ (С DEBOUNCE) ==============
    let saveTimer = null;
    let lastSaveTime = 0;

    function scheduleSync() {
        const now = Date.now();
        
        // Минимальный интервал между синхронизациями - 30 секунд
        if (now - lastSaveTime < 30000) {
            return;
        }
        
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            const cfg = getConfig();
            if (cfg.token && cfg.gistId && cfg.autoSync) {
                lastSaveTime = Date.now();
                syncToGistAsync(false);
            }
        }, SAVE_DEBOUNCE);
    }

    function initListeners() {
        // Слушаем изменения таймлайна (с debounce)
        Lampa.Listener.follow('timeline', function(e) {
            if (e.type === 'update') {
                scheduleSync();
            }
        });
        
        // Слушаем изменения хранилища
        Lampa.Storage.listener.follow('change', function(e) {
            if (e.name === 'file_view' || e.name.startsWith('file_view_')) {
                scheduleSync();
            }
        });
        
        // При открытии контента - НЕ загружаем автоматически
        // Только при старте приложения и по таймеру
        
        // При закрытии плеера - отложенная синхронизация
        Lampa.Player.listener.follow('destroy', function() {
            setTimeout(() => {
                const cfg = getConfig();
                if (cfg.token && cfg.gistId && cfg.autoSync) {
                    lastSaveTime = Date.now();
                    syncToGistAsync(false);
                }
            }, 3000);
        });
        
        log('Listeners initialized');
    }

    // ============== ПЕРИОДИЧЕСКАЯ СИНХРОНИЗАЦИЯ (РЕДКАЯ) ==============
    function startPeriodicSync() {
        // Выгрузка каждые 5 минут
        setInterval(() => {
            const cfg = getConfig();
            if (cfg.token && cfg.gistId && cfg.autoSync) {
                const timelines = getAllTimelines();
                if (Object.keys(timelines).length > 0) {
                    lastSaveTime = Date.now();
                    syncToGistAsync(false);
                }
            }
        }, SYNC_INTERVAL);
        
        // Загрузка каждые 10 минут
        setInterval(() => {
            const cfg = getConfig();
            if (cfg.token && cfg.gistId && cfg.autoSync) {
                syncFromGistAsync(false);
            }
        }, LOAD_INTERVAL);
        
        log('Periodic sync started (5min upload, 10min download)');
    }

    // ============== МЕНЮ НАСТРОЕК ==============
    function showSetupMenu() {
        const cfg = getConfig();
        const timelines = getAllTimelines();
        const count = Object.keys(timelines).length;
        const lastSync = cfg.lastSync ? new Date(cfg.lastSync).toLocaleString() : 'Никогда';
        const currentKey = getTimelineKey();
        
        Lampa.Select.show({
            title: '☁️ Gist Sync V5',
            items: [
                { title: '🔑 Токен: ' + (cfg.token ? '✅' : '❌'), action: 'token' },
                { title: '📄 Gist ID: ' + (cfg.gistId ? cfg.gistId.substring(0, 8) + '…' : '❌'), action: 'gist_id' },
                { title: '──────────', separator: true },
                { title: '📊 Таймлайнов: ' + count, action: 'info' },
                { title: '🔑 Ключ: ' + currentKey, action: 'info' },
                { title: '🕐 Синхр.: ' + lastSync, action: 'info' },
                { title: '──────────', separator: true },
                { title: '📤 Выгрузить', action: 'upload' },
                { title: '📥 Загрузить', action: 'download' },
                { title: '──────────', separator: true },
                { title: '🧹 Автоочистка: ' + (cfg.cleanEnabled ? '✅' : '❌'), action: 'toggle_clean' },
                { title: '⚙️ Настройки очистки', action: 'clean_settings' },
                { title: '──────────', separator: true },
                { title: '🔄 Авто: ' + (cfg.autoSync ? '✅' : '❌'), action: 'toggle' },
                { title: '──────────', separator: true },
                { title: '🔄 Обновить UI', action: 'refresh' },
                { title: '❌ Закрыть', action: 'close' }
            ],
            onSelect: function(item) {
                const newCfg = getConfig();
                
                switch(item.action) {
                    case 'token':
                        Lampa.Input.edit({
                            title: 'GitHub Token',
                            value: cfg.token,
                            nosave: true
                        }, function(val) {
                            if (val !== null) {
                                newCfg.token = val.trim();
                                saveConfig(newCfg);
                                notify('Токен сохранён');
                            }
                            showSetupMenu();
                        });
                        break;
                        
                    case 'gist_id':
                        Lampa.Input.edit({
                            title: 'Gist ID',
                            value: cfg.gistId,
                            nosave: true
                        }, function(val) {
                            if (val !== null) {
                                newCfg.gistId = val.trim();
                                saveConfig(newCfg);
                                notify('Gist ID сохранён');
                            }
                            showSetupMenu();
                        });
                        break;
                        
                    case 'upload':
                        Lampa.Loading.start();
                        syncToGistAsync(true);
                        setTimeout(() => {
                            Lampa.Loading.stop();
                            showSetupMenu();
                        }, 1000);
                        break;
                        
                    case 'download':
                        Lampa.Loading.start();
                        syncFromGistAsync(true);
                        setTimeout(() => {
                            Lampa.Loading.stop();
                            showSetupMenu();
                        }, 1000);
                        break;
                        
                    case 'toggle_clean':
                        newCfg.cleanEnabled = !newCfg.cleanEnabled;
                        saveConfig(newCfg);
                        notify('Автоочистка ' + (newCfg.cleanEnabled ? 'включена' : 'выключена'));
                        showSetupMenu();
                        break;
                        
                    case 'clean_settings':
                        showCleanSettings();
                        break;
                        
                    case 'toggle':
                        newCfg.autoSync = !newCfg.autoSync;
                        saveConfig(newCfg);
                        notify('Автосинхронизация ' + (newCfg.autoSync ? 'включена' : 'выключена'));
                        showSetupMenu();
                        break;
                        
                    case 'refresh':
                        refreshUIAsync();
                        notify('🔄 UI обновлён');
                        setTimeout(showSetupMenu, 500);
                        break;
                        
                    default:
                        showSetupMenu();
                        break;
                }
            },
            onBack: function() {
                Lampa.Controller.toggle('content');
            }
        });
    }

    // ============== НАСТРОЙКИ ОЧИСТКИ ==============
    function showCleanSettings() {
        const cfg = getConfig();
        
        Lampa.Select.show({
            title: '⚙️ Настройки очистки',
            items: [
                { 
                    title: '📊 Макс. таймлайнов: ' + (cfg.cleanMaxCount > 0 ? cfg.cleanMaxCount : '∞'), 
                    action: 'max_count' 
                },
                { 
                    title: '📈 Порог %: ' + (cfg.cleanPercentThreshold > 0 ? cfg.cleanPercentThreshold + '%' : 'Выкл'), 
                    action: 'percent' 
                },
                { 
                    title: '📅 Дней хранения: ' + (cfg.cleanDaysThreshold > 0 ? cfg.cleanDaysThreshold : 'Выкл'), 
                    action: 'days' 
                },
                { 
                    title: '📺 Сериалы целиком: ' + (cfg.cleanSeriesOnly ? '✅' : '❌'), 
                    action: 'series_only' 
                },
                { title: '──────────', separator: true },
                { title: '❌ Назад', action: 'back' }
            ],
            onSelect: function(item) {
                const newCfg = getConfig();
                
                switch(item.action) {
                    case 'max_count':
                        Lampa.Input.edit({
                            title: 'Максимум таймлайнов (0 = без ограничений)',
                            value: String(newCfg.cleanMaxCount || 0),
                            nosave: true,
                            layout: 'nums'
                        }, function(val) {
                            if (val !== null) {
                                const num = parseInt(val) || 0;
                                newCfg.cleanMaxCount = num < 0 ? 0 : num;
                                saveConfig(newCfg);
                                notify('Максимум: ' + newCfg.cleanMaxCount);
                            }
                            showCleanSettings();
                        });
                        break;
                        
                    case 'percent':
                        Lampa.Input.edit({
                            title: 'Порог процента (0 = выкл, 1-100)',
                            value: String(newCfg.cleanPercentThreshold || 0),
                            nosave: true,
                            layout: 'nums'
                        }, function(val) {
                            if (val !== null) {
                                const num = parseInt(val) || 0;
                                newCfg.cleanPercentThreshold = num < 0 ? 0 : (num > 100 ? 100 : num);
                                saveConfig(newCfg);
                                notify('Порог: ' + newCfg.cleanPercentThreshold + '%');
                            }
                            showCleanSettings();
                        });
                        break;
                        
                    case 'days':
                        Lampa.Input.edit({
                            title: 'Дней хранения (0 = выкл)',
                            value: String(newCfg.cleanDaysThreshold || 0),
                            nosave: true,
                            layout: 'nums'
                        }, function(val) {
                            if (val !== null) {
                                const num = parseInt(val) || 0;
                                newCfg.cleanDaysThreshold = num < 0 ? 0 : num;
                                saveConfig(newCfg);
                                notify('Дней: ' + newCfg.cleanDaysThreshold);
                            }
                            showCleanSettings();
                        });
                        break;
                        
                    case 'series_only':
                        newCfg.cleanSeriesOnly = !newCfg.cleanSeriesOnly;
                        saveConfig(newCfg);
                        notify('Сериалы целиком: ' + (newCfg.cleanSeriesOnly ? 'включено' : 'выключено'));
                        showCleanSettings();
                        break;
                        
                    case 'back':
                        showSetupMenu();
                        break;
                }
            },
            onBack: function() {
                showSetupMenu();
            }
        });
    }

    // ============== ДОБАВЛЕНИЕ В МЕНЮ ==============
    function addMenuButton() {
        try {
            if (Lampa.SettingsApi) {
                Lampa.SettingsApi.addComponent({
                    component: 'timeline_gist_v5',
                    name: 'Gist Sync V5',
                    icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M13,7H11V13H17V11H13V7Z"/></svg>'
                });
                
                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist_v5',
                    param: { name: 'timeline_gist_v5_setup', type: 'button' },
                    field: {
                        name: 'Настройка Gist',
                        description: 'Синхронизация таймлайнов V5'
                    },
                    onChange: showSetupMenu
                });
                
                log('Added to Settings API');
                return;
            }
        } catch(e) {
            logError('Settings API error:', e);
        }
        
        setTimeout(() => {
            const menuList = $('.menu__list').eq(0);
            if (!menuList.length) return;
            
            if ($('.timeline-gist-v5-menu').length) return;
            
            const menuItem = $(`
                <li class="menu__item selector timeline-gist-v5-menu">
                    <div class="menu__ico">
                        <svg viewBox="0 0 24 24" width="20" height="20">
                            <path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M13,7H11V13H17V11H13V7Z"/>
                        </svg>
                    </div>
                    <div class="menu__text">Gist Sync V5</div>
                </li>
            `);
            
            menuItem.on('hover:enter', showSetupMenu);
            menuList.append(menuItem);
            
            log('Added to main menu');
        }, 2000);
    }

    // ============== ИНИЦИАЛИЗАЦИЯ ==============
    function init() {
        log('========================================');
        log('V5 Starting (Optimized)...');
        log('Storage key:', getTimelineKey());
        log('Profile ID:', getProfileId() || 'none');
        
        const timelines = getAllTimelines();
        log('Local timelines:', Object.keys(timelines).length);
        log('========================================');
        
        initListeners();
        startPeriodicSync();
        
        // Загружаем при старте ОДИН раз
        const cfg = getConfig();
        if (cfg.token && cfg.gistId) {
            setTimeout(() => {
                syncFromGistAsync(false);
            }, 5000); // Через 5 секунд после старта
        }
        
        addMenuButton();
        
        log('V5 Ready!');
    }

    // ============== ЗАПУСК ==============
    if (window.appready) {
        init();
    } else {
        Lampa.Listener.follow('app', function(e) {
            if (e.type === 'ready') {
                init();
            }
        });
    }

})();
