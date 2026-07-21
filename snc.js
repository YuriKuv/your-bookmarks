(function() {
    'use strict';

    if (window.timeline_gist_loaded) return;
    window.timeline_gist_loaded = true;

    // ============== КОНФИГУРАЦИЯ ==============
    const CFG_KEY = 'timeline_gist_config';
    const GIST_API = 'https://api.github.com/gists';
    const SYNC_INTERVAL = 60000; // 1 минута
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

    // ============== ПОЛУЧЕНИЕ ВСЕХ FILE_VIEW ==============
    function getAllFileViews() {
        const allViews = {};
        const profileId = getProfileId();
        
        // Основной file_view (без профиля)
        const mainView = Lampa.Storage.get('file_view', {});
        if (Object.keys(mainView).length > 0) {
            allViews['file_view'] = mainView;
        }
        
        // file_view с профилем
        if (profileId) {
            const profileViewKey = 'file_view_' + profileId;
            const profileView = Lampa.Storage.get(profileViewKey, {});
            if (Object.keys(profileView).length > 0) {
                allViews[profileViewKey] = profileView;
            }
        }
        
        // Ищем все file_view_* в localStorage
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('file_view_') && !allViews[key]) {
                try {
                    const data = Lampa.Storage.get(key, {});
                    if (Object.keys(data).length > 0) {
                        allViews[key] = data;
                    }
                } catch(e) {}
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
                
                // Если уже есть этот hash, берем с большим updated
                if (allTimelines[hash]) {
                    if (item.updated > allTimelines[hash].updatedAt) {
                        allTimelines[hash] = {
                            time: Math.round(item.time),
                            duration: Math.round(item.duration || 0),
                            percent: Math.round(item.percent || 0),
                            updatedAt: item.updated || now,
                            source: viewKey
                        };
                    }
                } else {
                    allTimelines[hash] = {
                        time: Math.round(item.time),
                        duration: Math.round(item.duration || 0),
                        percent: Math.round(item.percent || 0),
                        updatedAt: item.updated || now,
                        source: viewKey
                    };
                }
            }
        }

        return allTimelines;
    }

    // ============== СОХРАНЕНИЕ ТАЙМЛАЙНОВ В FILE_VIEW ==============
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
            
            // Сохраняем в общий file_view
            mainView[hash] = data;
            
            // Сохраняем в file_view с профилем
            if (profileViewKey) {
                profileView[hash] = data;
            }
        }

        // Сохраняем оба file_view
        if (Object.keys(mainView).length > 0) {
            Lampa.Storage.set('file_view', mainView, true);
            log('Saved to file_view:', Object.keys(mainView).length, 'items');
        }
        
        if (profileViewKey && Object.keys(profileView).length > 0) {
            Lampa.Storage.set(profileViewKey, profileView, true);
            log('Saved to', profileViewKey, ':', Object.keys(profileView).length, 'items');
        }
        
        // Обновляем Lampa.Timeline
        if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
            Lampa.Timeline.read(true);
        }
    }

    // ============== ХРАНИЛИЩЕ КОНФИГА ==============
    function getConfig() {
        return Lampa.Storage.get(CFG_KEY, {
            token: '',
            gistId: '',
            lastSync: 0,
            enabled: true,
            cleanup_enabled: true,
            cleanup_auto: true,
            cleanup_watched: true,
            cleanup_watched_threshold: 95
        });
    }

    function saveConfig(cfg) {
        Lampa.Storage.set(CFG_KEY, cfg, true);
    }

    function notify(text) {
        Lampa.Noty.show(text);
    }

    // ============== ОЧИСТКА ТАЙМЛАЙНОВ ==============
    function cleanupTimelines(timelines) {
        const cfg = getConfig();
        if (!cfg.cleanup_enabled) return timelines;

        let removed = 0;
        const result = {};

        for (const hash in timelines) {
            const item = timelines[hash];
            const percent = item.percent || 0;
            
            // Удаляем только если percent >= порог
            if (cfg.cleanup_watched && percent >= cfg.cleanup_watched_threshold) {
                removed++;
                log('Removing watched:', hash, 'percent:', percent + '%');
            } else {
                result[hash] = item;
            }
        }

        if (removed > 0) {
            log('Cleanup: removed', removed, 'items, remaining', Object.keys(result).length);
        }

        return result;
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

        let timelines = getAllTimelines();
        const count = Object.keys(timelines).length;
        
        if (count === 0) {
            if (showNotify) notify('⚠️ Нет таймлайнов для синхронизации');
            return false;
        }

        // Очищаем перед синхронизацией
        const cfg = getConfig();
        if (cfg.cleanup_auto) {
            const before = Object.keys(timelines).length;
            timelines = cleanupTimelines(timelines);
            const after = Object.keys(timelines).length;
            if (before !== after) {
                saveTimelinesToFileViews(timelines);
                if (showNotify) notify('🧹 Удалено ' + (before - after) + ' таймлайнов');
            }
        }

        const finalCount = Object.keys(timelines).length;
        if (finalCount === 0) {
            if (showNotify) notify('⚠️ Нет таймлайнов для синхронизации');
            return false;
        }

        log('Syncing', finalCount, 'timelines to Gist');

        const data = {
            description: 'Lampa Timeline Sync',
            public: false,
            files: {
                'timeline.json': {
                    content: JSON.stringify({
                        version: 2,
                        profile: getProfileId() || 'default',
                        updated: new Date().toISOString(),
                        count: finalCount,
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
                    if (showNotify) notify('✅ Синхронизировано ' + finalCount + ' таймлайнов');
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
        const gist = getGistData();
        if (!gist) {
            if (showNotify) notify('⚠️ GitHub Gist не настроен');
            return false;
        }

        $.ajax({
            url: GIST_API + '/' + gist.id,
            method: 'GET',
            headers: {
                'Authorization': 'token ' + gist.token,
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

                    // Очищаем загруженные
                    const cfg = getConfig();
                    if (cfg.cleanup_auto) {
                        const before = Object.keys(remoteTimelines).length;
                        remoteTimelines = cleanupTimelines(remoteTimelines);
                        const after = Object.keys(remoteTimelines).length;
                        if (before !== after) {
                            log('Cleanup: removed', before - after, 'items from loaded data');
                        }
                    }

                    // Объединяем с локальными
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

    // ============== ПЕРЕХВАТ СОБЫТИЙ ПЛЕЕРА ==============
    var syncTimer = null;
    var lastSyncTime = 0;
    var isPaused = false;

    function scheduleSync(immediate = false) {
        if (immediate) {
            clearTimeout(syncTimer);
            var cfg = getConfig();
            if (cfg.token && cfg.gistId) {
                syncToGist(false);
            }
            return;
        }
        
        var now = Date.now();
        if (now - lastSyncTime < 5000) return;
        
        lastSyncTime = now;
        clearTimeout(syncTimer);
        syncTimer = setTimeout(function() {
            var cfg = getConfig();
            if (cfg.token && cfg.gistId) {
                syncToGist(false);
            }
        }, 2000);
    }

    function initPlayerListeners() {
        // При обновлении времени (просмотр)
        Lampa.Player.listener.follow('timeupdate', function(e) {
            // Сохраняем таймлайн при просмотре
            const playData = Lampa.Player.playdata();
            if (playData && playData.url && playData.timeline) {
                const activity = Lampa.Activity.active();
                const movie = activity?.movie;
                if (movie) {
                    const season = playData.season || 1;
                    const episode = playData.episode || 1;
                    const hash = generateHash(movie, season, episode);
                    
                    if (hash && playData.timeline.time > 0) {
                        const time = playData.timeline.time || 0;
                        const duration = playData.timeline.duration || 0;
                        const percent = playData.timeline.percent || 0;
                        
                        // Сохраняем в file_view
                        const key = getFileViewKey();
                        const fileView = Lampa.Storage.get(key, {});
                        fileView[hash] = {
                            time: Math.round(time),
                            duration: Math.round(duration || 0),
                            percent: Math.round(percent || 0),
                            updated: Date.now()
                        };
                        Lampa.Storage.set(key, fileView, true);
                    }
                }
            }
            // Планируем синхронизацию
            scheduleSync(false);
        });

        // При паузе - синхронизация
        Lampa.Player.listener.follow('pause', function(e) {
            log('Player paused, syncing...');
            isPaused = true;
            var cfg = getConfig();
            if (cfg.token && cfg.gistId) {
                syncToGist(false);
            }
        });

        // При возобновлении
        Lampa.Player.listener.follow('play', function(e) {
            isPaused = false;
        });

        // При закрытии плеера - синхронизация
        Lampa.Player.listener.follow('destroy', function() {
            log('Player destroyed, syncing...');
            clearTimeout(syncTimer);
            var cfg = getConfig();
            if (cfg.token && cfg.gistId) {
                setTimeout(function() {
                    syncToGist(false);
                }, 1000);
            }
        });

        log('Player listeners initialized');
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

    function getFileViewKey() {
        const profileId = getProfileId();
        return profileId ? 'file_view_' + profileId : 'file_view';
    }

    // ============== НАСТРОЙКИ ==============
    function setupSettings() {
        try {
            // Добавляем компонент в настройки
            if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addComponent === 'function') {
                Lampa.SettingsApi.addComponent({
                    component: 'timeline_gist',
                    name: 'Синхронизация таймлайнов',
                    icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M13,7H11V13H17V11H13V7Z"/></svg>'
                });
            }

            // Параметр: GitHub Gist синхронизация (кнопка)
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

            // Параметр: принудительная синхронизация
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

            // Параметр: загрузить из Gist
            if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addParam === 'function') {
                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'timeline_gist_load',
                        type: 'button'
                    },
                    field: {
                        name: 'Загрузить из Gist',
                        description: 'Загрузить таймлайны из Gist'
                    },
                    onChange: function() {
                        syncFromGist(true);
                    }
                });
            }

            // Параметр: очистка локальных
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
        } catch(e) {
            logError('Settings setup error:', e);
            // Запасной вариант - добавляем в меню
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

    // ============== ПЕРИОДИЧЕСКАЯ СИНХРОНИЗАЦИЯ ==============
    function startPeriodicSync() {
        setInterval(function() {
            var cfg = getConfig();
            if (cfg.token && cfg.gistId) {
                var timelines = getAllTimelines();
                if (Object.keys(timelines).length > 0) {
                    log('Periodic sync');
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

    // ============== ИНИЦИАЛИЗАЦИЯ ==============
    function init() {
        var cfg = getConfig();
        if (!cfg.enabled) {
            log('Disabled');
            return;
        }

        var timelines = getAllTimelines();
        var count = Object.keys(timelines).length;
        
        log('===== INIT =====');
        log('Profile:', getProfileId() || 'default');
        log('Found', count, 'timelines');
        log('Token:', cfg.token ? '✓' : '✗');
        log('Gist ID:', cfg.gistId ? '✓' : '✗');
        log('Auto cleanup:', cfg.cleanup_auto ? '✓' : '✗');
        log('=================');

        // Настройки
        setupSettings();

        // Слушатели плеера
        initPlayerListeners();

        // Периодическая синхронизация (каждую минуту)
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
