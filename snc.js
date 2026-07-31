(function() {
    'use strict';

    if (window.timeline_gist_loaded) return;
    window.timeline_gist_loaded = true;

    // ============== КОНФИГУРАЦИЯ ==============
    const CFG_KEY = 'timeline_gist_config';
    const GIST_API = 'https://api.github.com/gists';
    const SYNC_INTERVAL = 120000; // 2 минуты
    const SAVE_DELAY = 3000; // Задержка перед сохранением
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

    // ============== ПОЛУЧЕНИЕ ВСЕХ FILE_VIEW ==============
    function getAllFileViews() {
        const allViews = {};
        const profileId = getProfileId();
        
        const mainView = Lampa.Storage.get('file_view', {});
        if (Object.keys(mainView).length > 0) {
            allViews['file_view'] = mainView;
        }
        
        if (profileId) {
            const profileViewKey = 'file_view_' + profileId;
            const profileView = Lampa.Storage.get(profileViewKey, {});
            if (Object.keys(profileView).length > 0) {
                allViews[profileViewKey] = profileView;
            }
        }
        
        return allViews;
    }

    // ============== ПОЛУЧЕНИЕ ВСЕХ ТАЙМЛАЙНОВ ==============
    function getAllTimelines() {
        const allViews = getAllFileViews();
        const allTimelines = {};
        const now = Date.now();

        for (const viewKey in allViews) {
            const viewData = allViews[viewKey];
            for (const hash in viewData) {
                const item = viewData[hash];
                if (!item || !item.time || item.time <= 0) continue;
                
                if (allTimelines[hash]) {
                    if (item.updated > allTimelines[hash].updatedAt) {
                        allTimelines[hash] = {
                            time: Math.round(item.time),
                            duration: Math.round(item.duration || 0),
                            percent: Math.round(item.percent || 0),
                            updatedAt: item.updated || now
                        };
                    }
                } else {
                    allTimelines[hash] = {
                        time: Math.round(item.time),
                        duration: Math.round(item.duration || 0),
                        percent: Math.round(item.percent || 0),
                        updatedAt: item.updated || now
                    };
                }
            }
        }

        return allTimelines;
    }

    // ============== СОХРАНЕНИЕ ТАЙМЛАЙНОВ ==============
    function saveTimelinesToFileViews(timelines) {
        const profileId = getProfileId();
        const mainView = {};
        const profileView = {};
        const profileViewKey = profileId ? 'file_view_' + profileId : null;

        for (const hash in timelines) {
            const item = timelines[hash];
            const data = {
                time: item.time,
                duration: item.duration || 0,
                percent: item.percent || 0,
                updated: item.updatedAt || Date.now()
            };
            
            mainView[hash] = data;
            if (profileViewKey) {
                profileView[hash] = data;
            }
        }

        if (Object.keys(mainView).length > 0) {
            Lampa.Storage.set('file_view', mainView);
            log('Saved to file_view:', Object.keys(mainView).length, 'items');
        }
        
        if (profileViewKey && Object.keys(profileView).length > 0) {
            Lampa.Storage.set(profileViewKey, profileView);
            log('Saved to', profileViewKey, ':', Object.keys(profileView).length, 'items');
        }
        
        // Обновляем Timeline для отображения изменений
        if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
            Lampa.Timeline.read(true);
        }
    }

    // ============== СОХРАНЕНИЕ ОДНОГО ТАЙМЛАЙНА ==============
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
        
        Lampa.Storage.set(key, fileView);
        
        const mainView = Lampa.Storage.get('file_view', {});
        mainView[hash] = {
            time: Math.round(time),
            duration: Math.round(duration || 0),
            percent: Math.round(percent || 0),
            updated: Date.now()
        };
        Lampa.Storage.set('file_view', mainView);
        
        // Обновляем Timeline
        if (Lampa.Timeline && typeof Lampa.Timeline.update === 'function') {
            Lampa.Timeline.update({
                hash: hash,
                time: time,
                duration: duration || 0,
                percent: percent || 0
            });
        }
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
    function getGistData() {
        const cfg = getConfig();
        if (!cfg.token || !cfg.gistId) return null;
        return { token: cfg.token, id: cfg.gistId };
    }

    function syncToGist(showNotify = true) {
        const gist = getGistData();
        if (!gist) {
            if (showNotify) notify('⚠️ GitHub Gist не настроен');
            return false;
        }

        const timelines = getAllTimelines();
        const count = Object.keys(timelines).length;
        
        if (count === 0) {
            if (showNotify) notify('⚠️ Нет таймлайнов для синхронизации');
            return false;
        }

        log('Syncing', count, 'timelines to Gist');

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

        // Используем Lampa.Reguest вместо $.ajax для совместимости
        const network = new Lampa.Reguest();
        
        let url = GIST_API;
        let method = 'POST';
        let postData = JSON.stringify(data);
        let params = {
            headers: {
                'Authorization': 'token ' + gist.token,
                'Accept': 'application/vnd.github.v3+json'
            }
        };
        
        if (gist.id) {
            url = GIST_API + '/' + gist.id;
            method = 'PATCH';
            // Для PATCH используем другой подход
            network.native(url, function(response) {
                const newCfg = getConfig();
                newCfg.lastSync = Date.now();
                saveConfig(newCfg);
                if (showNotify) notify('✅ Синхронизировано ' + count + ' таймлайнов');
                log('Sync complete');
            }, function(xhr) {
                logError('Sync error:', xhr.status);
                handleSyncError(xhr, showNotify);
            }, postData, {
                type: 'PATCH',
                headers: {
                    'Authorization': 'token ' + gist.token,
                    'Content-Type': 'application/json',
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
            return true;
        }

        // Для POST используем native
        network.native(url, function(response) {
            if (response && response.id) {
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
        }, function(xhr) {
            logError('Sync error:', xhr.status);
            handleSyncError(xhr, showNotify);
        }, postData, {
            headers: {
                'Authorization': 'token ' + gist.token,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        return true;
    }

    function handleSyncError(xhr, showNotify) {
        const cfg = getConfig();
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
                const response = JSON.parse(xhr.responseText || '{}');
                if (response && response.message) {
                    errorMsg = response.message;
                }
            } catch(e) {
                errorMsg = 'Status ' + (xhr.status || 'unknown');
            }
            if (showNotify) notify('❌ ' + errorMsg);
        }
    }

    function syncFromGist(showNotify = true) {
        const gist = getGistData();
        if (!gist) {
            if (showNotify) notify('⚠️ GitHub Gist не настроен');
            return false;
        }

        const network = new Lampa.Reguest();
        
        network.native(GIST_API + '/' + gist.id, function(data) {
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

                const localTimelines = getAllTimelines();
                let merged = { ...localTimelines };
                let changes = 0;

                for (const hash in remoteTimelines) {
                    const remoteData = remoteTimelines[hash];
                    const localData = merged[hash];
                    
                    if (!localData || remoteData.updatedAt > localData.updatedAt) {
                        merged[hash] = remoteData;
                        changes++;
                    }
                }

                if (changes > 0) {
                    saveTimelinesToFileViews(merged);
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
        }, function(xhr) {
            logError('Load error:', xhr.status);
            if (xhr.status === 404) {
                if (showNotify) notify('❌ Gist не найден (404)');
            } else if (xhr.status === 401) {
                if (showNotify) notify('❌ Ошибка авторизации. Проверьте токен');
            } else {
                if (showNotify) notify('❌ Ошибка загрузки: ' + xhr.status);
            }
        }, null, {
            headers: {
                'Authorization': 'token ' + gist.token,
                'Accept': 'application/vnd.github.v3+json'
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
            }
        } catch(e) {
            logError('Hash generation error:', e);
        }
        return null;
    }

    // ============== СОБЫТИЯ ПЛЕЕРА ==============
    var syncTimer = null;
    var lastSaveTime = 0;
    var currentHash = null;
    var currentTimeline = null;

    function scheduleSync() {
        clearTimeout(syncTimer);
        syncTimer = setTimeout(function() {
            const cfg = getConfig();
            if (cfg.token && cfg.gistId && cfg.autoSync) {
                syncToGist(false);
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
        
        if (time > 0 && time !== currentTimeline?.time) {
            currentTimeline = { time, duration, percent };
            saveTimelineToFileView(hash, time, duration, percent);
            scheduleSync();
        }
    }

    function initPlayerListeners() {
        // Подписываемся на обновление таймлайна
        Lampa.Listener.follow('timeline', function(e) {
            if (e.type === 'update') {
                handleTimelineUpdate(e.data);
            }
        });

        // Подписываемся на события плеера
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
                        
                        if (time > 0 && time !== currentTimeline?.time) {
                            currentTimeline = { time, duration, percent };
                            saveTimelineToFileView(hash, time, duration, percent);
                            scheduleSync();
                        }
                    }
                }
            }
        });

        Lampa.Player.listener.follow('pause', function(e) {
            log('Player paused, syncing...');
            const cfg = getConfig();
            if (cfg.token && cfg.gistId) {
                syncToGist(false);
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
                if (cfg.token && cfg.gistId) {
                    syncToGist(false);
                }
                currentHash = null;
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
                        currentHash = hash;
                        
                        // Загружаем актуальный таймлайн при открытии
                        const key = getFileViewKey();
                        const fileView = Lampa.Storage.get(key, {});
                        const item = fileView[hash];
                        
                        if (item && item.time > 0) {
                            log('Loaded timeline for', hash, 'time:', item.time);
                            currentTimeline = {
                                time: item.time,
                                duration: item.duration || 0,
                                percent: item.percent || 0
                            };
                            
                            // Обновляем Timeline для отображения
                            if (Lampa.Timeline && typeof Lampa.Timeline.update === 'function') {
                                Lampa.Timeline.update({
                                    hash: hash,
                                    time: item.time,
                                    duration: item.duration || 0,
                                    percent: item.percent || 0
                                });
                            }
                        }
                    }
                }
            }
        });
        
        log('Activity listeners initialized');
    }

    // ============== ДИАЛОГ НАСТРОЕК ==============
    function showGistSetup() {
        const cfg = getConfig();
        const timelines = getAllTimelines();
        const count = Object.keys(timelines).length;
        const lastSync = cfg.lastSync ? new Date(cfg.lastSync).toLocaleString() : 'Никогда';
        
        Lampa.Select.show({
            title: '☁️ GitHub Gist',
            items: [
                { title: '🔑 Токен: ' + (cfg.token ? '✓ Установлен' : '❌ Не установлен'), action: 'token' },
                { title: '📄 Gist ID: ' + (cfg.gistId ? cfg.gistId.substring(0, 8) + '…' : '❌ Не создан'), action: 'id' },
                { title: '──────────', separator: true },
                { title: '📊 Таймлайнов: ' + count, action: 'status' },
                { title: '🔄 Последняя синхр.: ' + lastSync, action: 'status' },
                { title: '──────────', separator: true },
                { title: '📤 Выгрузить в Gist', action: 'upload' },
                { title: '📥 Загрузить из Gist', action: 'download' },
                { title: '──────────', separator: true },
                { title: '🔄 Автосинхр.: ' + (cfg.autoSync ? '✅ Вкл' : '❌ Выкл'), action: 'toggle_auto' },
                { title: '──────────', separator: true },
                { title: '❌ Закрыть', action: 'cancel' }
            ],
            onSelect: function(item) {
                const newCfg = getConfig();
                
                if (item.action === 'token') {
                    Lampa.Input.edit({
                        title: 'GitHub Personal Access Token',
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
                    syncFromGist(true);
                    setTimeout(function() {
                        showGistSetup();
                    }, 2000);
                } else if (item.action === 'toggle_auto') {
                    newCfg.autoSync = !newCfg.autoSync;
                    saveConfig(newCfg);
                    notify('Автосинхронизация ' + (newCfg.autoSync ? 'включена' : 'выключена'));
                    showGistSetup();
                } else if (item.action === 'status') {
                    showGistSetup();
                }
            },
            onBack: function() {
                Lampa.Controller.toggle('content');
            }
        });
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

    // ============== ПЕРИОДИЧЕСКАЯ СИНХРОНИЗАЦИЯ ==============
    function startPeriodicSync() {
        setInterval(function() {
            const cfg = getConfig();
            if (cfg.token && cfg.gistId && cfg.autoSync) {
                const timelines = getAllTimelines();
                if (Object.keys(timelines).length > 0) {
                    log('Periodic sync');
                    syncToGist(false);
                }
            }
        }, SYNC_INTERVAL);
    }

    // ============== ЗАГРУЗКА ПРИ СТАРТЕ ==============
    function loadOnStart() {
        const cfg = getConfig();
        if (cfg.token && cfg.gistId) {
            setTimeout(function() {
                syncFromGist(false);
            }, 5000);
        }
    }

    // ============== ИНИЦИАЛИЗАЦИЯ ==============
    function init() {
        const cfg = getConfig();
        if (!cfg.enabled) {
            log('Disabled');
            return;
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
