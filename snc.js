(function() {
    'use strict';

    if (window.timeline_gist_loaded) return;
    window.timeline_gist_loaded = true;

    // ============== КОНФИГУРАЦИЯ ==============
    const CFG_KEY = 'timeline_gist_config';
    const GIST_API = 'https://api.github.com/gists';
    const SYNC_INTERVAL = 60000;
    const SAVE_DELAY = 2000;
    const DEBUG = true;

    // ============== НАСТРОЙКИ АВТООЧИСТКИ ==============
    const DEFAULT_CLEANUP_CONFIG = {
        enabled: false,
        maxCount: 500,           // Максимальное количество таймлайнов в Gist
        percentThreshold: 100,    // Удалять если процент просмотра >= этого значения (0-100)
        daysThreshold: 30,        // Удалять если прошло больше дней с последнего обновления
        keepWatching: true,       // Не удалять если сериал в процессе просмотра (не все серии просмотрены)
        autoCleanupOnSync: false // Автоматически очищать при каждой синхронизации
    };

    // ============== ЛОГГИРОВАНИЕ ==============
    function log() {
        if (DEBUG) {
            console.log.apply(console, ['[TimelineSync]'].concat(Array.from(arguments)));
        }
    }

    function logError() {
        console.error.apply(console, ['[TimelineSync] ERROR:'].concat(Array.from(arguments)));
    }

    // ============== ПОЛУЧЕНИЕ ID ПРОФИЛЯ ==============
    function getProfileId() {
        try {
            const account = Lampa.Storage.get('account', {});
            const profile = account.profile || {};
            return String(profile.id || '');
        } catch(e) {
            return '';
        }
    }

    // ============== ПОЛУЧЕНИЕ ВСЕХ КЛЮЧЕЙ ТАЙМЛАЙНОВ ==============
    function getAllTimelineKeys() {
        const keys = ['file_view'];
        const profileId = getProfileId();
        if (profileId) {
            keys.push('file_view_' + profileId);
        }
        
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('nsl_timeline_')) {
                if (!keys.includes(k)) {
                    keys.push(k);
                }
            }
        }
        
        return keys;
    }

    // ============== ОЧИСТКА СТАРЫХ ДАННЫХ ==============
    function cleanupOldData() {
        let cleaned = 0;
        const keysToRemove = [];
        
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && (
                k.startsWith('nsl_timeline_') || 
                k.startsWith('nsl_autobackup_') ||
                k.startsWith('nsl_hash_map_') ||
                k === 'timeline_gist_data'
            )) {
                keysToRemove.push(k);
            }
        }
        
        keysToRemove.forEach(key => {
            try {
                localStorage.removeItem(key);
                cleaned++;
                log('Removed old key:', key);
            } catch(e) {
                logError('Error removing', key, ':', e);
            }
        });
        
        if (cleaned > 0) {
            log('Cleaned up', cleaned, 'old keys');
        }
        return cleaned;
    }

    // ============== ПОЛУЧЕНИЕ ВСЕХ ТАЙМЛАЙНОВ ==============
    function getAllTimelines() {
        const allTimelines = {};
        const now = Date.now();
        const keys = getAllTimelineKeys();
        
        keys.forEach(key => {
            try {
                const data = Lampa.Storage.get(key, {});
                if (typeof data === 'object' && data !== null) {
                    for (const hash in data) {
                        const item = data[hash];
                        if (!item || !item.time || item.time <= 0) continue;
                        
                        const updated = item.updated || item.timestamp || now;
                        
                        if (allTimelines[hash]) {
                            if (updated > allTimelines[hash].updatedAt) {
                                allTimelines[hash] = {
                                    time: Math.round(item.time),
                                    duration: Math.round(item.duration || 0),
                                    percent: Math.round(item.percent || 0),
                                    updatedAt: updated,
                                    source: key
                                };
                            }
                        } else {
                            allTimelines[hash] = {
                                time: Math.round(item.time),
                                duration: Math.round(item.duration || 0),
                                percent: Math.round(item.percent || 0),
                                updatedAt: updated,
                                source: key
                            };
                        }
                    }
                }
            } catch(e) {
                logError('Error reading', key, ':', e);
            }
        });
        
        return allTimelines;
    }

    // ============== ОПРЕДЕЛЕНИЕ ТИПА КОНТЕНТА ПО ХЕШУ ==============
    function getContentTypeByHash(hash) {
        // Пытаемся определить тип по структуре хеша
        // Для сериалов хеш обычно содержит "s" и "e" (season и episode)
        if (hash && typeof hash === 'string') {
            // Проверяем на наличие сезона и эпизода в хеше
            const seasonMatch = hash.match(/s(\d+)/i);
            const episodeMatch = hash.match(/e(\d+)/i);
            if (seasonMatch && episodeMatch) {
                return {
                    type: 'series',
                    season: parseInt(seasonMatch[1]),
                    episode: parseInt(episodeMatch[1])
                };
            }
            
            // Проверяем на наличие сезона с разделителем ":"
            const parts = hash.split(':');
            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                return {
                    type: 'series',
                    season: parseInt(parts[0]),
                    episode: parseInt(parts[1])
                };
            }
        }
        return { type: 'movie' };
    }

    // ============== ПОЛУЧЕНИЕ ВСЕХ ХЕШЕЙ СЕРИАЛА ==============
    function getSeriesHashes(timelines, seriesBaseHash) {
        const seriesHashes = [];
        const baseKey = seriesBaseHash.replace(/s\d+[e:]\d+/i, '');
        
        for (const hash in timelines) {
            if (hash.startsWith(baseKey) || hash.includes(baseKey)) {
                const info = getContentTypeByHash(hash);
                if (info.type === 'series') {
                    seriesHashes.push({
                        hash: hash,
                        season: info.season,
                        episode: info.episode,
                        data: timelines[hash]
                    });
                }
            }
        }
        
        return seriesHashes;
    }

    // ============== ОПРЕДЕЛЕНИЕ ПРОСМОТРЕН ЛИ СЕРИАЛ ЦЕЛИКОМ ==============
    function isSeriesFullyWatched(seriesHashes, percentThreshold) {
        if (!seriesHashes || seriesHashes.length === 0) return false;
        
        // Проверяем все ли серии просмотрены до порога
        const allWatched = seriesHashes.every(item => {
            return item.data.percent >= percentThreshold;
        });
        
        if (!allWatched) return false;
        
        // Проверяем, что есть хотя бы одна серия с 100% (признак завершения)
        const hasComplete = seriesHashes.some(item => item.data.percent >= 95);
        
        return hasComplete;
    }

    // ============== ПОЛУЧЕНИЕ КОНФИГА ОЧИСТКИ ==============
    function getCleanupConfig() {
        const saved = Lampa.Storage.get('timeline_cleanup_config', null);
        if (saved) {
            return { ...DEFAULT_CLEANUP_CONFIG, ...saved };
        }
        return { ...DEFAULT_CLEANUP_CONFIG };
    }

    function saveCleanupConfig(config) {
        Lampa.Storage.set('timeline_cleanup_config', config);
    }

    // ============== ОЧИСТКА ТАЙМЛАЙНОВ В GIST ==============
    function cleanupTimelines(timelines) {
        const config = getCleanupConfig();
        if (!config.enabled) {
            log('Cleanup disabled');
            return timelines;
        }
        
        log('Starting cleanup with config:', config);
        
        const now = Date.now();
        const toRemove = [];
        const seriesGroups = {};
        
        // Группируем сериалы
        for (const hash in timelines) {
            const info = getContentTypeByHash(hash);
            if (info.type === 'series') {
                // Находим базовый ключ для группировки
                const baseKey = hash.replace(/s\d+[e:]\d+$/i, '');
                if (!seriesGroups[baseKey]) {
                    seriesGroups[baseKey] = [];
                }
                seriesGroups[baseKey].push({
                    hash: hash,
                    data: timelines[hash],
                    season: info.season,
                    episode: info.episode
                });
            }
        }
        
        // Проверяем каждый таймлайн
        for (const hash in timelines) {
            const data = timelines[hash];
            let shouldRemove = false;
            let reason = '';
            
            // 1. Проверка по порогу процентов
            if (data.percent >= config.percentThreshold) {
                const info = getContentTypeByHash(hash);
                
                if (info.type === 'series' && config.keepWatching) {
                    // Для сериалов проверяем, просмотрен ли весь сериал
                    const baseKey = hash.replace(/s\d+[e:]\d+$/i, '');
                    const seriesHashes = seriesGroups[baseKey] || [];
                    
                    if (!isSeriesFullyWatched(seriesHashes, config.percentThreshold)) {
                        log('Series not fully watched yet, keeping:', hash);
                        continue;
                    }
                    
                    log('Series fully watched, marking for removal:', hash);
                    shouldRemove = true;
                    reason = 'series_complete';
                } else {
                    shouldRemove = true;
                    reason = 'percent_threshold';
                }
            }
            
            // 2. Проверка по времени
            if (!shouldRemove && config.daysThreshold > 0) {
                const ageInDays = (now - data.updatedAt) / (1000 * 60 * 60 * 24);
                if (ageInDays > config.daysThreshold) {
                    const info = getContentTypeByHash(hash);
                    if (info.type === 'series' && config.keepWatching) {
                        // Для сериалов проверяем, просмотрен ли весь сериал
                        const baseKey = hash.replace(/s\d+[e:]\d+$/i, '');
                        const seriesHashes = seriesGroups[baseKey] || [];
                        
                        if (!isSeriesFullyWatched(seriesHashes, config.percentThreshold)) {
                            // Если сериал в процессе просмотра, не удаляем по времени
                            log('Series still watching, keeping by time:', hash);
                            continue;
                        }
                    }
                    shouldRemove = true;
                    reason = 'time_threshold (' + Math.round(ageInDays) + ' days)';
                }
            }
            
            if (shouldRemove) {
                toRemove.push({ hash, reason, data });
                log('Marked for removal:', hash, 'reason:', reason);
            }
        }
        
        // 3. Проверка по максимальному количеству
        if (config.maxCount > 0) {
            const remaining = Object.keys(timelines).length - toRemove.length;
            if (remaining > config.maxCount) {
                // Сортируем оставшиеся по времени обновления (старые сначала)
                const sorted = Object.keys(timelines)
                    .filter(h => !toRemove.some(r => r.hash === h))
                    .sort((a, b) => timelines[a].updatedAt - timelines[b].updatedAt);
                
                const toRemoveExtra = sorted.slice(0, remaining - config.maxCount);
                toRemoveExtra.forEach(hash => {
                    toRemove.push({ 
                        hash, 
                        reason: 'max_count (' + config.maxCount + ')',
                        data: timelines[hash] 
                    });
                });
            }
        }
        
        // Удаляем отмеченные таймлайны
        if (toRemove.length > 0) {
            log('Removing', toRemove.length, 'timelines');
            toRemove.forEach(({ hash }) => {
                delete timelines[hash];
            });
        }
        
        return timelines;
    }

    // ============== ОЧИСТКА ЛОКАЛЬНЫХ ТАЙМЛАЙНОВ ==============
    function cleanLocalTimelines(options = {}) {
        const {
            clearAll = false,
            percentThreshold = 100,
            daysThreshold = 30,
            keepWatching = true
        } = options;
        
        log('Cleaning local timelines, clearAll:', clearAll);
        
        const keys = getAllTimelineKeys();
        let totalRemoved = 0;
        const now = Date.now();
        const seriesGroups = {};
        
        // Собираем все таймлайны для анализа сериалов
        const allTimelines = {};
        keys.forEach(key => {
            try {
                const data = Lampa.Storage.get(key, {});
                for (const hash in data) {
                    if (!allTimelines[hash]) {
                        allTimelines[hash] = data[hash];
                    }
                }
            } catch(e) {}
        });
        
        // Группируем сериалы
        for (const hash in allTimelines) {
            const info = getContentTypeByHash(hash);
            if (info.type === 'series') {
                const baseKey = hash.replace(/s\d+[e:]\d+$/i, '');
                if (!seriesGroups[baseKey]) {
                    seriesGroups[baseKey] = [];
                }
                seriesGroups[baseKey].push({
                    hash: hash,
                    data: allTimelines[hash],
                    season: info.season,
                    episode: info.episode
                });
            }
        }
        
        // Проверяем каждый ключ
        keys.forEach(key => {
            try {
                const storage = Lampa.Storage.get(key, {});
                const toRemove = [];
                
                for (const hash in storage) {
                    const data = storage[hash];
                    let shouldRemove = false;
                    
                    if (clearAll) {
                        shouldRemove = true;
                    } else {
                        // Проверка по процентам
                        if (data.percent >= percentThreshold) {
                            const info = getContentTypeByHash(hash);
                            if (info.type === 'series' && keepWatching) {
                                const baseKey = hash.replace(/s\d+[e:]\d+$/i, '');
                                const seriesHashes = seriesGroups[baseKey] || [];
                                if (!isSeriesFullyWatched(seriesHashes, percentThreshold)) {
                                    continue;
                                }
                            }
                            shouldRemove = true;
                        }
                        
                        // Проверка по времени
                        if (!shouldRemove && daysThreshold > 0) {
                            const ageInDays = (now - (data.updated || data.timestamp || 0)) / (1000 * 60 * 60 * 24);
                            if (ageInDays > daysThreshold) {
                                const info = getContentTypeByHash(hash);
                                if (info.type === 'series' && keepWatching) {
                                    const baseKey = hash.replace(/s\d+[e:]\d+$/i, '');
                                    const seriesHashes = seriesGroups[baseKey] || [];
                                    if (!isSeriesFullyWatched(seriesHashes, percentThreshold)) {
                                        continue;
                                    }
                                }
                                shouldRemove = true;
                            }
                        }
                    }
                    
                    if (shouldRemove) {
                        toRemove.push(hash);
                    }
                }
                
                // Удаляем
                toRemove.forEach(hash => {
                    delete storage[hash];
                    totalRemoved++;
                });
                
                if (toRemove.length > 0) {
                    Lampa.Storage.set(key, storage);
                    log('Cleaned', toRemove.length, 'items from', key);
                }
            } catch(e) {
                logError('Error cleaning', key, ':', e);
            }
        });
        
        log('Total local timelines removed:', totalRemoved);
        return totalRemoved;
    }

    // ============== ОЧИСТКА ВСЕХ ЛОКАЛЬНЫХ ТАЙМЛАЙНОВ ==============
    function clearAllLocalTimelines() {
        const keys = getAllTimelineKeys();
        let totalRemoved = 0;
        
        keys.forEach(key => {
            try {
                Lampa.Storage.set(key, {});
                totalRemoved++;
                log('Cleared all from', key);
            } catch(e) {
                logError('Error clearing', key, ':', e);
            }
        });
        
        // Обновляем Timeline
        if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
            Lampa.Timeline.read(true);
        }
        
        return totalRemoved;
    }

    // ============== СОХРАНЕНИЕ ТАЙМЛАЙНОВ ВО ВСЕ ХРАНИЛИЩА ==============
    function saveTimelinesToAllStorages(timelines, skipCleanup = false) {
        // Если не пропущена очистка, применяем её
        let finalTimelines = timelines;
        if (!skipCleanup) {
            const config = getCleanupConfig();
            if (config.enabled && config.autoCleanupOnSync) {
                finalTimelines = cleanupTimelines({ ...timelines });
            }
        }
        
        const keys = getAllTimelineKeys();
        let saved = 0;

        const dataByKey = {};
        keys.forEach(key => {
            dataByKey[key] = {};
        });

        for (const hash in finalTimelines) {
            const item = finalTimelines[hash];
            const data = {
                time: item.time,
                duration: item.duration || 0,
                percent: item.percent || 0,
                updated: item.updatedAt || Date.now()
            };
            
            for (const key in dataByKey) {
                dataByKey[key][hash] = data;
            }
        }

        for (const key in dataByKey) {
            if (Object.keys(dataByKey[key]).length > 0) {
                Lampa.Storage.set(key, dataByKey[key]);
                saved++;
                log('Saved to', key, ':', Object.keys(dataByKey[key]).length, 'items');
            }
        }
        
        return saved;
    }

    // ============== СОХРАНЕНИЕ ОДНОГО ТАЙМЛАЙНА ==============
    function saveTimelineToFileView(hash, time, duration, percent) {
        if (!hash || !time || time <= 0) return;

        const now = Date.now();
        const keys = getAllTimelineKeys();
        
        log('SAVING:', hash, 'time:', time, 'percent:', percent);
        
        keys.forEach(key => {
            try {
                const data = Lampa.Storage.get(key, {});
                data[hash] = {
                    time: Math.round(time),
                    duration: Math.round(duration || 0),
                    percent: Math.round(percent || 0),
                    updated: now
                };
                Lampa.Storage.set(key, data);
            } catch(e) {
                logError('Error saving to', key, ':', e);
            }
        });
        
        if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
            Lampa.Timeline.read(true);
        }
        
        forceUIUpdate(hash, { time, duration, percent });
        scheduleSync();
    }

    // ============== ПРИНУДИТЕЛЬНОЕ ОБНОВЛЕНИЕ ИНТЕРФЕЙСА ==============
    function forceUIUpdate(hash, data) {
        try {
            if (Lampa.Timeline && typeof Lampa.Timeline.update === 'function') {
                Lampa.Timeline.update({
                    hash: hash,
                    time: data.time,
                    duration: data.duration || 0,
                    percent: data.percent || 0,
                    force: true
                });
            }
            
            const playData = Lampa.Player.playdata();
            if (playData && playData.timeline) {
                playData.timeline.time = data.time;
                playData.timeline.percent = data.percent || 0;
                playData.timeline.duration = data.duration || 0;
            }
            
            const activity = Lampa.Activity.active();
            const movie = activity?.movie;
            if (movie) {
                if (movie.timeline) {
                    movie.timeline.time = data.time;
                    movie.timeline.percent = data.percent || 0;
                    movie.timeline.duration = data.duration || 0;
                }
                
                if (Lampa.Listener) {
                    Lampa.Listener.send('full', {
                        type: 'update',
                        data: { 
                            movie: movie, 
                            hash: hash,
                            timeline: {
                                time: data.time,
                                percent: data.percent || 0,
                                duration: data.duration || 0
                            }
                        }
                    });
                    
                    Lampa.Listener.send('state:changed', {
                        target: 'timeline',
                        reason: 'update',
                        data: { hash: hash, road: {
                            time: data.time,
                            percent: data.percent || 0,
                            duration: data.duration || 0
                        }}
                    });
                }
            }
            
            if (Lampa.Timeline && typeof Lampa.Timeline.render === 'function') {
                Lampa.Timeline.render();
            }
            
            $('.time-line[data-hash="'+hash+'"]').each(function(){
                $(this).toggleClass('hide', data.percent ? false : true);
                $('> div', this).css('width', data.percent + '%');
            });
            
            $('.time-line-details[data-hash="'+hash+'"]').each(function(){
                const f = Lampa.Timeline.format ? Lampa.Timeline.format({
                    time: data.time,
                    duration: data.duration || 0,
                    percent: data.percent || 0
                }) : {
                    time: Lampa.Utils.secondsToTimeHuman(data.time),
                    duration: Lampa.Utils.secondsToTimeHuman(data.duration || 0),
                    percent: data.percent + '%'
                };
                $(this).find('[a="t"]').text(f.time);
                $(this).find('[a="p"]').text(f.percent);
                $(this).find('[a="d"]').text(f.duration);
                $(this).toggleClass('hide', data.duration ? false : true);
            });
            
            log('UI updated for', hash);
        } catch(e) {
            logError('UI update error:', e);
        }
    }

    // ============== ПРИНУДИТЕЛЬНОЕ ПРИМЕНЕНИЕ ДАННЫХ ==============
    function forceApplyTimeline(hash, data) {
        if (!hash || !data || !data.time) return false;
        
        log('FORCE APPLY:', hash, 'time:', data.time, 'percent:', data.percent);
        
        const now = Date.now();
        const keys = getAllTimelineKeys();
        
        keys.forEach(key => {
            try {
                const storage = Lampa.Storage.get(key, {});
                storage[hash] = {
                    time: data.time,
                    duration: data.duration || 0,
                    percent: data.percent || 0,
                    updated: data.updatedAt || now
                };
                Lampa.Storage.set(key, storage);
            } catch(e) {
                logError('Error saving to', key, ':', e);
            }
        });
        
        forceUIUpdate(hash, data);
        
        if (data.percent) {
            notify('📥 Прогресс обновлен: ' + Math.round(data.percent) + '%');
        }
        
        return true;
    }

    // ============== ХРАНИЛИЩЕ КОНФИГА ==============
    function getConfig() {
        return Lampa.Storage.get(CFG_KEY, {
            token: '',
            gistId: '',
            lastSync: 0,
            enabled: true,
            autoSync: true
        });
    }

    function saveConfig(cfg) {
        Lampa.Storage.set(CFG_KEY, cfg);
    }

    function notify(text) {
        Lampa.Noty.show(text);
    }

    // ============== РАБОТА С GIST ==============
    function syncToGist(showNotify = true) {
        const cfg = getConfig();
        if (!cfg.token || !cfg.gistId) {
            if (showNotify) notify('⚠️ GitHub Gist не настроен');
            return false;
        }

        cleanupOldData();

        let timelines = getAllTimelines();
        const originalCount = Object.keys(timelines).length;
        
        // Применяем очистку перед отправкой
        const config = getCleanupConfig();
        if (config.enabled && config.autoCleanupOnSync) {
            timelines = cleanupTimelines(timelines);
            const cleanedCount = originalCount - Object.keys(timelines).length;
            if (cleanedCount > 0 && showNotify) {
                notify('🧹 Удалено ' + cleanedCount + ' таймлайнов при очистке');
            }
        }
        
        const count = Object.keys(timelines).length;
        
        if (count === 0) {
            if (showNotify) notify('⚠️ Нет таймлайнов для синхронизации');
            return false;
        }

        log('SYNC TO GIST:', count, 'timelines');

        const data = {
            description: 'Lampa Timeline Sync',
            public: false,
            files: {
                'timeline.json': {
                    content: JSON.stringify({
                        version: 2,
                        profile: getProfileId() || 'default',
                        updated: new Date().toISOString(),
                        count: count,
                        timelines: timelines
                    }, null, 2)
                }
            }
        };

        const url = GIST_API + '/' + cfg.gistId;
        
        fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': 'token ' + cfg.token,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        })
        .then(function(response) {
            if (!response.ok) {
                throw { status: response.status, statusText: response.statusText };
            }
            return response.json();
        })
        .then(function(response) {
            cfg.lastSync = Date.now();
            saveConfig(cfg);
            if (showNotify) notify('✅ Синхронизировано ' + count + ' таймлайнов');
            log('Sync complete');
        })
        .catch(function(err) {
            logError('Sync error:', err.status || 'unknown');
            if (err.status === 404) {
                createNewGist(showNotify);
            } else {
                if (showNotify) notify('❌ Ошибка синхронизации: ' + (err.status || 'unknown'));
            }
        });

        return true;
    }

    function createNewGist(showNotify = true) {
        const cfg = getConfig();
        const timelines = getAllTimelines();
        const count = Object.keys(timelines).length;
        
        if (count === 0) {
            if (showNotify) notify('⚠️ Нет таймлайнов для синхронизации');
            return false;
        }

        const data = {
            description: 'Lampa Timeline Sync',
            public: false,
            files: {
                'timeline.json': {
                    content: JSON.stringify({
                        version: 2,
                        profile: getProfileId() || 'default',
                        updated: new Date().toISOString(),
                        count: count,
                        timelines: timelines
                    }, null, 2)
                }
            }
        };

        fetch(GIST_API, {
            method: 'POST',
            headers: {
                'Authorization': 'token ' + cfg.token,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        })
        .then(function(response) {
            if (!response.ok) {
                throw { status: response.status, statusText: response.statusText };
            }
            return response.json();
        })
        .then(function(response) {
            if (response && response.id) {
                cfg.gistId = response.id;
                cfg.lastSync = Date.now();
                saveConfig(cfg);
                if (showNotify) notify('✅ Создан новый Gist: ' + response.id);
                log('New Gist created:', response.id);
            } else {
                if (showNotify) notify('❌ Не удалось создать Gist');
            }
        })
        .catch(function(err) {
            logError('Create Gist error:', err.status || 'unknown');
            if (showNotify) notify('❌ Ошибка создания Gist: ' + (err.status || 'unknown'));
        });

        return true;
    }

    function syncFromGist(showNotify = true, applyImmediately = false) {
        const cfg = getConfig();
        if (!cfg.token || !cfg.gistId) {
            if (showNotify) notify('⚠️ GitHub Gist не настроен');
            return false;
        }

        cleanupOldData();

        log('LOADING from Gist...');

        const url = GIST_API + '/' + cfg.gistId;
        
        fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': 'token ' + cfg.token,
                'Accept': 'application/vnd.github.v3+json'
            }
        })
        .then(function(response) {
            if (!response.ok) {
                throw { status: response.status, statusText: response.statusText };
            }
            return response.json();
        })
        .then(function(data) {
            try {
                const content = data.files && data.files['timeline.json'] ? data.files['timeline.json'].content : null;
                
                if (!content) {
                    if (showNotify) notify('⚠️ Файл timeline.json не найден');
                    return;
                }

                const remote = JSON.parse(content);
                const remoteTimelines = remote.timelines || {};
                
                log('Gist has', Object.keys(remoteTimelines).length, 'timelines');
                
                if (Object.keys(remoteTimelines).length === 0) {
                    if (showNotify) notify('⚠️ В Gist нет таймлайнов');
                    return;
                }

                const localTimelines = getAllTimelines();
                let changes = 0;
                let merged = { ...localTimelines };

                for (const hash in remoteTimelines) {
                    const remoteData = remoteTimelines[hash];
                    const localData = merged[hash];
                    
                    if (!localData) {
                        merged[hash] = remoteData;
                        changes++;
                        log('New from Gist:', hash);
                        continue;
                    }
                    
                    const remoteUpdated = remoteData.updatedAt || 0;
                    const localUpdated = localData.updatedAt || 0;
                    
                    if (remoteUpdated > localUpdated) {
                        merged[hash] = remoteData;
                        changes++;
                        log('Updated from Gist:', hash);
                    }
                }

                if (changes > 0) {
                    saveTimelinesToAllStorages(merged);
                    
                    if (applyImmediately) {
                        const activity = Lampa.Activity.active();
                        const movie = activity?.movie;
                        if (movie) {
                            const hash = generateHash(movie);
                            if (hash && merged[hash]) {
                                forceApplyTimeline(hash, merged[hash]);
                            }
                        }
                    }
                    
                    if (showNotify) notify('📥 Загружено ' + changes + ' таймлайнов');
                } else {
                    if (showNotify) notify('✅ Данные актуальны');
                }

                cfg.lastSync = Date.now();
                saveConfig(cfg);

            } catch(e) {
                logError('Parse error:', e);
                if (showNotify) notify('❌ Ошибка чтения данных');
            }
        })
        .catch(function(err) {
            logError('Load error:', err.status || 'unknown');
            if (err.status === 404) {
                if (showNotify) notify('❌ Gist не найден (404)');
            } else {
                if (showNotify) notify('❌ Ошибка загрузки: ' + (err.status || 'unknown'));
            }
        });

        return true;
    }

    // ============== ГЕНЕРАЦИЯ ХЕША ==============
    function generateHash(movie, season, episode) {
        if (!movie) return null;
        
        try {
            if (movie.original_name) {
                const s = season || 1;
                const e = episode || 1;
                const hashString = [s, s > 10 ? ':' : '', e, movie.original_name].join('');
                return Lampa.Utils.hash(hashString);
            } else if (movie.original_title) {
                return Lampa.Utils.hash(movie.original_title);
            } else if (movie.title) {
                return Lampa.Utils.hash(movie.title);
            }
        } catch(e) {
            logError('Hash generation error:', e);
        }
        return null;
    }

    function getCurrentHash() {
        const activity = Lampa.Activity.active();
        const movie = activity?.movie;
        if (!movie) return null;
        
        let season = activity?.season || 1;
        let episode = activity?.episode || 1;
        
        if (movie.original_title) {
            return generateHash(movie);
        }
        
        return generateHash(movie, season, episode);
    }

    // ============== СОБЫТИЯ ПЛЕЕРА ==============
    var syncTimer = null;
    var currentTimeline = null;
    var isSyncing = false;

    function scheduleSync() {
        clearTimeout(syncTimer);
        syncTimer = setTimeout(function() {
            const cfg = getConfig();
            if (cfg.token && cfg.gistId && cfg.autoSync && !isSyncing) {
                isSyncing = true;
                syncToGist(false);
                setTimeout(function() {
                    isSyncing = false;
                }, 5000);
            }
        }, SAVE_DELAY);
    }

    function handleTimelineUpdate(data) {
        if (!data || !data.hash) return;
        
        const activity = Lampa.Activity.active();
        const movie = activity?.movie;
        if (!movie) return;
        
        const hash = generateHash(movie);
        if (!hash || hash !== data.hash) return;
        
        const time = data.time || 0;
        const duration = data.duration || 0;
        const percent = data.percent || 0;
        
        if (time > 0 && (time !== currentTimeline?.time || Math.abs(time - currentTimeline.time) > 5)) {
            currentTimeline = { time, duration, percent };
            saveTimelineToFileView(hash, time, duration, percent);
        }
    }

    function initPlayerListeners() {
        Lampa.Listener.follow('timeline', function(e) {
            if (e.type === 'update') {
                handleTimelineUpdate(e.data);
            }
        });

        Lampa.Player.listener.follow('timeupdate', function(e) {
            const playData = Lampa.Player.playdata();
            if (playData && playData.timeline) {
                const activity = Lampa.Activity.active();
                const movie = activity?.movie;
                if (movie) {
                    const hash = generateHash(movie);
                    if (hash) {
                        const time = playData.timeline.time || 0;
                        const duration = playData.timeline.duration || 0;
                        const percent = playData.timeline.percent || 0;
                        
                        if (time > 0 && (time !== currentTimeline?.time || Math.abs(time - currentTimeline.time) > 5)) {
                            currentTimeline = { time, duration, percent };
                            saveTimelineToFileView(hash, time, duration, percent);
                        }
                    }
                }
            }
            scheduleSync();
        });

        Lampa.Player.listener.follow('pause', function(e) {
            log('Player paused, syncing...');
            const cfg = getConfig();
            if (cfg.token && cfg.gistId && !isSyncing) {
                isSyncing = true;
                syncToGist(false);
                setTimeout(function() {
                    isSyncing = false;
                }, 5000);
            }
        });

        Lampa.Player.listener.follow('destroy', function() {
            log('Player destroyed, syncing...');
            clearTimeout(syncTimer);
            
            const playData = Lampa.Player.playdata();
            if (playData && playData.timeline) {
                const activity = Lampa.Activity.active();
                const movie = activity?.movie;
                if (movie) {
                    const hash = generateHash(movie);
                    if (hash) {
                        const time = playData.timeline.time || 0;
                        const duration = playData.timeline.duration || 0;
                        const percent = playData.timeline.percent || 0;
                        
                        if (time > 0) {
                            saveTimelineToFileView(hash, time, duration, percent);
                        }
                    }
                }
            }
            
            setTimeout(function() {
                const cfg = getConfig();
                if (cfg.token && cfg.gistId && !isSyncing) {
                    isSyncing = true;
                    syncToGist(false);
                    setTimeout(function() {
                        isSyncing = false;
                    }, 5000);
                }
                currentTimeline = null;
            }, 1000);
        });

        log('Player listeners initialized');
    }

    // ============== ОБРАБОТКА ПРИ ОТКРЫТИИ ФИЛЬМА ==============
    function initActivityListeners() {
        Lampa.Listener.follow('full', function(e) {
            if (e.type === 'open') {
                const data = e.data;
                const movie = data?.movie;
                
                if (movie) {
                    const hash = generateHash(movie);
                    if (hash) {
                        log('FULL OPEN:', movie.title || movie.original_title, 'hash:', hash);
                        
                        const cfg = getConfig();
                        if (cfg.token && cfg.gistId) {
                            fetch(GIST_API + '/' + cfg.gistId, {
                                headers: {
                                    'Authorization': 'token ' + cfg.token,
                                    'Accept': 'application/vnd.github.v3+json'
                                }
                            })
                            .then(function(response) {
                                if (!response.ok) {
                                    throw { status: response.status };
                                }
                                return response.json();
                            })
                            .then(function(gistData) {
                                try {
                                    const content = gistData.files && gistData.files['timeline.json'] ? gistData.files['timeline.json'].content : null;
                                    if (!content) return;
                                    
                                    const remote = JSON.parse(content);
                                    const remoteTimelines = remote.timelines || {};
                                    
                                    if (remoteTimelines[hash]) {
                                        const remoteData = remoteTimelines[hash];
                                        
                                        const keys = getAllTimelineKeys();
                                        let localUpdated = 0;
                                        
                                        keys.forEach(function(key) {
                                            try {
                                                const storage = Lampa.Storage.get(key, {});
                                                const item = storage[hash];
                                                if (item && item.updated > localUpdated) {
                                                    localUpdated = item.updated;
                                                }
                                            } catch(e) {}
                                        });
                                        
                                        if (remoteData.updatedAt > localUpdated) {
                                            log('Applying Gist timeline for', hash);
                                            forceApplyTimeline(hash, remoteData);
                                            
                                            currentTimeline = {
                                                time: remoteData.time,
                                                duration: remoteData.duration || 0,
                                                percent: remoteData.percent || 0
                                            };
                                            
                                            if (remoteData.percent) {
                                                notify('📥 Загружен прогресс: ' + Math.round(remoteData.percent) + '%');
                                            }
                                        } else {
                                            log('Local data is newer or equal to Gist for', hash);
                                        }
                                    }
                                } catch(e) {
                                    logError('Error loading from Gist:', e);
                                }
                            })
                            .catch(function(err) {
                                logError('Failed to load Gist:', err.status);
                            });
                        }
                    }
                }
            }
        });
        
        log('Activity listeners initialized');
    }

    // ============== ПЕРИОДИЧЕСКАЯ ПРОВЕРКА ЦЕЛОСТНОСТИ ==============
    function integrityCheck() {
        const keys = getAllTimelineKeys();
        const mainKey = 'file_view';
        const mainData = Lampa.Storage.get(mainKey, {});
        let changes = 0;
        
        keys.forEach(function(key) {
            if (key === mainKey) return;
            try {
                const data = Lampa.Storage.get(key, {});
                for (const hash in data) {
                    if (!mainData[hash] || mainData[hash].updated < data[hash].updated) {
                        mainData[hash] = data[hash];
                        changes++;
                    }
                }
            } catch(e) {
                logError('Integrity check error for', key, ':', e);
            }
        });
        
        if (changes > 0) {
            Lampa.Storage.set(mainKey, mainData);
            log('Integrity check: merged', changes, 'items into', mainKey);
            
            const currentHash = getCurrentHash();
            if (currentHash && mainData[currentHash]) {
                forceUIUpdate(currentHash, mainData[currentHash]);
            }
        }
    }

    // ============== НАСТРОЙКИ ==============
    function setupSettings() {
        try {
            if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addComponent === 'function') {
                Lampa.SettingsApi.addComponent({
                    component: 'timeline_gist',
                    name: 'Синхронизация таймлайнов',
                    icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M13,7H11V13H17V11H13V7Z"/></svg>'
                });
            }

            if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addParam === 'function') {
                // Основная настройка
                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'timeline_gist_setup',
                        type: 'button'
                    },
                    field: {
                        name: 'Настройка Gist',
                        description: 'GitHub Gist для синхронизации прогресса'
                    },
                    onChange: function() {
                        showGistSetup();
                    }
                });

                // Настройки автоочистки
                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_settings',
                        type: 'title'
                    },
                    field: {
                        name: '🧹 Автоочистка таймлайнов'
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_enabled',
                        type: 'toggle',
                        default: false
                    },
                    field: {
                        name: 'Включить автоочистку',
                        description: 'Автоматически удалять старые или завершенные таймлайны'
                    },
                    onChange: function(value) {
                        const config = getCleanupConfig();
                        config.enabled = value === 'true';
                        saveCleanupConfig(config);
                    },
                    onRender: function(item) {
                        const config = getCleanupConfig();
                        const toggle = item.find('.settings-param__value input');
                        if (toggle.length && config.enabled) {
                            toggle.prop('checked', true);
                            item.find('.settings-param__value').addClass('active');
                        }
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_max_count',
                        type: 'input',
                        placeholder: '500',
                        default: '500'
                    },
                    field: {
                        name: 'Максимальное количество таймлайнов',
                        description: 'Превышение лимита будет удалять самые старые записи'
                    },
                    onChange: function(value) {
                        const config = getCleanupConfig();
                        config.maxCount = parseInt(value) || 500;
                        saveCleanupConfig(config);
                    },
                    onRender: function(item) {
                        const config = getCleanupConfig();
                        const input = item.find('.settings-param__value input');
                        if (input.length) {
                            input.val(config.maxCount);
                        }
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_percent',
                        type: 'input',
                        placeholder: '100',
                        default: '100'
                    },
                    field: {
                        name: 'Порог процента просмотра (%)',
                        description: 'Удалять таймлайны с процентом просмотра >= указанного'
                    },
                    onChange: function(value) {
                        const config = getCleanupConfig();
                        config.percentThreshold = parseInt(value) || 100;
                        if (config.percentThreshold > 100) config.percentThreshold = 100;
                        if (config.percentThreshold < 0) config.percentThreshold = 0;
                        saveCleanupConfig(config);
                    },
                    onRender: function(item) {
                        const config = getCleanupConfig();
                        const input = item.find('.settings-param__value input');
                        if (input.length) {
                            input.val(config.percentThreshold);
                        }
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_days',
                        type: 'input',
                        placeholder: '30',
                        default: '30'
                    },
                    field: {
                        name: 'Количество дней для удаления',
                        description: 'Удалять таймлайны, не обновлявшиеся более N дней (0 - отключено)'
                    },
                    onChange: function(value) {
                        const config = getCleanupConfig();
                        config.daysThreshold = parseInt(value) || 0;
                        if (config.daysThreshold < 0) config.daysThreshold = 0;
                        saveCleanupConfig(config);
                    },
                    onRender: function(item) {
                        const config = getCleanupConfig();
                        const input = item.find('.settings-param__value input');
                        if (input.length) {
                            input.val(config.daysThreshold);
                        }
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_keep_watching',
                        type: 'toggle',
                        default: true
                    },
                    field: {
                        name: 'Сохранять просматриваемые сериалы',
                        description: 'Не удалять сериалы, которые ещё не просмотрены полностью'
                    },
                    onChange: function(value) {
                        const config = getCleanupConfig();
                        config.keepWatching = value === 'true';
                        saveCleanupConfig(config);
                    },
                    onRender: function(item) {
                        const config = getCleanupConfig();
                        const toggle = item.find('.settings-param__value input');
                        if (toggle.length && config.keepWatching) {
                            toggle.prop('checked', true);
                            item.find('.settings-param__value').addClass('active');
                        }
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_auto_on_sync',
                        type: 'toggle',
                        default: false
                    },
                    field: {
                        name: 'Очищать при каждой синхронизации',
                        description: 'Автоматически применять очистку перед отправкой в Gist'
                    },
                    onChange: function(value) {
                        const config = getCleanupConfig();
                        config.autoCleanupOnSync = value === 'true';
                        saveCleanupConfig(config);
                    },
                    onRender: function(item) {
                        const config = getCleanupConfig();
                        const toggle = item.find('.settings-param__value input');
                        if (toggle.length && config.autoCleanupOnSync) {
                            toggle.prop('checked', true);
                            item.find('.settings-param__value').addClass('active');
                        }
                    }
                });

                // Кнопки ручной очистки
                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_manual_title',
                        type: 'title'
                    },
                    field: {
                        name: '🛠️ Ручная очистка'
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_local',
                        type: 'button'
                    },
                    field: {
                        name: 'Очистить локальные таймлайны',
                        description: 'Удалить таймлайны из всех локальных хранилищ по текущим правилам'
                    },
                    onChange: function() {
                        const config = getCleanupConfig();
                        const count = cleanLocalTimelines({
                            percentThreshold: config.percentThreshold,
                            daysThreshold: config.daysThreshold,
                            keepWatching: config.keepWatching
                        });
                        notify('🧹 Очищено ' + count + ' локальных таймлайнов');
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_all_local',
                        type: 'button'
                    },
                    field: {
                        name: '❌ Удалить ВСЕ локальные таймлайны',
                        description: 'Полностью очистить все хранилища таймлайнов на устройстве'
                    },
                    onChange: function() {
                        Lampa.Select.show({
                            title: '⚠️ Подтверждение',
                            items: [
                                { title: '❌ Да, удалить все таймлайны', action: 'confirm' },
                                { title: '🔙 Отмена', action: 'cancel' }
                            ],
                            onSelect: function(item) {
                                if (item.action === 'confirm') {
                                    const count = clearAllLocalTimelines();
                                    notify('🗑️ Удалено ' + count + ' хранилищ таймлайнов');
                                }
                            }
                        });
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_gist',
                        type: 'button'
                    },
                    field: {
                        name: 'Очистить таймлайны в Gist',
                        description: 'Удалить таймлайны из Gist по текущим правилам и загрузить очищенные данные'
                    },
                    onChange: function() {
                        Lampa.Select.show({
                            title: '⚠️ Подтверждение',
                            items: [
                                { title: '🧹 Очистить Gist и загрузить обновленные данные', action: 'confirm' },
                                { title: '🔙 Отмена', action: 'cancel' }
                            ],
                            onSelect: function(item) {
                                if (item.action === 'confirm') {
                                    const cfg = getConfig();
                                    if (!cfg.token || !cfg.gistId) {
                                        notify('⚠️ GitHub Gist не настроен');
                                        return;
                                    }
                                    
                                    // Сначала загружаем, очищаем, потом отправляем обратно
                                    fetch(GIST_API + '/' + cfg.gistId, {
                                        headers: {
                                            'Authorization': 'token ' + cfg.token,
                                            'Accept': 'application/vnd.github.v3+json'
                                        }
                                    })
                                    .then(r => r.json())
                                    .then(data => {
                                        const content = data.files['timeline.json'].content;
                                        const remote = JSON.parse(content);
                                        const timelines = remote.timelines || {};
                                        
                                        // Применяем очистку
                                        const cleaned = cleanupTimelines({ ...timelines });
                                        const removed = Object.keys(timelines).length - Object.keys(cleaned).length;
                                        
                                        // Сохраняем локально
                                        saveTimelinesToAllStorages(cleaned, true);
                                        
                                        // Отправляем в Gist
                                        const cfg2 = getConfig();
                                        const url = GIST_API + '/' + cfg2.gistId;
                                        
                                        fetch(url, {
                                            method: 'PATCH',
                                            headers: {
                                                'Authorization': 'token ' + cfg2.token,
                                                'Accept': 'application/vnd.github.v3+json',
                                                'Content-Type': 'application/json'
                                            },
                                            body: JSON.stringify({
                                                description: 'Lampa Timeline Sync',
                                                public: false,
                                                files: {
                                                    'timeline.json': {
                                                        content: JSON.stringify({
                                                            version: 2,
                                                            profile: getProfileId() || 'default',
                                                            updated: new Date().toISOString(),
                                                            count: Object.keys(cleaned).length,
                                                            timelines: cleaned
                                                        }, null, 2)
                                                    }
                                                }
                                            })
                                        })
                                        .then(() => {
                                            notify('🧹 Очищено ' + removed + ' таймлайнов в Gist');
                                            if (Lampa.Timeline) {
                                                Lampa.Timeline.read(true);
                                            }
                                        })
                                        .catch(err => {
                                            notify('❌ Ошибка очистки Gist');
                                            logError(err);
                                        });
                                    })
                                    .catch(err => {
                                        notify('❌ Ошибка загрузки Gist');
                                        logError(err);
                                    });
                                }
                            }
                        });
                    }
                });
            }

            log('Settings initialized');
        } catch(e) {
            logError('Settings setup error:', e);
            addMenuItem();
        }
    }

    // ============== ДОБАВЛЕНИЕ ПУНКТА В МЕНЮ ==============
    function addMenuItem() {
        setTimeout(function() {
            var ml = $('.menu__list').eq(0);
            if (!ml.length) return;
            
            if ($('.timeline-gist-menu-item').length) return;
            
            var el = $(
                '<li class="menu__item selector timeline-gist-menu-item">' +
                    '<div class="menu__ico">' +
                        '<svg viewBox="0 0 24 24" width="20" height="20">' +
                            '<path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M13,7H11V13H17V11H13V7Z"/>' +
                        '</svg>' +
                    '</div>' +
                    '<div class="menu__text">Синхр. таймлайнов</div>' +
                '</li>'
            );
            
            el.on('hover:enter', function(e) {
                e.stopPropagation();
                showGistSetup();
            });
            
            ml.append(el);
            log('Menu item added (fallback)');
        }, 2000);
    }

    // ============== ДИАЛОГ НАСТРОЕК ==============
    function showGistSetup() {
        const cfg = getConfig();
        const timelines = getAllTimelines();
        const count = Object.keys(timelines).length;
        const lastSync = cfg.lastSync ? new Date(cfg.lastSync).toLocaleString() : 'Никогда';
        const profileId = getProfileId() || 'не задан';
        
        // Подсчет статистики
        let movies = 0, series = 0;
        for (const hash in timelines) {
            const info = getContentTypeByHash(hash);
            if (info.type === 'series') series++;
            else movies++;
        }
        
        Lampa.Select.show({
            title: '☁️ GitHub Gist',
            items: [
                { title: '🔑 Токен: ' + (cfg.token ? '✅ Установлен' : '❌ Не установлен'), action: 'token' },
                { title: '📄 Gist ID: ' + (cfg.gistId ? cfg.gistId.substring(0, 8) + '…' : '❌ Не создан'), action: 'id' },
                { title: '👤 Profile ID: ' + profileId, action: 'status' },
                { title: '──────────', separator: true },
                { title: '📊 Таймлайнов: ' + count + ' (фильмы: ' + movies + ', сериалы: ' + series + ')', action: 'status' },
                { title: '🔄 Последняя синхр.: ' + lastSync, action: 'status' },
                { title: '──────────', separator: true },
                { title: '📤 Выгрузить в Gist', action: 'upload' },
                { title: '📥 Загрузить из Gist', action: 'download' },
                { title: '──────────', separator: true },
                { title: '🔄 Автосинхр.: ' + (cfg.autoSync ? '✅ Вкл' : '❌ Выкл'), action: 'toggle_auto' },
                { title: '──────────', separator: true },
                { title: '🧹 Очистить старые ключи', action: 'cleanup' },
                { title: '──────────', separator: true },
                { title: '⚙️ Настройки очистки', action: 'cleanup_settings' },
                { title: '──────────', separator: true },
                { title: '❌ Закрыть', action: 'cancel' }
            ],
            onSelect: function(item) {
                const newCfg = getConfig();
                
                if (item.action === 'token') {
                    Lampa.Input.edit({
                        title: 'GitHub Personal Access Token (права: gist)',
                        value: cfg.token,
                        nosave: true
                    }, function(val) {
                        if (val !== null) {
                            newCfg.token = val || '';
                            saveConfig(newCfg);
                            notify('Токен сохранён');
                        }
                        showGistSetup();
                    });
                } else if (item.action === 'id') {
                    Lampa.Input.edit({
                        title: 'Gist ID (оставьте пустым для создания)',
                        value: cfg.gistId,
                        nosave: true
                    }, function(val) {
                        if (val !== null) {
                            newCfg.gistId = val || '';
                            saveConfig(newCfg);
                            notify('Gist ID сохранён');
                        }
                        showGistSetup();
                    });
                } else if (item.action === 'upload') {
                    syncToGist(true);
                    setTimeout(function() {
                        showGistSetup();
                    }, 2000);
                } else if (item.action === 'download') {
                    syncFromGist(true, true);
                    setTimeout(function() {
                        showGistSetup();
                    }, 2000);
                } else if (item.action === 'toggle_auto') {
                    newCfg.autoSync = !newCfg.autoSync;
                    saveConfig(newCfg);
                    notify('Автосинхронизация ' + (newCfg.autoSync ? 'включена' : 'выключена'));
                    showGistSetup();
                } else if (item.action === 'cleanup') {
                    const cleaned = cleanupOldData();
                    notify('🧹 Очищено ' + cleaned + ' старых ключей');
                    setTimeout(function() {
                        showGistSetup();
                    }, 1000);
                } else if (item.action === 'cleanup_settings') {
                    // Открываем настройки очистки в Settings
                    Lampa.Controller.toggle('settings_component');
                    Lampa.Settings.create('timeline_gist');
                    // Скроллим к настройкам очистки
                    setTimeout(function() {
                        const el = $('.settings-param[data-name="cleanup_enabled"]');
                        if (el.length) {
                            el[0].scrollIntoView({ behavior: 'smooth' });
                        }
                    }, 300);
                } else if (item.action === 'status') {
                    showGistSetup();
                }
            },
            onBack: function() {
                Lampa.Controller.toggle('content');
            }
        });
    }

    // ============== ПЕРИОДИЧЕСКАЯ СИНХРОНИЗАЦИЯ ==============
    function startPeriodicSync() {
        setInterval(function() {
            const cfg = getConfig();
            if (cfg.token && cfg.gistId && cfg.autoSync && !isSyncing) {
                const timelines = getAllTimelines();
                if (Object.keys(timelines).length > 0) {
                    log('Periodic sync');
                    isSyncing = true;
                    syncToGist(false);
                    setTimeout(function() {
                        isSyncing = false;
                    }, 5000);
                }
            }
        }, SYNC_INTERVAL);
    }

    // ============== ЗАГРУЗКА ПРИ СТАРТЕ ==============
    function loadOnStart() {
        const cfg = getConfig();
        if (cfg.token && cfg.gistId) {
            setTimeout(function() {
                syncFromGist(false, true);
            }, 3000);
        }
        
        setTimeout(function() {
            integrityCheck();
        }, 10000);
        
        setInterval(integrityCheck, 5 * 60 * 1000);
    }

    // ============== ИНИЦИАЛИЗАЦИЯ ==============
    function init() {
        const cfg = getConfig();
        if (!cfg.enabled) {
            log('Disabled');
            return;
        }

        const cleaned = cleanupOldData();
        if (cleaned > 0) {
            log('Cleaned up old data on startup');
        }

        const timelines = getAllTimelines();
        const count = Object.keys(timelines).length;
        
        log('===== INIT =====');
        log('Profile:', getProfileId() || 'default');
        log('Found', count, 'timelines');
        log('Token:', cfg.token ? '✓' : '✗');
        log('Gist ID:', cfg.gistId ? '✓' : '✗');
        log('Auto sync:', cfg.autoSync ? '✓' : '✗');
        log('=================');

        setupSettings();
        initPlayerListeners();
        initActivityListeners();
        startPeriodicSync();
        loadOnStart();

        log('Ready');
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
