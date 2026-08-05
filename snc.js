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

    // ============== ПОЛУЧЕНИЕ ИНФОРМАЦИИ О КОНТЕНТЕ ПО ХЕШУ ==============
    function getContentInfo(hash) {
        try {
            // Пытаемся получить информацию из разных источников
            const fileView = Lampa.Storage.get('file_view', {});
            const item = fileView[hash];
            
            if (!item) return null;
            
            // Пытаемся определить тип контента и количество эпизодов
            // Для сериалов хеш обычно содержит сезон и эпизод
            const hashParts = hash.split('_');
            if (hashParts.length >= 3) {
                // Это похоже на сериал: "title_s1_e1"
                const title = hashParts.slice(0, -2).join('_');
                const season = parseInt(hashParts[hashParts.length - 2].replace('s', ''));
                const episode = parseInt(hashParts[hashParts.length - 1].replace('e', ''));
                
                // Ищем все эпизоды этого сериала
                const allEpisodes = Object.keys(fileView).filter(h => {
                    return h.startsWith(title) && h.includes('_s' + season + '_e');
                });
                
                return {
                    type: 'series',
                    title: title,
                    season: season,
                    episode: episode,
                    totalEpisodes: allEpisodes.length,
                    watchedEpisodes: allEpisodes.filter(h => {
                        const e = fileView[h];
                        return e && e.percent && e.percent >= 90;
                    }).length
                };
            } else {
                // Это фильм
                return {
                    type: 'movie',
                    title: hash,
                    percent: item.percent || 0
                };
            }
        } catch(e) {
            return null;
        }
    }

    // ============== ПОЛУЧЕНИЕ НАСТРОЕК АВТОУДАЛЕНИЯ ==============
    function getAutoCleanupSettings() {
        return Lampa.Storage.get('timeline_cleanup_settings', {
            enabled: false,
            maxCount: 100,
            percentThreshold: 90,
            daysThreshold: 30,
            removeMovies: true,
            removeSeries: true
        });
    }

    function saveAutoCleanupSettings(settings) {
        Lampa.Storage.set('timeline_cleanup_settings', settings);
    }

    // ============== АВТОУДАЛЕНИЕ ТАЙМЛАЙНОВ ==============
    function autoCleanupTimelines() {
        const settings = getAutoCleanupSettings();
        if (!settings.enabled) {
            log('Auto cleanup disabled');
            return;
        }

        log('Starting auto cleanup...');
        const now = Date.now();
        const timelines = getAllTimelines();
        const toRemove = new Set();
        
        // Собираем информацию о каждом таймлайне
        const timelineInfo = {};
        const seriesGroups = {};
        
        for (const hash in timelines) {
            const item = timelines[hash];
            const info = getContentInfo(hash);
            
            if (info) {
                timelineInfo[hash] = {
                    ...item,
                    contentInfo: info
                };
                
                // Группируем сериалы
                if (info.type === 'series') {
                    const key = info.title + '_s' + info.season;
                    if (!seriesGroups[key]) {
                        seriesGroups[key] = {
                            title: info.title,
                            season: info.season,
                            episodes: []
                        };
                    }
                    seriesGroups[key].episodes.push({
                        hash: hash,
                        episode: info.episode,
                        percent: item.percent || 0,
                        updatedAt: item.updatedAt || 0
                    });
                }
            }
        }
        
        // Проверяем условия удаления
        for (const hash in timelines) {
            const item = timelines[hash];
            const info = timelineInfo[hash];
            
            if (!info) continue;
            
            let shouldRemove = false;
            let reason = '';
            
            // Проверка по проценту просмотра (для фильмов)
            if (info.contentInfo.type === 'movie') {
                if (settings.removeMovies && info.contentInfo.percent >= settings.percentThreshold) {
                    shouldRemove = true;
                    reason = 'Просмотрено ' + info.contentInfo.percent + '% (порог ' + settings.percentThreshold + '%)';
                }
            }
            
            // Проверка по времени (для всех)
            if (!shouldRemove && settings.daysThreshold > 0) {
                const daysOld = (now - (item.updatedAt || 0)) / (1000 * 60 * 60 * 24);
                if (daysOld >= settings.daysThreshold) {
                    shouldRemove = true;
                    reason = 'Давность ' + Math.round(daysOld) + ' дней (порог ' + settings.daysThreshold + ' дней)';
                }
            }
            
            if (shouldRemove) {
                toRemove.add(hash);
                log('Marked for removal:', hash, '-', reason);
            }
        }
        
        // Для сериалов проверяем, просмотрен ли весь сезон
        if (settings.removeSeries) {
            for (const groupKey in seriesGroups) {
                const group = seriesGroups[groupKey];
                const allEpisodesWatched = group.episodes.every(ep => ep.percent >= settings.percentThreshold);
                
                if (allEpisodesWatched && group.episodes.length > 0) {
                    // Удаляем все эпизоды этого сезона
                    group.episodes.forEach(ep => {
                        toRemove.add(ep.hash);
                        log('Marked series for removal:', ep.hash, '- весь сезон просмотрен');
                    });
                }
            }
        }
        
        // Проверка максимального количества
        if (settings.maxCount > 0 && Object.keys(timelines).length > settings.maxCount) {
            // Сортируем по дате обновления (самые старые сначала)
            const sorted = Object.keys(timelines)
                .filter(h => !toRemove.has(h))
                .sort((a, b) => (timelines[a].updatedAt || 0) - (timelines[b].updatedAt || 0));
            
            const toRemoveCount = Object.keys(timelines).length - settings.maxCount;
            for (let i = 0; i < Math.min(toRemoveCount, sorted.length); i++) {
                toRemove.add(sorted[i]);
                log('Marked for removal (max count):', sorted[i]);
            }
        }
        
        // Удаляем отмеченные таймлайны
        if (toRemove.size > 0) {
            log('Removing', toRemove.size, 'timelines');
            const keys = getAllTimelineKeys();
            
            keys.forEach(key => {
                try {
                    const storage = Lampa.Storage.get(key, {});
                    let removed = 0;
                    
                    toRemove.forEach(hash => {
                        if (storage[hash]) {
                            delete storage[hash];
                            removed++;
                        }
                    });
                    
                    if (removed > 0) {
                        Lampa.Storage.set(key, storage);
                        log('Removed', removed, 'items from', key);
                    }
                } catch(e) {
                    logError('Error removing from', key, ':', e);
                }
            });
            
            // Обновляем Gist
            syncToGist(false);
            
            notify('🧹 Удалено ' + toRemove.size + ' таймлайнов');
        } else {
            log('No timelines to remove');
        }
    }

    // ============== ОЧИСТКА ЛОКАЛЬНЫХ ТАЙМЛАЙНОВ ==============
    function clearLocalTimelines(confirmAction = true) {
        return new Promise((resolve, reject) => {
            if (confirmAction) {
                Lampa.Select.show({
                    title: '🧹 Очистка таймлайнов',
                    items: [
                        { title: '⚠️ Удалить ВСЕ таймлайны из локального хранилища', action: 'clear_all', danger: true },
                        { title: '📊 Удалить только просмотренные (≥90%)', action: 'clear_watched' },
                        { title: '📅 Удалить старые (>30 дней)', action: 'clear_old' },
                        { title: '──────────', separator: true },
                        { title: '❌ Отмена', action: 'cancel' }
                    ],
                    onSelect: function(item) {
                        if (item.action === 'cancel') {
                            resolve(false);
                            return;
                        }
                        
                        if (item.danger) {
                            Lampa.Select.show({
                                title: '⚠️ Подтверждение',
                                items: [
                                    { title: '✅ Да, удалить все', action: 'confirm' },
                                    { title: '❌ Отмена', action: 'cancel' }
                                ],
                                onSelect: function(confirmItem) {
                                    if (confirmItem.action === 'confirm') {
                                        performClear(item.action);
                                        resolve(true);
                                    } else {
                                        resolve(false);
                                    }
                                }
                            });
                        } else {
                            performClear(item.action);
                            resolve(true);
                        }
                    }
                });
            } else {
                performClear('clear_all');
                resolve(true);
            }
        });
    }

    function performClear(action) {
        const keys = getAllTimelineKeys();
        const now = Date.now();
        let totalRemoved = 0;
        
        keys.forEach(key => {
            try {
                const storage = Lampa.Storage.get(key, {});
                let removed = 0;
                const toRemove = [];
                
                for (const hash in storage) {
                    const item = storage[hash];
                    let shouldRemove = false;
                    
                    if (action === 'clear_all') {
                        shouldRemove = true;
                    } else if (action === 'clear_watched') {
                        if (item.percent && item.percent >= 90) {
                            shouldRemove = true;
                        }
                    } else if (action === 'clear_old') {
                        const updated = item.updated || item.timestamp || 0;
                        if (now - updated > 30 * 24 * 60 * 60 * 1000) {
                            shouldRemove = true;
                        }
                    }
                    
                    if (shouldRemove) {
                        toRemove.push(hash);
                        removed++;
                    }
                }
                
                toRemove.forEach(hash => {
                    delete storage[hash];
                });
                
                if (removed > 0) {
                    Lampa.Storage.set(key, storage);
                    totalRemoved += removed;
                    log('Cleared', removed, 'items from', key);
                }
            } catch(e) {
                logError('Error clearing from', key, ':', e);
            }
        });
        
        notify('🧹 Очищено ' + totalRemoved + ' таймлайнов');
        
        // Обновляем интерфейс
        if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
            Lampa.Timeline.read(true);
        }
        
        // Синхронизируем с Gist
        syncToGist(false);
    }

    // ============== СОХРАНЕНИЕ ТАЙМЛАЙНОВ ВО ВСЕ ХРАНИЛИЩА ==============
    function saveTimelinesToAllStorages(timelines) {
        const keys = getAllTimelineKeys();
        let saved = 0;

        const dataByKey = {};
        keys.forEach(key => {
            dataByKey[key] = {};
        });

        for (const hash in timelines) {
            const item = timelines[hash];
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

        const timelines = getAllTimelines();
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
    var lastSyncTime = 0;

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

            // Настройки автоочистки
            if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addParam === 'function') {
                const settings = getAutoCleanupSettings();
                
                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_header',
                        type: 'title'
                    },
                    field: {
                        name: '🧹 Автоочистка таймлайнов'
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'auto_cleanup_enabled',
                        type: 'toggle',
                        default: settings.enabled
                    },
                    field: {
                        name: 'Включить автоочистку',
                        description: 'Автоматически удалять старые таймлайны'
                    },
                    onChange: function(value) {
                        const s = getAutoCleanupSettings();
                        s.enabled = value === 'true';
                        saveAutoCleanupSettings(s);
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'auto_cleanup_max_count',
                        type: 'input',
                        placeholder: '100',
                        default: settings.maxCount
                    },
                    field: {
                        name: 'Максимальное количество',
                        description: 'Оставлять не более N таймлайнов (0 - без ограничения)'
                    },
                    onChange: function(value) {
                        const s = getAutoCleanupSettings();
                        s.maxCount = parseInt(value) || 0;
                        saveAutoCleanupSettings(s);
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'auto_cleanup_percent',
                        type: 'input',
                        placeholder: '90',
                        default: settings.percentThreshold
                    },
                    field: {
                        name: 'Порог просмотра (%)',
                        description: 'Удалять при достижении этого процента просмотра'
                    },
                    onChange: function(value) {
                        const s = getAutoCleanupSettings();
                        s.percentThreshold = parseInt(value) || 90;
                        saveAutoCleanupSettings(s);
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'auto_cleanup_days',
                        type: 'input',
                        placeholder: '30',
                        default: settings.daysThreshold
                    },
                    field: {
                        name: 'Максимальный возраст (дней)',
                        description: 'Удалять таймлайны старше N дней (0 - без ограничения)'
                    },
                    onChange: function(value) {
                        const s = getAutoCleanupSettings();
                        s.daysThreshold = parseInt(value) || 0;
                        saveAutoCleanupSettings(s);
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'auto_cleanup_movies',
                        type: 'toggle',
                        default: settings.removeMovies
                    },
                    field: {
                        name: 'Удалять фильмы',
                        description: 'Удалять таймлайны фильмов при достижении порога'
                    },
                    onChange: function(value) {
                        const s = getAutoCleanupSettings();
                        s.removeMovies = value === 'true';
                        saveAutoCleanupSettings(s);
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'auto_cleanup_series',
                        type: 'toggle',
                        default: settings.removeSeries
                    },
                    field: {
                        name: 'Удалять сериалы',
                        description: 'Удалять таймлайны сериалов только когда все серии просмотрены'
                    },
                    onChange: function(value) {
                        const s = getAutoCleanupSettings();
                        s.removeSeries = value === 'true';
                        saveAutoCleanupSettings(s);
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'auto_cleanup_now',
                        type: 'button'
                    },
                    field: {
                        name: '▶️ Запустить автоочистку сейчас',
                        description: 'Применить текущие настройки автоочистки'
                    },
                    onChange: function() {
                        autoCleanupTimelines();
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'separator_clear',
                        type: 'title'
                    },
                    field: {
                        name: '──────────'
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'clear_local',
                        type: 'button'
                    },
                    field: {
                        name: '🧹 Очистить локальные таймлайны',
                        description: 'Удалить таймлайны из локального хранилища'
                    },
                    onChange: function() {
                        clearLocalTimelines(true);
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'clear_gist',
                        type: 'button'
                    },
                    field: {
                        name: '🗑️ Очистить Gist',
                        description: 'Удалить все таймлайны из Gist (требуется подтверждение)'
                    },
                    onChange: function() {
                        Lampa.Select.show({
                            title: '⚠️ Очистка Gist',
                            items: [
                                { title: '❌ Отмена', action: 'cancel' },
                                { title: '⚠️ Удалить все таймлайны из Gist', action: 'clear', danger: true }
                            ],
                            onSelect: function(item) {
                                if (item.action === 'clear') {
                                    Lampa.Select.show({
                                        title: '⚠️ Подтверждение',
                                        items: [
                                            { title: '✅ Да, удалить всё', action: 'confirm' },
                                            { title: '❌ Отмена', action: 'cancel' }
                                        ],
                                        onSelect: function(confirmItem) {
                                            if (confirmItem.action === 'confirm') {
                                                const cfg = getConfig();
                                                if (cfg.token && cfg.gistId) {
                                                    // Создаем пустой Gist
                                                    const data = {
                                                        description: 'Lampa Timeline Sync',
                                                        public: false,
                                                        files: {
                                                            'timeline.json': {
                                                                content: JSON.stringify({
                                                                    version: 2,
                                                                    profile: getProfileId() || 'default',
                                                                    updated: new Date().toISOString(),
                                                                    count: 0,
                                                                    timelines: {}
                                                                }, null, 2)
                                                            }
                                                        }
                                                    };
                                                    
                                                    fetch(GIST_API + '/' + cfg.gistId, {
                                                        method: 'PATCH',
                                                        headers: {
                                                            'Authorization': 'token ' + cfg.token,
                                                            'Accept': 'application/vnd.github.v3+json',
                                                            'Content-Type': 'application/json'
                                                        },
                                                        body: JSON.stringify(data)
                                                    })
                                                    .then(() => {
                                                        notify('🗑️ Gist очищен');
                                                    })
                                                    .catch(() => {
                                                        notify('❌ Ошибка очистки Gist');
                                                    });
                                                }
                                            }
                                        }
                                    });
                                }
                            }
                        });
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'timeline_gist_setup',
                        type: 'button'
                    },
                    field: {
                        name: '⚙️ Настройка Gist',
                        description: 'GitHub Gist для синхронизации прогресса'
                    },
                    onChange: function() {
                        showGistSetup();
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
        const cleanupSettings = getAutoCleanupSettings();
        
        Lampa.Select.show({
            title: '☁️ GitHub Gist',
            items: [
                { title: '🔑 Токен: ' + (cfg.token ? '✅ Установлен' : '❌ Не установлен'), action: 'token' },
                { title: '📄 Gist ID: ' + (cfg.gistId ? cfg.gistId.substring(0, 8) + '…' : '❌ Не создан'), action: 'id' },
                { title: '👤 Profile ID: ' + profileId, action: 'status' },
                { title: '──────────', separator: true },
                { title: '📊 Таймлайнов: ' + count, action: 'status' },
                { title: '🔄 Последняя синхр.: ' + lastSync, action: 'status' },
                { title: '──────────', separator: true },
                { title: '📤 Выгрузить в Gist', action: 'upload' },
                { title: '📥 Загрузить из Gist', action: 'download' },
                { title: '──────────', separator: true },
                { title: '🧹 Автоочистка: ' + (cleanupSettings.enabled ? '✅ Вкл' : '❌ Выкл'), action: 'cleanup_settings' },
                { title: '──────────', separator: true },
                { title: '🔄 Автосинхр.: ' + (cfg.autoSync ? '✅ Вкл' : '❌ Выкл'), action: 'toggle_auto' },
                { title: '──────────', separator: true },
                { title: '🗑️ Очистить Gist', action: 'clear_gist' },
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
                } else if (item.action === 'cleanup_settings') {
                    Lampa.Controller.toggle('settings_component');
                    setTimeout(() => {
                        Lampa.Settings.open('timeline_gist');
                    }, 100);
                } else if (item.action === 'clear_gist') {
                    Lampa.Select.show({
                        title: '⚠️ Очистка Gist',
                        items: [
                            { title: '❌ Отмена', action: 'cancel' },
                            { title: '⚠️ Удалить все таймлайны из Gist', action: 'clear', danger: true }
                        ],
                        onSelect: function(clearItem) {
                            if (clearItem.action === 'clear') {
                                Lampa.Select.show({
                                    title: '⚠️ Подтверждение',
                                    items: [
                                        { title: '✅ Да, удалить всё', action: 'confirm' },
                                        { title: '❌ Отмена', action: 'cancel' }
                                    ],
                                    onSelect: function(confirmItem) {
                                        if (confirmItem.action === 'confirm') {
                                            const cfg = getConfig();
                                            if (cfg.token && cfg.gistId) {
                                                const data = {
                                                    description: 'Lampa Timeline Sync',
                                                    public: false,
                                                    files: {
                                                        'timeline.json': {
                                                            content: JSON.stringify({
                                                                version: 2,
                                                                profile: getProfileId() || 'default',
                                                                updated: new Date().toISOString(),
                                                                count: 0,
                                                                timelines: {}
                                                            }, null, 2)
                                                        }
                                                    }
                                                };
                                                
                                                fetch(GIST_API + '/' + cfg.gistId, {
                                                    method: 'PATCH',
                                                    headers: {
                                                        'Authorization': 'token ' + cfg.token,
                                                        'Accept': 'application/vnd.github.v3+json',
                                                        'Content-Type': 'application/json'
                                                    },
                                                    body: JSON.stringify(data)
                                                })
                                                .then(() => {
                                                    notify('🗑️ Gist очищен');
                                                    showGistSetup();
                                                })
                                                .catch(() => {
                                                    notify('❌ Ошибка очистки Gist');
                                                    showGistSetup();
                                                });
                                            }
                                        } else {
                                            showGistSetup();
                                        }
                                    }
                                });
                            } else {
                                showGistSetup();
                            }
                        }
                    });
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
        
        // Периодическая автоочистка
        setInterval(function() {
            const settings = getAutoCleanupSettings();
            if (settings.enabled) {
                autoCleanupTimelines();
            }
        }, 60 * 60 * 1000); // Каждый час
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
