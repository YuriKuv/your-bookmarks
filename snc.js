(function() {
    'use strict';

    if (window.timeline_gist_loaded) return;
    window.timeline_gist_loaded = true;

    // ============== КОНФИГУРАЦИЯ ==============
    const STORE_KEY = 'timeline_gist_data';
    const CFG_KEY = 'timeline_gist_config';
    const GIST_API = 'https://api.github.com/gists';
    const SAVE_INTERVAL = 3000;

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
        // Если есть профиль, используем file_view_ + profileId
        // Иначе file_view (без суффикса)
        return profileId ? 'file_view_' + profileId : 'file_view';
    }

    // ============== ХРАНИЛИЩЕ ==============
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
        Lampa.Storage.set(CFG_KEY, cfg, true);
    }

    function getTimelines() {
        return Lampa.Storage.get(STORE_KEY, {});
    }

    function saveTimelines(data) {
        Lampa.Storage.set(STORE_KEY, data, true);
    }

    function notify(text) {
        Lampa.Noty.show(text);
    }

    // ============== ПОЛУЧЕНИЕ ДАННЫХ ИЗ FILE_VIEW ==============
    function getFileView() {
        const key = getFileViewKey();
        const data = Lampa.Storage.get(key, {});
        console.log('[TimelineSync] Reading from:', key, 'items:', Object.keys(data).length);
        return data;
    }

    function setFileView(data) {
        const key = getFileViewKey();
        Lampa.Storage.set(key, data, true);
        console.log('[TimelineSync] Saved to:', key, 'items:', Object.keys(data).length);
    }

    function extractTimelinesFromFileView() {
        const fileView = getFileView();
        const timelines = {};
        const now = Date.now();

        for (const hash in fileView) {
            const data = fileView[hash];
            if (!data || !data.time || data.time <= 0) continue;
            
            // Пропускаем трейлеры (короткие видео с высоким процентом)
            if (data.duration && data.duration < 300 && data.percent > 90) continue;
            
            timelines[hash] = {
                time: data.time,
                duration: data.duration || 0,
                percent: data.percent || 0,
                updatedAt: data.updated || now
            };
        }

        return timelines;
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
            const profileView = Lampa.Storage.get('file_view_' + profileId, {});
            if (Object.keys(profileView).length > 0) {
                allViews['file_view_' + profileId] = profileView;
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

        // Получаем все file_view
        const allViews = getAllFileViews();
        const timelines = {};
        const profileId = getProfileId();
        
        // Основной ключ для синхронизации
        const mainKey = profileId ? 'file_view_' + profileId : 'file_view';
        
        // Извлекаем данные из основного file_view
        if (allViews[mainKey]) {
            const view = allViews[mainKey];
            for (const hash in view) {
                const data = view[hash];
                if (!data || !data.time || data.time <= 0) continue;
                if (data.duration && data.duration < 300 && data.percent > 90) continue;
                
                timelines[hash] = {
                    time: data.time,
                    duration: data.duration || 0,
                    percent: data.percent || 0,
                    updatedAt: data.updated || Date.now()
                };
            }
        }

        // Если основного нет, берем первый попавшийся file_view
        if (Object.keys(timelines).length === 0) {
            for (const key in allViews) {
                const view = allViews[key];
                for (const hash in view) {
                    const data = view[hash];
                    if (!data || !data.time || data.time <= 0) continue;
                    if (data.duration && data.duration < 300 && data.percent > 90) continue;
                    
                    timelines[hash] = {
                        time: data.time,
                        duration: data.duration || 0,
                        percent: data.percent || 0,
                        updatedAt: data.updated || Date.now()
                    };
                }
                if (Object.keys(timelines).length > 0) break;
            }
        }

        if (Object.keys(timelines).length === 0) {
            if (showNotify) notify('⚠️ Нет таймлайнов для синхронизации');
            console.log('[TimelineSync] No timelines found in any file_view');
            return false;
        }

        const data = {
            description: 'Lampa Timeline Sync - ' + (profileId || 'default'),
            public: false,
            files: {
                'timeline.json': {
                    content: JSON.stringify({
                        version: 2,
                        profile: profileId || 'default',
                        updated: new Date().toISOString(),
                        timelines: timelines
                    }, null, 2)
                }
            }
        };

        console.log('[TimelineSync] Syncing', Object.keys(timelines).length, 'timelines from', mainKey);

        $.ajax({
            url: `${GIST_API}/${gist.id}`,
            method: 'PATCH',
            headers: {
                'Authorization': `token ${gist.token}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            data: JSON.stringify(data),
            success: function() {
                const cfg = getConfig();
                cfg.lastSync = Date.now();
                saveConfig(cfg);
                if (showNotify) notify('✅ Синхронизировано ' + Object.keys(timelines).length + ' таймлайнов');
                console.log('[TimelineSync] Sync complete');
            },
            error: function(xhr) {
                console.error('[TimelineSync] Sync error:', xhr);
                if (showNotify) notify('❌ Ошибка: ' + (xhr.responseJSON?.message || 'Unknown'));
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
            url: `${GIST_API}/${gist.id}`,
            method: 'GET',
            headers: {
                'Authorization': `token ${gist.token}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            success: function(data) {
                try {
                    const content = data.files?.['timeline.json']?.content;
                    if (!content) {
                        if (showNotify) notify('⚠️ Файл timeline.json не найден');
                        return;
                    }

                    const remote = JSON.parse(content);
                    const remoteTimelines = remote.timelines || {};
                    const remoteProfile = remote.profile || '';
                    
                    if (Object.keys(remoteTimelines).length === 0) {
                        if (showNotify) notify('⚠️ В Gist нет таймлайнов');
                        return;
                    }

                    // Определяем, куда сохранять
                    const currentProfile = getProfileId();
                    let targetKey = 'file_view';
                    
                    if (remoteProfile && remoteProfile === currentProfile) {
                        targetKey = 'file_view_' + currentProfile;
                    } else if (currentProfile) {
                        targetKey = 'file_view_' + currentProfile;
                    }

                    // Применяем к file_view
                    const fileView = Lampa.Storage.get(targetKey, {});
                    let changes = 0;

                    for (const hash in remoteTimelines) {
                        const remoteData = remoteTimelines[hash];
                        const localData = fileView[hash];
                        
                        // Сохраняем, если нет локально или данные новее
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
                        Lampa.Storage.set(targetKey, fileView, true);
                        // Также сохраняем в основной file_view если там нет этих данных
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
                        }
                        
                        // Перечитываем таймлайны
                        if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
                            Lampa.Timeline.read(true);
                        }
                        if (showNotify) notify(`📥 Загружено ${changes} таймлайнов`);
                    } else {
                        if (showNotify) notify('✅ Данные актуальны');
                    }

                    const cfg = getConfig();
                    cfg.lastSync = Date.now();
                    saveConfig(cfg);

                } catch(e) {
                    console.error('[TimelineSync] Parse error:', e);
                    if (showNotify) notify('❌ Ошибка чтения данных');
                }
            },
            error: function(xhr) {
                console.error('[TimelineSync] Load error:', xhr);
                if (showNotify) notify('❌ Ошибка загрузки: ' + (xhr.responseJSON?.message || 'Unknown'));
            }
        });
    }

    // ============== ПЕРЕХВАТ СОХРАНЕНИЯ В FILE_VIEW ==============
    let saveTimeout = null;
    let lastFileViewHash = '';

    function checkFileViewChanges() {
        try {
            const fileView = getFileView();
            const currentHash = JSON.stringify(fileView);
            
            if (currentHash !== lastFileViewHash) {
                lastFileViewHash = currentHash;
                
                // Сохраняем в наше хранилище
                const timelines = extractTimelinesFromFileView();
                if (Object.keys(timelines).length > 0) {
                    saveTimelines(timelines);
                    
                    // Автосинхронизация с Gist
                    const cfg = getConfig();
                    if (cfg.autoSync && cfg.token && cfg.gistId) {
                        clearTimeout(saveTimeout);
                        saveTimeout = setTimeout(() => {
                            syncToGist(false);
                        }, 10000);
                    }
                }
            }
        } catch(e) {
            console.error('[TimelineSync] Check error:', e);
        }
    }

    // ============== ПЕРЕХВАТ СОБЫТИЙ ПЛЕЕРА ==============
    function initPlayerListeners() {
        // Событие обновления времени
        Lampa.Player.listener.follow('timeupdate', function(e) {
            checkFileViewChanges();
        });

        // Событие закрытия плеера
        Lampa.Player.listener.follow('destroy', function() {
            setTimeout(() => {
                checkFileViewChanges();
                const cfg = getConfig();
                if (cfg.autoSync && cfg.token && cfg.gistId) {
                    syncToGist(false);
                }
            }, 1000);
        });

        console.log('[TimelineSync] Player listeners initialized');
    }

    // ============== ПЕРИОДИЧЕСКАЯ ПРОВЕРКА ==============
    function startPeriodicCheck() {
        setInterval(() => {
            checkFileViewChanges();
        }, SAVE_INTERVAL);
    }

    // ============== ЗАГРУЗКА ПРИ СТАРТЕ ==============
    function loadTimelinesOnStart() {
        const cfg = getConfig();
        if (!cfg.enabled) return;

        // Выводим информацию о file_view
        const profileId = getProfileId();
        const key = getFileViewKey();
        const fileView = getFileView();
        console.log('[TimelineSync] Profile ID:', profileId || 'default');
        console.log('[TimelineSync] Using file_view key:', key);
        console.log('[TimelineSync] Found', Object.keys(fileView).length, 'timelines');

        // Загружаем из Gist при старте
        if (cfg.token && cfg.gistId) {
            setTimeout(() => {
                syncFromGist(false);
            }, 3000);
        }

        // Инициализируем hash для отслеживания изменений
        lastFileViewHash = JSON.stringify(fileView);
    }

    // ============== НАСТРОЙКИ ==============
    function setupSettings() {
        if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addComponent === 'function') {
            Lampa.SettingsApi.addComponent({
                component: 'timeline_gist',
                name: 'Синхронизация таймлайнов',
                icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M13,7H11V13H17V11H13V7Z"/></svg>'
            });
        }

        Lampa.SettingsApi.addParam({
            component: 'timeline_gist',
            param: {
                name: 'timeline_gist_token',
                type: 'input'
            },
            field: {
                name: 'GitHub Token',
                description: 'Personal Access Token для доступа к Gist'
            },
            onChange: function(value) {
                const cfg = getConfig();
                cfg.token = value || '';
                saveConfig(cfg);
                notify('Токен сохранен');
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'timeline_gist',
            param: {
                name: 'timeline_gist_id',
                type: 'input'
            },
            field: {
                name: 'Gist ID',
                description: 'ID существующего Gist (оставьте пустым для создания)'
            },
            onChange: function(value) {
                const cfg = getConfig();
                cfg.gistId = value || '';
                saveConfig(cfg);
                notify('Gist ID сохранен');
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'timeline_gist',
            param: {
                name: 'timeline_gist_autosync',
                type: 'toggle',
                default: true
            },
            field: {
                name: 'Автосинхронизация',
                description: 'Автоматически синхронизировать с Gist'
            },
            onChange: function(value) {
                const cfg = getConfig();
                cfg.autoSync = value;
                saveConfig(cfg);
                notify(value ? 'Автосинхронизация включена' : 'Автосинхронизация выключена');
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'timeline_gist',
            param: {
                name: 'timeline_gist_sync_now',
                type: 'button'
            },
            field: {
                name: 'Выгрузить в Gist',
                description: 'Синхронизировать таймлайны с Gist'
            },
            onChange: function() {
                syncToGist(true);
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'timeline_gist',
            param: {
                name: 'timeline_gist_load_now',
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

        Lampa.SettingsApi.addParam({
            component: 'timeline_gist',
            param: {
                name: 'timeline_gist_clear',
                type: 'button'
            },
            field: {
                name: 'Очистить локальные таймлайны',
                description: 'Удалить все сохраненные таймлайны'
            },
            onChange: function() {
                Lampa.Select.show({
                    title: 'Удалить все таймлайны?',
                    items: [
                        { title: 'Нет', action: 'cancel' },
                        { title: 'Да, удалить', action: 'clear' }
                    ],
                    onSelect: function(item) {
                        if (item.action === 'clear') {
                            const key = getFileViewKey();
                            Lampa.Storage.set(key, {}, true);
                            Lampa.Storage.set('file_view', {}, true);
                            Lampa.Storage.set(STORE_KEY, {}, true);
                            if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
                                Lampa.Timeline.read(true);
                            }
                            lastFileViewHash = '{}';
                            notify('🗑️ Таймлайны очищены');
                        }
                    }
                });
            }
        });

        console.log('[TimelineSync] Settings initialized');
    }

    // ============== ИНИЦИАЛИЗАЦИЯ ==============
    function init() {
        const cfg = getConfig();
        if (!cfg.enabled) {
            console.log('[TimelineSync] Disabled');
            return;
        }

        console.log('[TimelineSync] Initializing...');

        setupSettings();
        loadTimelinesOnStart();
        initPlayerListeners();
        startPeriodicCheck();

        console.log('[TimelineSync] Initialized successfully');
        console.log('[TimelineSync] AutoSync:', cfg.autoSync, 'Token:', cfg.token ? '✓' : '✗', 'Gist ID:', cfg.gistId ? '✓' : '✗');
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
