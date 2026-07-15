(function() {
    'use strict';

    if (window.timeline_gist_loaded) return;
    window.timeline_gist_loaded = true;

    // ============== КОНФИГУРАЦИЯ ==============
    const CFG_KEY = 'timeline_gist_config';
    const GIST_API = 'https://api.github.com/gists';
    const SYNC_INTERVAL = 60000;
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

    function getFileViewKey() {
        const profileId = getProfileId();
        return profileId ? 'file_view_' + profileId : 'file_view';
    }

    // ============== ХРАНИЛИЩЕ ==============
    function getConfig() {
        return Lampa.Storage.get(CFG_KEY, {
            token: '',
            gistId: '',
            lastSync: 0,
            enabled: true,
            maxTimelines: 500,
            cleanupDays: 60,
            cleanupPercent: 95,
            cleanupWatched: true,
            cleanupOld: true
        });
    }

    function saveConfig(cfg) {
        Lampa.Storage.set(CFG_KEY, cfg, true);
    }

    function notify(text) {
        Lampa.Noty.show(text);
    }

    // ============== ПОЛУЧЕНИЕ ТАЙМЛАЙНОВ ==============
    function getAllTimelines() {
        const key = getFileViewKey();
        const data = Lampa.Storage.get(key, {});
        const timelines = {};
        const now = Date.now();

        for (const hash in data) {
            const item = data[hash];
            if (!item || !item.time || item.time <= 0) continue;
            
            timelines[hash] = {
                time: Math.round(item.time),
                duration: Math.round(item.duration || 0),
                percent: Math.round(item.percent || 0),
                updatedAt: item.updated || now
            };
        }

        return timelines;
    }

    function saveTimelineToFileView(hash, time, duration, percent) {
        if (!hash || !time || time <= 0) return;

        const key = getFileViewKey();
        const fileView = Lampa.Storage.get(key, {});
        
        fileView[hash] = {
            time: Math.round(time),
            duration: Math.round(duration || 0),
            percent: Math.round(percent || 0),
            updated: Date.now()
        };
        
        Lampa.Storage.set(key, fileView, true);
        
        const mainView = Lampa.Storage.get('file_view', {});
        mainView[hash] = {
            time: Math.round(time),
            duration: Math.round(duration || 0),
            percent: Math.round(percent || 0),
            updated: Date.now()
        };
        Lampa.Storage.set('file_view', mainView, true);
        
        if (Lampa.Timeline && typeof Lampa.Timeline.update === 'function') {
            Lampa.Timeline.update({
                hash: hash,
                time: time,
                duration: duration || 0,
                percent: percent || 0
            });
        }
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
            }
        } catch(e) {
            logError('Hash generation error:', e);
        }
        return null;
    }

    // ============== ФОРМАТИРОВАНИЕ ВРЕМЕНИ ==============
    function formatTotalTime(seconds) {
        if (seconds < 60) return Math.round(seconds) + ' с';
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (hours > 0) return hours + ' ч ' + minutes + ' мин';
        return minutes + ' мин';
    }

    // ============== ОЧИСТКА ТАЙМЛАЙНОВ ==============
    function cleanupTimelines(timelines) {
        const cfg = getConfig();
        const now = Date.now();
        const maxSize = cfg.maxTimelines || 500;
        const daysThreshold = cfg.cleanupDays || 60;
        const percentThreshold = cfg.cleanupPercent || 95;
        
        log('Cleanup started, current count:', Object.keys(timelines).length);
        
        let cleaned = 0;
        let result = {};
        
        if (cfg.cleanupWatched !== false) {
            for (const hash in timelines) {
                const item = timelines[hash];
                if (item.percent >= percentThreshold) {
                    cleaned++;
                    log('Removed watched:', hash, 'percent:', item.percent + '%');
                    continue;
                }
                result[hash] = item;
            }
            log('Step 1: Removed', cleaned, 'watched timelines');
        }
        
        if (cfg.cleanupOld !== false) {
            const timeThreshold = now - (daysThreshold * 24 * 60 * 60 * 1000);
            let oldCleaned = 0;
            
            for (const hash in result) {
                const item = result[hash];
                if (item.updatedAt < timeThreshold) {
                    oldCleaned++;
                    cleaned++;
                    log('Removed old:', hash, 'updated:', new Date(item.updatedAt).toLocaleDateString());
                    delete result[hash];
                }
            }
            log('Step 2: Removed', oldCleaned, 'old timelines');
        }
        
        const keys = Object.keys(result);
        if (keys.length > maxSize) {
            keys.sort(function(a, b) {
                return (result[a].updatedAt || 0) - (result[b].updatedAt || 0);
            });
            
            const toRemove = keys.slice(0, keys.length - maxSize);
            toRemove.forEach(function(hash) {
                delete result[hash];
                cleaned++;
                log('Removed by limit:', hash);
            });
            log('Step 3: Limited to', maxSize, 'items');
        }
        
        log('Cleanup complete, removed:', cleaned, 'remaining:', Object.keys(result).length);
        
        return result;
    }

    // ============== СТАТИСТИКА ==============
    function showStatsDialog() {
        const timelines = getAllTimelines();
        const count = Object.keys(timelines).length;
        const now = Date.now();
        
        let watched = 0;
        let watching = 0;
        let old = 0;
        let totalTime = 0;
        let newest = 0;
        let oldest = Infinity;
        
        for (const hash in timelines) {
            const item = timelines[hash];
            if (item.percent >= 95) watched++;
            else if (item.percent > 0) watching++;
            
            if ((item.updatedAt || 0) < (now - 60 * 24 * 60 * 60 * 1000)) old++;
            
            totalTime += item.time || 0;
            if ((item.updatedAt || 0) > newest) newest = item.updatedAt || 0;
            if ((item.updatedAt || 0) < oldest) oldest = item.updatedAt || 0;
        }
        
        const dataSize = new Blob([JSON.stringify(timelines)]).size;
        const sizeInKB = Math.round(dataSize / 1024);
        
        Lampa.Select.show({
            title: '📊 Статистика таймлайнов',
            items: [
                { title: '📊 Всего: ' + count, action: 'none' },
                { title: '✅ Просмотрено (>95%): ' + watched, action: 'none' },
                { title: '👁️ В процессе: ' + watching, action: 'none' },
                { title: '📅 Старых (>60 дней): ' + old, action: 'none' },
                { title: '──────────', separator: true },
                { title: '⏱️ Общее время: ' + formatTotalTime(totalTime), action: 'none' },
                { title: '📦 Размер: ' + sizeInKB + ' KB', action: 'none' },
                { title: '🔄 Последнее обновление: ' + (newest ? new Date(newest).toLocaleDateString() : 'Нет'), action: 'none' },
                { title: '📅 Самое старое: ' + (oldest !== Infinity ? new Date(oldest).toLocaleDateString() : 'Нет'), action: 'none' },
                { title: '──────────', separator: true },
                { title: '◀ Назад', action: 'back' }
            ],
            onSelect: function(item) {
                if (item.action === 'back') {
                    showCleanupDialog();
                }
            },
            onBack: function() {
                showCleanupDialog();
            }
        });
    }

    // ============== ДИАЛОГ ОЧИСТКИ ==============
    function showCleanupDialog() {
        Lampa.Select.show({
            title: '🧹 Очистка таймлайнов',
            items: [
                { title: '🗑️ Удалить просмотренные (>95%)', action: 'watched' },
                { title: '🗑️ Удалить старые (>60 дней)', action: 'old' },
                { title: '🗑️ Удалить ВСЕ таймлайны', action: 'all' },
                { title: '──────────', separator: true },
                { title: '📊 Показать статистику', action: 'stats' },
                { title: '──────────', separator: true },
                { title: '❌ Отмена', action: 'cancel' }
            ],
            onSelect: function(item) {
                if (item.action === 'watched') {
                    const timelines = getAllTimelines();
                    let removed = 0;
                    
                    for (const hash in timelines) {
                        if (timelines[hash].percent >= 95) {
                            delete timelines[hash];
                            removed++;
                        }
                    }
                    
                    const key = getFileViewKey();
                    const fileView = Lampa.Storage.get(key, {});
                    for (const hash in timelines) {
                        if (!fileView[hash]) {
                            fileView[hash] = {
                                time: timelines[hash].time,
                                duration: timelines[hash].duration || 0,
                                percent: timelines[hash].percent || 0,
                                updated: timelines[hash].updatedAt || Date.now()
                            };
                        }
                    }
                    Lampa.Storage.set(key, fileView, true);
                    
                    const mainView = Lampa.Storage.get('file_view', {});
                    for (const hash in timelines) {
                        if (!mainView[hash]) {
                            mainView[hash] = {
                                time: timelines[hash].time,
                                duration: timelines[hash].duration || 0,
                                percent: timelines[hash].percent || 0,
                                updated: timelines[hash].updatedAt || Date.now()
                            };
                        }
                    }
                    Lampa.Storage.set('file_view', mainView, true);
                    
                    notify('🗑️ Удалено просмотренных: ' + removed);
                    syncToGist(true);
                } else if (item.action === 'old') {
                    const now = Date.now();
                    const threshold = now - (60 * 24 * 60 * 60 * 1000);
                    const timelines = getAllTimelines();
                    let removed = 0;
                    
                    for (const hash in timelines) {
                        if ((timelines[hash].updatedAt || 0) < threshold) {
                            delete timelines[hash];
                            removed++;
                        }
                    }
                    
                    const key = getFileViewKey();
                    const fileView = Lampa.Storage.get(key, {});
                    for (const hash in timelines) {
                        if (!fileView[hash]) {
                            fileView[hash] = {
                                time: timelines[hash].time,
                                duration: timelines[hash].duration || 0,
                                percent: timelines[hash].percent || 0,
                                updated: timelines[hash].updatedAt || Date.now()
                            };
                        }
                    }
                    Lampa.Storage.set(key, fileView, true);
                    
                    const mainView = Lampa.Storage.get('file_view', {});
                    for (const hash in timelines) {
                        if (!mainView[hash]) {
                            mainView[hash] = {
                                time: timelines[hash].time,
                                duration: timelines[hash].duration || 0,
                                percent: timelines[hash].percent || 0,
                                updated: timelines[hash].updatedAt || Date.now()
                            };
                        }
                    }
                    Lampa.Storage.set('file_view', mainView, true);
                    
                    notify('🗑️ Удалено старых: ' + removed);
                    syncToGist(true);
                } else if (item.action === 'all') {
                    Lampa.Select.show({
                        title: '⚠️ Удалить ВСЕ таймлайны?',
                        items: [
                            { title: 'Нет', action: 'cancel' },
                            { title: 'Да, удалить всё', action: 'clear' }
                        ],
                        onSelect: function(opt) {
                            if (opt.action === 'clear') {
                                const key = getFileViewKey();
                                Lampa.Storage.set(key, {}, true);
                                Lampa.Storage.set('file_view', {}, true);
                                if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
                                    Lampa.Timeline.read(true);
                                }
                                notify('🗑️ Все таймлайны удалены');
                                syncToGist(true);
                            }
                        }
                    });
                } else if (item.action === 'stats') {
                    showStatsDialog();
                }
            },
            onBack: function() {
                showGistSetup();
            }
        });
    }

    // ============== РАБОТА С GIST ==============
    function syncToGist(showNotify = true) {
        const cfg = getConfig();
        
        if (!cfg.token) {
            if (showNotify) notify('⚠️ GitHub Token не настроен');
            return false;
        }

        const rawTimelines = getAllTimelines();
        const timelines = cleanupTimelines(rawTimelines);
        const count = Object.keys(timelines).length;
        
        if (count === 0) {
            if (showNotify) notify('⚠️ Нет таймлайнов для синхронизации');
            return false;
        }

        log('Syncing', count, 'timelines to Gist (cleaned)');

        const data = {
            description: 'Lampa Timeline Sync - ' + (getProfileId() || 'default'),
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

        let url = GIST_API;
        let method = 'POST';
        
        if (cfg.gistId) {
            url = GIST_API + '/' + cfg.gistId;
            method = 'PATCH';
        }

        const dataSize = new Blob([JSON.stringify(data)]).size;
        const sizeInKB = Math.round(dataSize / 1024);
        log('Data size:', sizeInKB, 'KB');
        
        if (dataSize > 900 * 1024) {
            logError('Data too large:', sizeInKB, 'KB');
            if (showNotify) notify('⚠️ Данные слишком большие (' + sizeInKB + ' KB). Уменьшите настройки очистки');
            return false;
        }

        $.ajax({
            url: url,
            method: method,
            headers: {
                'Authorization': 'token ' + cfg.token,
                'Accept': 'application/vnd.github.v3+json'
            },
            data: JSON.stringify(data),
            success: function(response) {
                if (!cfg.gistId && response && response.id) {
                    const newCfg = getConfig();
                    newCfg.gistId = response.id;
                    newCfg.lastSync = Date.now();
                    saveConfig(newCfg);
                    if (showNotify) notify('✅ Создан новый Gist: ' + response.id);
                } else {
                    const newCfg = getConfig();
                    newCfg.lastSync = Date.now();
                    saveConfig(newCfg);
                    if (showNotify) notify('✅ Синхронизировано ' + count + ' таймлайнов (' + sizeInKB + ' KB)');
                }
                log('Sync complete');
            },
            error: function(xhr) {
                logError('Sync error:', xhr.status);
                if (xhr.status === 404 && cfg.gistId) {
                    const newCfg = getConfig();
                    newCfg.gistId = '';
                    saveConfig(newCfg);
                    if (showNotify) notify('🔄 Gist не найден, создаю новый...');
                    setTimeout(function() {
                        syncToGist(showNotify);
                    }, 1000);
                } else {
                    let errorMsg = 'Ошибка синхронизации';
                    try {
                        const response = JSON.parse(xhr.responseText);
                        if (response && response.message) {
                            errorMsg = response.message;
                        }
                    } catch(e) {
                        errorMsg = 'Status ' + xhr.status;
                    }
                    if (showNotify) notify('❌ ' + errorMsg);
                }
            }
        });
    }

    function syncFromGist(showNotify = true) {
        const cfg = getConfig();
        
        if (!cfg.token) {
            if (showNotify) notify('⚠️ GitHub Token не настроен');
            return false;
        }

        if (!cfg.gistId) {
            if (showNotify) notify('⚠️ Gist ID не настроен');
            return false;
        }

        log('Loading from Gist:', cfg.gistId);

        $.ajax({
            url: GIST_API + '/' + cfg.gistId,
            method: 'GET',
            headers: {
                'Authorization': 'token ' + cfg.token,
                'Accept': 'application/vnd.github.v3+json'
            },
            success: function(data) {
                try {
                    const content = data.files && data.files['timeline.json'] ? data.files['timeline.json'].content : null;
                    
                    if (!content) {
                        if (showNotify) notify('⚠️ Файл timeline.json не найден');
                        return;
                    }

                    const remote = JSON.parse(content);
                    const remoteTimelines = remote.timelines || {};
                    
                    if (Object.keys(remoteTimelines).length === 0) {
                        if (showNotify) notify('⚠️ В Gist нет таймлайнов');
                        return;
                    }

                    const key = getFileViewKey();
                    const fileView = Lampa.Storage.get(key, {});
                    let changes = 0;

                    for (const hash in remoteTimelines) {
                        const remoteData = remoteTimelines[hash];
                        const localData = fileView[hash];
                        
                        if (!localData || remoteData.updatedAt > (localData.updated || 0)) {
                            fileView[hash] = {
                                time: remoteData.time,
                                duration: remoteData.duration || 0,
                                percent: remoteData.percent || 0,
                                updated: remoteData.updatedAt || Date.now()
                            };
                            changes++;
                        }
                    }

                    if (changes > 0) {
                        Lampa.Storage.set(key, fileView, true);
                        
                        const mainView = Lampa.Storage.get('file_view', {});
                        for (const hash in remoteTimelines) {
                            if (!mainView[hash]) {
                                mainView[hash] = {
                                    time: remoteTimelines[hash].time,
                                    duration: remoteTimelines[hash].duration || 0,
                                    percent: remoteTimelines[hash].percent || 0,
                                    updated: remoteTimelines[hash].updatedAt || Date.now()
                                };
                            }
                        }
                        Lampa.Storage.set('file_view', mainView, true);
                        
                        if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
                            Lampa.Timeline.read(true);
                        }
                        
                        if (showNotify) notify('📥 Загружено ' + changes + ' таймлайнов');
                    } else {
                        if (showNotify) notify('✅ Данные актуальны');
                    }

                    const newCfg = getConfig();
                    newCfg.lastSync = Date.now();
                    saveConfig(newCfg);

                } catch(e) {
                    logError('Parse error:', e);
                    if (showNotify) notify('❌ Ошибка чтения данных');
                }
            },
            error: function(xhr) {
                logError('Load error:', xhr.status);
                if (xhr.status === 404) {
                    if (showNotify) notify('❌ Gist не найден (404)');
                } else if (xhr.status === 401) {
                    if (showNotify) notify('❌ Ошибка авторизации. Проверьте токен');
                } else {
                    if (showNotify) notify('❌ Ошибка загрузки: ' + xhr.status);
                }
            }
        });
    }

    // ============== ПЕРЕХВАТ ВНЕШНИХ ПЛЕЕРОВ ==============
    let externalSyncInterval = null;
    let externalLastTime = 0;

    function handleExternalPlayerTime(time, duration) {
        const data = window._externalPlayerData;
        if (!data || !data.isActive || !data.hash) return;
        
        if (!time || time <= 0) return;
        
        const now = Date.now();
        if (now - data.lastSaveTime < 5000) return;
        
        if (Math.abs(time - externalLastTime) < 2) return;
        externalLastTime = time;
        
        const percent = duration > 0 ? Math.round((time / duration) * 100) : 0;
        
        saveTimelineToFileView(data.hash, time, duration || 0, percent);
        
        data.lastSaveTime = now;
        data.lastTime = time;
        
        scheduleSync();
    }

    function startExternalPlayerSync() {
        if (externalSyncInterval) {
            clearInterval(externalSyncInterval);
            externalSyncInterval = null;
        }
        
        externalSyncInterval = setInterval(function() {
            const data = window._externalPlayerData;
            if (!data || !data.isActive) {
                clearInterval(externalSyncInterval);
                externalSyncInterval = null;
                return;
            }
            
            try {
                if (typeof AndroidJS !== 'undefined' && typeof AndroidJS.getPlayerTime === 'function') {
                    const time = AndroidJS.getPlayerTime();
                    const duration = typeof AndroidJS.getPlayerDuration === 'function' ? AndroidJS.getPlayerDuration() : 0;
                    
                    if (time && time > 0) {
                        handleExternalPlayerTime(time, duration);
                    }
                }
            } catch(e) {}
        }, 3000);
    }

    function stopExternalPlayerSync() {
        if (externalSyncInterval) {
            clearInterval(externalSyncInterval);
            externalSyncInterval = null;
        }
        if (window._externalPlayerData) {
            window._externalPlayerData.isActive = false;
        }
    }

    function initExternalPlayerSupport() {
        if (Lampa.Android && typeof Lampa.Android.openPlayer === 'function') {
            const originalOpenPlayer = Lampa.Android.openPlayer;
            
            Lampa.Android.openPlayer = function(link, data) {
                const activity = Lampa.Activity.active();
                const movie = activity?.movie;
                
                if (movie && data) {
                    const season = data.season || 1;
                    const episode = data.episode || 1;
                    const hash = generateHash(movie, season, episode);
                    
                    if (hash) {
                        window._externalPlayerData = {
                            hash: hash,
                            movie: movie,
                            season: season,
                            episode: episode,
                            lastTime: 0,
                            lastSaveTime: Date.now(),
                            isActive: true
                        };
                        startExternalPlayerSync();
                    }
                }
                
                return originalOpenPlayer.call(Lampa.Android, link, data);
            };
        }

        if (Lampa.Android && typeof Lampa.Android.openTorrent === 'function') {
            const originalOpenTorrent = Lampa.Android.openTorrent;
            
            Lampa.Android.openTorrent = function(data) {
                const activity = Lampa.Activity.active();
                const movie = activity?.movie;
                
                if (movie) {
                    const hash = generateHash(movie, 1, 1);
                    if (hash) {
                        window._externalPlayerData = {
                            hash: hash,
                            movie: movie,
                            season: 1,
                            episode: 1,
                            lastTime: 0,
                            lastSaveTime: Date.now(),
                            isActive: true
                        };
                        startExternalPlayerSync();
                    }
                }
                
                return originalOpenTorrent.call(Lampa.Android, data);
            };
        }

        if (typeof AndroidJS !== 'undefined') {
            if (typeof AndroidJS.onTimeUpdate === 'function') {
                const originalOnTimeUpdate = AndroidJS.onTimeUpdate;
                AndroidJS.onTimeUpdate = function(time, duration) {
                    handleExternalPlayerTime(time, duration);
                    if (originalOnTimeUpdate) {
                        originalOnTimeUpdate.call(AndroidJS, time, duration);
                    }
                };
            }
        }
    }

    // ============== ДИАЛОГ НАСТРОЕК ==============
    function showGistSetup() {
        const cfg = getConfig();
        const count = Object.keys(getAllTimelines()).length;
        const lastSync = cfg.lastSync ? new Date(cfg.lastSync).toLocaleString() : 'Никогда';
        
        Lampa.Select.show({
            title: '☁️ GitHub Gist Синхронизация',
            items: [
                { 
                    title: '🔑 Токен: ' + (cfg.token ? '✓ Установлен' : '❌ Не установлен'), 
                    action: 'token' 
                },
                { 
                    title: '📄 Gist ID: ' + (cfg.gistId ? cfg.gistId.substring(0, 8) + '…' : '❌ Не создан'), 
                    action: 'id' 
                },
                { title: '──────────', separator: true },
                { 
                    title: '📊 Таймлайнов: ' + count, 
                    action: 'status' 
                },
                { 
                    title: '🔄 Последняя синхр.: ' + lastSync, 
                    action: 'status' 
                },
                { title: '──────────', separator: true },
                { title: '📤 Выгрузить в Gist', action: 'upload' },
                { title: '📥 Загрузить из Gist', action: 'download' },
                { title: '──────────', separator: true },
                { title: '🧹 Очистка таймлайнов', action: 'cleanup' },
                { title: '──────────', separator: true },
                { title: '❌ Закрыть', action: 'cancel' }
            ],
            onSelect: function(item) {
                if (item.action === 'token') {
                    Lampa.Input.edit({
                        title: 'GitHub Personal Access Token',
                        value: cfg.token,
                        nosave: true
                    }, function(val) {
                        if (val !== null) {
                            const newCfg = getConfig();
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
                            const newCfg = getConfig();
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
                    syncFromGist(true);
                    setTimeout(function() {
                        showGistSetup();
                    }, 2000);
                } else if (item.action === 'cleanup') {
                    showCleanupDialog();
                } else if (item.action === 'status') {
                    showGistSetup();
                }
            },
            onBack: function() {
                Lampa.Controller.toggle('content');
            }
        });
    }

    // ============== СОБЫТИЯ ПЛЕЕРА ==============
    var syncTimer = null;
    var lastSyncTime = 0;

    function scheduleSync() {
        var now = Date.now();
        if (now - lastSyncTime < 10000) return;
        
        lastSyncTime = now;
        clearTimeout(syncTimer);
        syncTimer = setTimeout(function() {
            var cfg = getConfig();
            if (cfg.token && cfg.gistId) {
                syncToGist(false);
            }
        }, 5000);
    }

    function initPlayerListeners() {
        Lampa.Player.listener.follow('timeupdate', function(e) {
            const playData = Lampa.Player.playdata();
            if (playData && playData.url) {
                const activity = Lampa.Activity.active();
                const movie = activity?.movie;
                if (movie) {
                    const season = playData.season || 1;
                    const episode = playData.episode || 1;
                    const hash = generateHash(movie, season, episode);
                    
                    if (hash && playData.timeline) {
                        const time = playData.timeline.time || 0;
                        const duration = playData.timeline.duration || 0;
                        const percent = playData.timeline.percent || 0;
                        
                        if (time > 0) {
                            saveTimelineToFileView(hash, time, duration, percent);
                        }
                    }
                }
            }
            scheduleSync();
        });

        Lampa.Player.listener.follow('destroy', function() {
            clearTimeout(syncTimer);
            stopExternalPlayerSync();
            
            const playData = Lampa.Player.playdata();
            if (playData && playData.url) {
                const activity = Lampa.Activity.active();
                const movie = activity?.movie;
                if (movie && playData.timeline) {
                    const season = playData.season || 1;
                    const episode = playData.episode || 1;
                    const hash = generateHash(movie, season, episode);
                    
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
                var cfg = getConfig();
                if (cfg.token && cfg.gistId) {
                    syncToGist(false);
                }
            }, 1000);
        });
    }

    // ============== ПЕРИОДИЧЕСКАЯ СИНХРОНИЗАЦИЯ ==============
    function startPeriodicSync() {
        setInterval(function() {
            var cfg = getConfig();
            if (cfg.token && cfg.gistId) {
                var timelines = getAllTimelines();
                if (Object.keys(timelines).length > 0) {
                    syncToGist(false);
                }
            }
        }, SYNC_INTERVAL);
    }

    // ============== ЗАГРУЗКА ПРИ СТАРТЕ ==============
    function loadOnStart() {
        var cfg = getConfig();
        if (cfg.token && cfg.gistId) {
            setTimeout(function() {
                syncFromGist(false);
            }, 5000);
        }
    }

    // ============== НАСТРОЙКИ ЧЕРЕЗ SettingsApi ==============
    function setupSettings() {
        if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addComponent === 'function') {
            Lampa.SettingsApi.addComponent({
                component: 'timeline_gist',
                name: 'Синхронизация таймлайнов',
                icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M13,7H11V13H17V11H13V7Z"/></svg>'
            });
        }

        if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addParam === 'function') {
            Lampa.SettingsApi.addParam({
                component: 'timeline_gist',
                param: {
                    name: 'timeline_gist_setup',
                    type: 'button'
                },
                field: {
                    name: 'GitHub Gist синхронизация',
                    description: 'Настройка облачной синхронизации прогресса просмотра'
                },
                onChange: function() {
                    showGistSetup();
                }
            });
        }

        if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addParam === 'function') {
            Lampa.SettingsApi.addParam({
                component: 'timeline_gist',
                param: {
                    name: 'timeline_gist_force_sync',
                    type: 'button'
                },
                field: {
                    name: 'Принудительная синхронизация',
                    description: 'Выгрузить текущие таймлайны в Gist'
                },
                onChange: function() {
                    syncToGist(true);
                }
            });
        }

        if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addParam === 'function') {
            Lampa.SettingsApi.addParam({
                component: 'timeline_gist',
                param: {
                    name: 'timeline_gist_cleanup',
                    type: 'button'
                },
                field: {
                    name: '🧹 Очистка таймлайнов',
                    description: 'Удалить просмотренные, старые или все таймлайны'
                },
                onChange: function() {
                    showCleanupDialog();
                }
            });
        }

        if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addParam === 'function') {
            Lampa.SettingsApi.addParam({
                component: 'timeline_gist',
                param: {
                    name: 'timeline_gist_max_items',
                    type: 'input'
                },
                field: {
                    name: 'Максимум таймлайнов',
                    description: 'Ограничение количества (по умолчанию 500)'
                },
                onChange: function(value) {
                    const cfg = getConfig();
                    const num = parseInt(value);
                    if (!isNaN(num) && num > 0) {
                        cfg.maxTimelines = num;
                        saveConfig(cfg);
                        notify('Максимум установлен: ' + num);
                    }
                }
            });
        }

        if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addParam === 'function') {
            Lampa.SettingsApi.addParam({
                component: 'timeline_gist',
                param: {
                    name: 'timeline_gist_cleanup_days',
                    type: 'input'
                },
                field: {
                    name: 'Очистка старых (дней)',
                    description: 'Удалять таймлайны старше N дней (по умолчанию 60)'
                },
                onChange: function(value) {
                    const cfg = getConfig();
                    const num = parseInt(value);
                    if (!isNaN(num) && num > 0) {
                        cfg.cleanupDays = num;
                        saveConfig(cfg);
                        notify('Период очистки установлен: ' + num + ' дней');
                    }
                }
            });
        }

        if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addParam === 'function') {
            Lampa.SettingsApi.addParam({
                component: 'timeline_gist',
                param: {
                    name: 'timeline_gist_cleanup_percent',
                    type: 'input'
                },
                field: {
                    name: 'Порог просмотренности (%)',
                    description: 'Удалять таймлайны с процентом выше N (по умолчанию 95)'
                },
                onChange: function(value) {
                    const cfg = getConfig();
                    const num = parseInt(value);
                    if (!isNaN(num) && num > 0 && num <= 100) {
                        cfg.cleanupPercent = num;
                        saveConfig(cfg);
                        notify('Порог установлен: ' + num + '%');
                    }
                }
            });
        }

        if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addParam === 'function') {
            Lampa.SettingsApi.addParam({
                component: 'timeline_gist',
                param: {
                    name: 'timeline_gist_clear',
                    type: 'button'
                },
                field: {
                    name: 'Очистить локальные таймлайны',
                    description: 'Удалить все сохраненные прогрессы просмотра'
                },
                onChange: function() {
                    Lampa.Select.show({
                        title: 'Удалить все таймлайны?',
                        items: [
                            { title: 'Нет', action: 'cancel' },
                            { title: 'Да, удалить', action: 'clear' }
                        ],
                        onSelect: function(opt) {
                            if (opt.action === 'clear') {
                                const key = getFileViewKey();
                                Lampa.Storage.set(key, {}, true);
                                Lampa.Storage.set('file_view', {}, true);
                                if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
                                    Lampa.Timeline.read(true);
                                }
                                notify('🗑️ Таймлайны очищены');
                            }
                        }
                    });
                }
            });
        }

        log('Settings initialized');
    }

    // ============== ИНИЦИАЛИЗАЦИЯ ==============
    function init() {
        var cfg = getConfig();
        if (!cfg.enabled) {
            log('Disabled');
            return;
        }

        var key = getFileViewKey();
        var timelines = getAllTimelines();
        var count = Object.keys(timelines).length;
        
        log('===== INIT =====');
        log('Profile:', getProfileId() || 'default');
        log('File view key:', key);
        log('Found', count, 'timelines');
        log('Token:', cfg.token ? '✓' : '✗');
        log('Gist ID:', cfg.gistId ? '✓' : '✗');
        log('=================');

        setupSettings();
        initPlayerListeners();
        initExternalPlayerSupport();
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
