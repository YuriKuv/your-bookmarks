(function() {
    'use strict';

    if (window.timeline_gist_loaded) return;
    window.timeline_gist_loaded = true;

    // ============== КОНФИГУРАЦИЯ ==============
    const STORE_KEY = 'timeline_gist_data';
    const CFG_KEY = 'timeline_gist_config';
    const GIST_API = 'https://api.github.com/gists';
    const SAVE_INTERVAL = 5000; // Сохраняем каждые 5 секунд
    const SYNC_INTERVAL = 60000; // Синхронизируем с Gist каждую минуту

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

        const timelines = getTimelines();
        const data = {
            description: 'Lampa Timeline Sync',
            public: false,
            files: {
                'timeline.json': {
                    content: JSON.stringify({
                        version: 2,
                        updated: new Date().toISOString(),
                        timelines: timelines
                    }, null, 2)
                }
            }
        };

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
                if (showNotify) notify('✅ Таймлайны синхронизированы');
                console.log('[TimelineSync] Saved to Gist:', Object.keys(timelines).length, 'items');
            },
            error: function(xhr) {
                console.error('[TimelineSync] Sync error:', xhr);
                if (showNotify) notify('❌ Ошибка синхронизации: ' + (xhr.responseJSON?.message || 'Unknown'));
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
                    const localTimelines = getTimelines();

                    // Объединяем: remote имеет приоритет (более новые данные)
                    let merged = { ...localTimelines };
                    let changes = 0;

                    for (const key in remoteTimelines) {
                        const remoteTime = remoteTimelines[key];
                        const localTime = merged[key];
                        
                        if (!localTime || remoteTime.updatedAt > localTime.updatedAt) {
                            merged[key] = remoteTime;
                            changes++;
                        }
                    }

                    if (changes > 0) {
                        saveTimelines(merged);
                        // Обновляем Lampa.Timeline
                        applyTimelinesToLampa(merged);
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

    // ============== ПРИМЕНЕНИЕ ТАЙМЛАЙНОВ К Lampa ==============
    function applyTimelinesToLampa(timelines) {
        // Получаем file_view из Lampa
        const fileView = Lampa.Storage.get('file_view', {});
        let changes = 0;

        for (const key in timelines) {
            const tl = timelines[key];
            if (!tl.time || tl.time <= 0) continue;

            // Проверяем, нужно ли обновить
            const existing = fileView[key];
            if (!existing || tl.updatedAt > (existing.updated || 0)) {
                fileView[key] = {
                    time: tl.time,
                    duration: tl.duration || 0,
                    percent: tl.percent || 0,
                    updated: tl.updatedAt || Date.now()
                };
                changes++;
            }
        }

        if (changes > 0) {
            Lampa.Storage.set('file_view', fileView, true);
            // Перечитываем таймлайны в Lampa
            if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
                Lampa.Timeline.read(true);
            }
            console.log('[TimelineSync] Applied', changes, 'timelines to Lampa');
        }
    }

    // ============== СОХРАНЕНИЕ ТАЙМЛАЙНОВ ИЗ Lampa ==============
    function saveTimelineFromLampa(hash, road) {
        if (!hash || !road || !road.time) return;

        const timelines = getTimelines();
        const existing = timelines[hash];

        // Сохраняем только если время изменилось или это новое
        if (!existing || road.time > existing.time || road.updated > (existing.updatedAt || 0)) {
            timelines[hash] = {
                time: road.time,
                duration: road.duration || 0,
                percent: road.percent || 0,
                updatedAt: Date.now()
            };
            saveTimelines(timelines);
            
            // Автосинхронизация с Gist
            const cfg = getConfig();
            if (cfg.autoSync && cfg.token && cfg.gistId) {
                // Отправляем с задержкой, чтобы не спамить
                clearTimeout(window._timelineSyncTimeout);
                window._timelineSyncTimeout = setTimeout(() => {
                    syncToGist(false);
                }, 30000);
            }
        }
    }

    // ============== ПЕРЕХВАТ СОБЫТИЙ Lampa ==============
    function initTimelineListener() {
        // Слушаем обновления таймлайна от Lampa
        if (Lampa.Timeline && Lampa.Timeline.listener) {
            Lampa.Timeline.listener.follow('update', function(e) {
                if (e.data && e.data.hash && e.data.road) {
                    saveTimelineFromLampa(e.data.hash, e.data.road);
                }
            });
        }

        // Слушаем state:changed (запасной вариант)
        Lampa.Listener.follow('state:changed', function(e) {
            if (e.target === 'timeline' && e.reason === 'update' && e.data) {
                if (e.data.hash && e.data.road) {
                    saveTimelineFromLampa(e.data.hash, e.data.road);
                }
            }
        });

        console.log('[TimelineSync] Timeline listener initialized');
    }

    // ============== ЗАГРУЗКА ПРИ СТАРТЕ ==============
    function loadTimelinesOnStart() {
        const cfg = getConfig();
        if (!cfg.enabled) return;

        // Загружаем из Gist при старте
        if (cfg.token && cfg.gistId) {
            setTimeout(() => {
                syncFromGist(false);
            }, 3000);
        }

        // Загружаем сохраненные таймлайны в Lampa
        const timelines = getTimelines();
        if (Object.keys(timelines).length > 0) {
            applyTimelinesToLampa(timelines);
        }
    }

    // ============== НАСТРОЙКИ ==============
    function setupSettings() {
        // Добавляем компонент в настройки
        Lampa.SettingsApi.addComponent({
            component: 'timeline_gist',
            name: 'Синхронизация таймлайнов',
            icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M13,7H11V13H17V11H13V7Z"/></svg>'
        });

        // Параметр: токен
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

        // Параметр: Gist ID
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

        // Параметр: автосинхронизация
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

        // Параметр: синхронизировать сейчас
        Lampa.SettingsApi.addParam({
            component: 'timeline_gist',
            param: {
                name: 'timeline_gist_sync_now',
                type: 'button'
            },
            field: {
                name: 'Синхронизировать сейчас',
                description: 'Выгрузить таймлайны в Gist'
            },
            onChange: function() {
                syncToGist(true);
            }
        });

        // Параметр: загрузить сейчас
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

        // Параметр: очистить локальные
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
                            saveTimelines({});
                            const fileView = Lampa.Storage.get('file_view', {});
                            for (const key in fileView) {
                                delete fileView[key];
                            }
                            Lampa.Storage.set('file_view', fileView, true);
                            if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
                                Lampa.Timeline.read(true);
                            }
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

        // Настройки
        setupSettings();

        // Слушатель таймлайнов
        initTimelineListener();

        // Загрузка при старте
        loadTimelinesOnStart();

        // Автосинхронизация каждую минуту
        setInterval(() => {
            const cfg = getConfig();
            if (cfg.autoSync && cfg.token && cfg.gistId) {
                const timelines = getTimelines();
                if (Object.keys(timelines).length > 0) {
                    syncToGist(false);
                }
            }
        }, SYNC_INTERVAL);

        console.log('[TimelineSync] Initialized successfully');
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
