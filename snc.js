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
            cleanup_enabled: true,
            cleanup_auto: true,
            cleanup_watched: true,
            cleanup_watched_threshold: 95,
            cleanup_by_time: false,
            cleanup_days: 30,
            cleanup_limit: false,
            cleanup_max_items: 500
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

    function saveTimelinesToFileView(timelines) {
        const key = getFileViewKey();
        const fileView = {};
        
        for (const hash in timelines) {
            const item = timelines[hash];
            fileView[hash] = {
                time: item.time,
                duration: item.duration || 0,
                percent: item.percent || 0,
                updated: item.updatedAt || Date.now()
            };
        }
        
        Lampa.Storage.set(key, fileView, true);
        
        const mainView = Lampa.Storage.get('file_view', {});
        for (const hash in timelines) {
            const item = timelines[hash];
            mainView[hash] = {
                time: item.time,
                duration: item.duration || 0,
                percent: item.percent || 0,
                updated: item.updatedAt || Date.now()
            };
        }
        Lampa.Storage.set('file_view', mainView, true);
        
        if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
            Lampa.Timeline.read(true);
        }
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
        
        log('Saved timeline:', hash, 'time:', Math.round(time), 'percent:', Math.round(percent || 0) + '%');
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

    // ============== ОЧИСТКА ТАЙМЛАЙНОВ ==============
    function cleanupTimelines(timelines) {
        const cfg = getConfig();
        if (!cfg.cleanup_enabled) return timelines;

        let removed = 0;
        const now = Date.now();
        const result = {};

        let items = Object.keys(timelines).map(hash => ({
            hash: hash,
            data: timelines[hash]
        }));

        log('Cleanup: starting with', items.length, 'items');

        // 1. Удаляем просмотренные (percent >= threshold)
        if (cfg.cleanup_watched) {
            const threshold = cfg.cleanup_watched_threshold || 95;
            const before = items.length;
            
            items = items.filter(item => {
                const percent = item.data.percent || 0;
                if (percent >= threshold) {
                    removed++;
                    log('Removing watched:', item.hash, 'percent:', percent + '%');
                    return false;
                }
                return true;
            });
            
            const after = items.length;
            if (before !== after) {
                log('Cleanup: removed', before - after, 'watched items (>=', threshold + '%)');
            }
        }

        // 2. Удаляем по времени (старше N дней)
        if (cfg.cleanup_by_time) {
            const days = cfg.cleanup_days || 30;
            const threshold = days * 24 * 60 * 60 * 1000;
            const before = items.length;
            
            items = items.filter(item => {
                const updated = item.data.updatedAt || 0;
                if (updated > 0 && (now - updated) > threshold) {
                    removed++;
                    log('Removing old:', item.hash, 'days:', Math.round((now - updated) / 86400000));
                    return false;
                }
                return true;
            });
            
            const after = items.length;
            if (before !== after) {
                log('Cleanup: removed', before - after, 'old items (>', days, 'days)');
            }
        }

        // 3. Ограничение количества (храним только последние N)
        if (cfg.cleanup_limit) {
            const maxItems = cfg.cleanup_max_items || 500;
            if (items.length > maxItems) {
                items.sort((a, b) => {
                    const aTime = a.data.updatedAt || 0;
                    const bTime = b.data.updatedAt || 0;
                    return bTime - aTime;
                });
                const before = items.length;
                const removedItems = items.slice(maxItems);
                items = items.slice(0, maxItems);
                removed += removedItems.length;
                log('Cleanup: limited to', maxItems, 'items, removed', removedItems.length);
            }
        }

        items.forEach(item => {
            result[item.hash] = item.data;
        });

        if (removed > 0) {
            log('Cleanup: total removed', removed, 'items, remaining', Object.keys(result).length);
        }

        return result;
    }

    // ============== РАБОТА С GIST ==============
    function syncToGist(showNotify = true) {
        const cfg = getConfig();
        
        if (!cfg.token) {
            if (showNotify) notify('⚠️ GitHub Token не настроен');
            return false;
        }

        let timelines = getAllTimelines();
        
        if (cfg.cleanup_auto) {
            const before = Object.keys(timelines).length;
            timelines = cleanupTimelines(timelines);
            const after = Object.keys(timelines).length;
            if (before !== after) {
                saveTimelinesToFileView(timelines);
                if (showNotify) notify('🧹 Удалено ' + (before - after) + ' таймлайнов');
            }
        }

        const count = Object.keys(timelines).length;
        
        if (count === 0) {
            if (showNotify) notify('⚠️ Нет таймлайнов для синхронизации');
            return false;
        }

        log('Syncing', count, 'timelines to Gist');

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
                    if (showNotify) notify('✅ Синхронизировано ' + count + ' таймлайнов');
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
                    let remoteTimelines = remote.timelines || {};
                    
                    if (Object.keys(remoteTimelines).length === 0) {
                        if (showNotify) notify('⚠️ В Gist нет таймлайнов');
                        return;
                    }

                    if (cfg.cleanup_auto) {
                        const before = Object.keys(remoteTimelines).length;
                        remoteTimelines = cleanupTimelines(remoteTimelines);
                        const after = Object.keys(remoteTimelines).length;
                        if (before !== after) {
                            log('Cleanup: removed', before - after, 'items from loaded data');
                        }
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

    // ============== ПЕРЕХВАТ ВНЕШНИХ ПЛЕЕРОВ (ANDROID) ==============
    function initExternalPlayerSupport() {
        if (Lampa.Android && typeof Lampa.Android.openPlayer === 'function') {
            const originalOpenPlayer = Lampa.Android.openPlayer;
            
            Lampa.Android.openPlayer = function(link, data) {
                log('Android.openPlayer intercepted');
                
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
                        log('External player started for hash:', hash);
                    }
                }
                
                return originalOpenPlayer.call(Lampa.Android, link, data);
            };
            
            log('Android.openPlayer intercepted for external players');
        }

        if (Lampa.Android && typeof Lampa.Android.openTorrent === 'function') {
            const originalOpenTorrent = Lampa.Android.openTorrent;
            
            Lampa.Android.openTorrent = function(data) {
                log('Android.openTorrent intercepted');
                
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
                        log('Torrent player started for hash:', hash);
                    }
                }
                
                return originalOpenTorrent.call(Lampa.Android, data);
            };
            
            log('Android.openTorrent intercepted');
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

    // ============== ОБРАБОТКА ВРЕМЕНИ ИЗ ВНЕШНЕГО ПЛЕЕРА ==============
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
        
        log('External player time:', Math.round(time), 'percent:', percent + '%');
        
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
        
        log('External player sync started');
    }

    function stopExternalPlayerSync() {
        if (externalSyncInterval) {
            clearInterval(externalSyncInterval);
            externalSyncInterval = null;
        }
        if (window._externalPlayerData) {
            window._externalPlayerData.isActive = false;
        }
        log('External player sync stopped');
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

        log('Player listeners initialized');
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

    // ============== ДИАЛОГ НАСТРОЕК ==============
    function showGistSetup() {
        const cfg = getConfig();
        const timelines = getAllTimelines();
        const count = Object.keys(timelines).length;
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
                { title: '🗑️ Очистить локальные', action: 'clear' },
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
                } else if (item.action === 'clear') {
                    Lampa.Select.show({
                        title: '⚠️ Удалить все таймлайны?',
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
                                showGistSetup();
                            }
                        },
                        onBack: function() {
                            showGistSetup();
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

    // ============== ДОБАВЛЕНИЕ ПУНКТА В НАСТРОЙКИ (как в примере) ==============
    function setupSettings() {
        try {
            // Добавляем компонент в настройки (как в плагине русских новинок)
            Lampa.SettingsApi.addComponent({
                component: 'timeline_gist',
                name: 'Синхронизация таймлайнов',
                icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M13,7H11V13H17V11H13V7Z"/></svg>'
            });

            // Параметр: GitHub Gist синхронизация (кнопка)
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

            // Параметр: принудительная синхронизация
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

            // Параметр: очистка локальных
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

            log('Settings initialized');
        } catch(e) {
            logError('Settings setup error:', e);
        }
    }

    // ============== ДОБАВЛЕНИЕ ПУНКТА В МЕНЮ (запасной вариант) ==============
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

        // Настройки через SettingsApi (как в плагине русских новинок)
        try {
            setupSettings();
        } catch(e) {
            logError('Settings setup error, adding menu item:', e);
            // Если SettingsApi недоступен - добавляем в меню
            addMenuItem();
        }

        // Слушатели плеера
        initPlayerListeners();

        // Поддержка внешних плееров
        initExternalPlayerSupport();

        // Периодическая синхронизация
        startPeriodicSync();

        // Загрузка при старте
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
