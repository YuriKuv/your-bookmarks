(function() {
    'use strict';

    if (window.timeline_gist_loaded) return;
    window.timeline_gist_loaded = true;

    // ============== КОНФИГУРАЦИЯ ==============
    const CFG_KEY = 'timeline_gist_config';
    const GIST_API = 'https://api.github.com/gists';
    const SYNC_INTERVAL = 60000;
    const DEBUG = true; // Включить отладку

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
            enabled: true
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

        log('Reading from:', key, 'items:', Object.keys(data).length);

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

        log('Extracted timelines:', Object.keys(timelines).length);
        return timelines;
    }

    // ============== РАБОТА С GIST ==============
    function syncToGist(showNotify = true) {
        const cfg = getConfig();
        
        log('syncToGist called, token:', cfg.token ? '✓' : '✗', 'gistId:', cfg.gistId ? '✓' : '✗');
        
        if (!cfg.token) {
            if (showNotify) notify('⚠️ GitHub Token не настроен');
            return false;
        }

        const timelines = getAllTimelines();
        const count = Object.keys(timelines).length;
        
        if (count === 0) {
            if (showNotify) notify('⚠️ Нет таймлайнов для синхронизации');
            log('No timelines found');
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

        log('Request:', method, url);

        $.ajax({
            url: url,
            method: method,
            headers: {
                'Authorization': 'token ' + cfg.token,
                'Accept': 'application/vnd.github.v3+json'
            },
            data: JSON.stringify(data),
            success: function(response) {
                log('Sync success:', response);
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
                logError('Sync error:', xhr.status, xhr.responseText);
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
        
        log('syncFromGist called, token:', cfg.token ? '✓' : '✗', 'gistId:', cfg.gistId ? '✓' : '✗');
        
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
                log('Load success, files:', Object.keys(data.files || {}));
                
                try {
                    const content = data.files && data.files['timeline.json'] ? data.files['timeline.json'].content : null;
                    
                    if (!content) {
                        logError('No timeline.json found in Gist');
                        if (showNotify) notify('⚠️ Файл timeline.json не найден');
                        return;
                    }

                    log('Content length:', content.length);
                    
                    const remote = JSON.parse(content);
                    const remoteTimelines = remote.timelines || {};
                    const remoteProfile = remote.profile || 'default';
                    const remoteCount = remote.count || 0;
                    
                    log('Remote timelines:', remoteCount, 'profile:', remoteProfile);
                    
                    if (Object.keys(remoteTimelines).length === 0) {
                        if (showNotify) notify('⚠️ В Gist нет таймлайнов');
                        return;
                    }

                    const key = getFileViewKey();
                    const fileView = Lampa.Storage.get(key, {});
                    let changes = 0;
                    let updated = 0;
                    let skipped = 0;

                    for (const hash in remoteTimelines) {
                        const remoteData = remoteTimelines[hash];
                        const localData = fileView[hash];
                        
                        if (!localData) {
                            // Новый таймлайн
                            fileView[hash] = {
                                time: remoteData.time,
                                duration: remoteData.duration || 0,
                                percent: remoteData.percent || 0,
                                updated: remoteData.updatedAt || Date.now()
                            };
                            changes++;
                            updated++;
                            log('New timeline:', hash, 'time:', remoteData.time);
                        } else if (remoteData.updatedAt > (localData.updated || 0)) {
                            // Обновление существующего
                            fileView[hash] = {
                                time: remoteData.time,
                                duration: remoteData.duration || 0,
                                percent: remoteData.percent || 0,
                                updated: remoteData.updatedAt || Date.now()
                            };
                            changes++;
                            updated++;
                            log('Updated timeline:', hash, 'time:', remoteData.time, 'old:', localData.time);
                        } else {
                            skipped++;
                            log('Skipped timeline:', hash, 'remote updated:', remoteData.updatedAt, 'local:', localData.updated);
                        }
                    }

                    if (changes > 0) {
                        Lampa.Storage.set(key, fileView, true);
                        log('Saved', changes, 'timelines to', key);
                        
                        // Также обновляем основной file_view для совместимости
                        const mainView = Lampa.Storage.get('file_view', {});
                        let mainChanges = 0;
                        for (const hash in remoteTimelines) {
                            if (!mainView[hash]) {
                                mainView[hash] = {
                                    time: remoteTimelines[hash].time,
                                    duration: remoteTimelines[hash].duration || 0,
                                    percent: remoteTimelines[hash].percent || 0,
                                    updated: remoteTimelines[hash].updatedAt || Date.now()
                                };
                                mainChanges++;
                            }
                        }
                        if (mainChanges > 0) {
                            Lampa.Storage.set('file_view', mainView, true);
                            log('Also updated main file_view with', mainChanges, 'items');
                        }
                        
                        // Перечитываем таймлайны в Lampa
                        if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
                            Lampa.Timeline.read(true);
                            log('Timeline.read() called');
                        }
                        
                        if (showNotify) notify('📥 Загружено ' + updated + ' таймлайнов' + (skipped > 0 ? ' (' + skipped + ' пропущено)' : ''));
                    } else {
                        if (showNotify) notify('✅ Данные актуальны (' + Object.keys(remoteTimelines).length + ' таймлайнов)');
                    }

                    const newCfg = getConfig();
                    newCfg.lastSync = Date.now();
                    saveConfig(newCfg);

                } catch(e) {
                    logError('Parse error:', e.message, e.stack);
                    if (showNotify) notify('❌ Ошибка чтения данных: ' + e.message);
                }
            },
            error: function(xhr) {
                logError('Load error:', xhr.status, xhr.responseText);
                if (xhr.status === 404) {
                    if (showNotify) notify('❌ Gist не найден (404)');
                } else if (xhr.status === 401) {
                    if (showNotify) notify('❌ Ошибка авторизации. Проверьте токен');
                } else {
                    let errorMsg = 'Ошибка загрузки';
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

        log('Settings initialized via SettingsApi');
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
                log('Scheduled sync triggered');
                syncToGist(false);
            }
        }, 5000);
    }

    function initPlayerListeners() {
        Lampa.Player.listener.follow('timeupdate', function(e) {
            scheduleSync();
        });

        Lampa.Player.listener.follow('destroy', function() {
            clearTimeout(syncTimer);
            setTimeout(function() {
                var cfg = getConfig();
                if (cfg.token && cfg.gistId) {
                    log('Player destroy sync');
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
            log('Loading from Gist on start');
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
