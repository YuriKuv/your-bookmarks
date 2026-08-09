(function() {
    'use strict';

    if (window.timeline_gist_loaded) return;
    window.timeline_gist_loaded = true;

    // ============== КОНФИГУРАЦИЯ ==============
    const PLUGIN_NAME = 'TimelineSync';
    const CFG_KEY = 'timeline_gist_config';
    const GIST_API = 'https://api.github.com/gists';
    const SYNC_INTERVAL = 60000;
    const SAVE_DELAY = 2000;
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
            cleanMaxCount: 0,
            cleanPercentThreshold: 0,
            cleanDaysThreshold: 0
        });
    }

    function saveConfig(cfg) {
        Lampa.Storage.set(CFG_KEY, cfg);
    }

    function notify(text) {
        Lampa.Noty.show(text);
    }

    // ============== ПОЛУЧЕНИЕ PROFILE ID ==============
    function getProfileId() {
        try {
            const account = Lampa.Storage.get('account', {});
            return String((account.profile || {}).id || '');
        } catch(e) {
            return '';
        }
    }

    function getTimelineKey() {
        const profileId = getProfileId();
        return profileId ? 'file_view_' + profileId : 'file_view';
    }

    // ============== ХЕШ-ФУНКЦИЯ (ТОЧНАЯ КОПИЯ ИЗ LAMPA) ==============
    function lampaHash(input) {
        let str = (input || '') + '';
        let hash = 0;
        
        if (str.length === 0) return hash;
        
        for (let i = 0; i < str.length; i++) {
            let char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        
        return Math.abs(hash) + ''; // Lampa возвращает строку!
    }

    // ============== ГЕНЕРАЦИЯ ХЕША ДЛЯ КОНТЕНТА ==============
    function generateHash(movie, season, episode) {
        if (!movie) return null;
        
        try {
            let hashString;
            
            // Сериал: используем original_name + сезон + эпизод
            if (movie.original_name) {
                const s = season || 1;
                const e = episode || 1;
                // Формат из Lampa.Timeline.watchedEpisode
                hashString = s + (s > 10 ? ':' : '') + e + movie.original_name;
            }
            // Фильм: используем original_title
            else if (movie.original_title) {
                hashString = movie.original_title;
            }
            else if (movie.title) {
                hashString = movie.title;
            }
            else {
                return null;
            }
            
            const hash = lampaHash(hashString);
            
            log('Hash:', hashString, '→', hash);
            
            return hash;
        } catch(e) {
            logError('Hash generation error:', e);
            return null;
        }
    }

    // ============== ПОЛУЧЕНИЕ ВСЕХ ТАЙМЛАЙНОВ ==============
    function getAllTimelines() {
        const result = {};
        const key = getTimelineKey();
        
        try {
            const data = Lampa.Storage.get(key, {});
            
            if (typeof data === 'object' && data !== null) {
                for (const hash in data) {
                    const item = data[hash];
                    
                    // Пропускаем некорректные данные
                    if (!item || typeof item === 'number') continue;
                    
                    result[hash] = {
                        time: Math.round(item.time || 0),
                        duration: Math.round(item.duration || 0),
                        percent: Math.round(item.percent || 0),
                        updatedAt: item.updated || Date.now()
                    };
                }
            }
        } catch(e) {
            logError('Error reading timelines:', e);
        }
        
        return result;
    }

    // ============== СОХРАНЕНИЕ ТАЙМЛАЙНОВ ==============
    function saveAllTimelines(timelines) {
        const key = getTimelineKey();
        const data = {};
        
        for (const hash in timelines) {
            const item = timelines[hash];
            data[hash] = {
                time: item.time,
                duration: item.duration || 0,
                percent: item.percent || 0,
                updated: item.updatedAt || Date.now()
            };
        }
        
        Lampa.Storage.set(key, data);
        log('Saved', Object.keys(data).length, 'timelines to', key);
    }

    // ============== ОБНОВЛЕНИЕ ТАЙМЛАЙНА ЧЕРЕЗ LAMPA API ==============
    function updateTimelineViaAPI(hash, time, duration, percent) {
        if (!hash) return;
        
        // Используем родной метод Lampa.Timeline.update
        if (Lampa.Timeline && typeof Lampa.Timeline.update === 'function') {
            Lampa.Timeline.update({
                hash: hash,
                time: Math.round(time),
                duration: Math.round(duration || 0),
                percent: Math.round(percent || 0),
                force: true
            });
            log('Updated timeline via API:', hash, percent + '%');
        }
    }

    // ============== ОБНОВЛЕНИЕ ВСЕХ КАРТОЧЕК ==============
    function refreshAllCards() {
        try {
            log('Refreshing all cards...');
            
            // 1. Перечитываем таймлайны (это обновит viewed в памяти)
            if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
                Lampa.Timeline.read(true);
            }
            
            // 2. Обновляем Favorite (историю)
            if (Lampa.Favorite && typeof Lampa.Favorite.read === 'function') {
                Lampa.Favorite.read(true);
            }
            
            // 3. Отправляем событие изменения состояния
            if (Lampa.Listener) {
                Lampa.Listener.send('state:changed', {
                    target: 'timeline',
                    reason: 'refresh'
                });
            }
            
            // 4. Перерисовываем текущую активность
            const activity = Lampa.Activity.active();
            if (activity && typeof activity.refresh === 'function') {
                activity.refresh();
            }
            
            // 5. Обновляем все DOM элементы таймлайнов
            updateTimelineDOM();
            
            log('Cards refreshed');
        } catch(e) {
            logError('Refresh error:', e);
        }
    }

    // ============== ОБНОВЛЕНИЕ DOM ТАЙМЛАЙНОВ ==============
    function updateTimelineDOM() {
        // Получаем все слои (как делает Lampa.Timeline.update)
        const layers = Lampa.Activity.renderLayers ? Lampa.Activity.renderLayers() : [];
        layers.push($(document));
        
        layers.forEach(layer => {
            // Обновляем прогресс-бары
            $('.time-line', layer).each(function() {
                const hash = $(this).data('hash');
                if (hash) {
                    const timeline = Lampa.Timeline.view(hash);
                    if (timeline && timeline.percent > 0) {
                        $(this).toggleClass('hide', false);
                        $('> div', this).css('width', timeline.percent + '%');
                    }
                }
            });
            
            // Обновляем детали
            $('.time-line-details', layer).each(function() {
                const hash = $(this).data('hash');
                if (hash) {
                    const timeline = Lampa.Timeline.view(hash);
                    if (timeline && timeline.duration > 0) {
                        const f = Lampa.Timeline.format(timeline);
                        $(this).find('[a="t"]').text(f.time);
                        $(this).find('[a="p"]').text(f.percent);
                        $(this).find('[a="d"]').text(f.duration);
                        $(this).toggleClass('hide', false);
                    }
                }
            });
        });
    }

    // ============== GIST API ==============
    let syncInProgress = false;
    let syncQueue = [];

    function processSyncQueue() {
        if (syncQueue.length === 0 || syncInProgress) return;
        
        const next = syncQueue.shift();
        syncToGist(next.showNotify)
            .finally(() => {
                syncInProgress = false;
                processSyncQueue();
            });
    }

    function queueSync(showNotify = false) {
        syncQueue.push({ showNotify });
        if (!syncInProgress) {
            syncInProgress = true;
            processSyncQueue();
        }
    }

    function syncToGist(showNotify = false) {
        return new Promise((resolve, reject) => {
            const cfg = getConfig();
            
            if (!cfg.token || !cfg.gistId) {
                if (showNotify) notify('⚠️ Gist не настроен');
                resolve(false);
                return;
            }
            
            const timelines = getAllTimelines();
            const count = Object.keys(timelines).length;
            
            if (count === 0) {
                resolve(false);
                return;
            }
            
            log(`Syncing ${count} timelines to Gist...`);
            
            const gistData = {
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
                    // Gist не найден - создаем новый
                    return createGist(timelines);
                }
                if (response.status === 409) {
                    // Конфликт - разрешаем
                    return resolveConflict(timelines);
                }
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                return response.json();
            })
            .then(() => {
                cfg.lastSync = Date.now();
                saveConfig(cfg);
                if (showNotify) notify(`✅ Синхронизировано ${count} таймлайнов`);
                log('Sync completed');
                resolve(true);
            })
            .catch(err => {
                logError('Sync error:', err);
                if (showNotify) notify('❌ Ошибка синхронизации');
                reject(err);
            });
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
                            version: 2,
                            profile: getProfileId() || 'default',
                            updated: new Date().toISOString(),
                            count: count,
                            timelines: timelines
                        }, null, 2)
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

    function resolveConflict(localTimelines) {
        const cfg = getConfig();
        
        return fetch(`${GIST_API}/${cfg.gistId}`, {
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
            if (!content) return;
            
            const remote = JSON.parse(content);
            const remoteTimelines = remote.timelines || {};
            
            // Объединяем: более новые побеждают
            const merged = { ...remoteTimelines };
            for (const hash in localTimelines) {
                if (!merged[hash] || 
                    (localTimelines[hash].updatedAt || 0) > (merged[hash].updatedAt || 0)) {
                    merged[hash] = localTimelines[hash];
                }
            }
            
            const mergedCount = Object.keys(merged).length;
            
            return fetch(`${GIST_API}/${cfg.gistId}`, {
                method: 'PATCH',
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
                                version: 2,
                                profile: getProfileId() || 'default',
                                updated: new Date().toISOString(),
                                count: mergedCount,
                                timelines: merged
                            }, null, 2)
                        }
                    }
                })
            });
        });
    }

    function syncFromGist(showNotify = false) {
        return new Promise((resolve, reject) => {
            const cfg = getConfig();
            
            if (!cfg.token || !cfg.gistId) {
                if (showNotify) notify('⚠️ Gist не настроен');
                resolve(false);
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
                    if (showNotify) notify('⚠️ Файл не найден');
                    resolve(false);
                    return;
                }
                
                const remote = JSON.parse(content);
                const remoteTimelines = remote.timelines || {};
                const remoteCount = Object.keys(remoteTimelines).length;
                
                log(`Gist has ${remoteCount} timelines`);
                
                if (remoteCount === 0) {
                    if (showNotify) notify('⚠️ Gist пуст');
                    resolve(false);
                    return;
                }
                
                const localTimelines = getAllTimelines();
                const merged = { ...localTimelines };
                let changes = 0;
                
                // Объединяем: более новые побеждают
                for (const hash in remoteTimelines) {
                    const remoteData = remoteTimelines[hash];
                    const localData = merged[hash];
                    
                    if (!localData || 
                        (remoteData.updatedAt || 0) > (localData.updatedAt || 0)) {
                        merged[hash] = remoteData;
                        changes++;
                    }
                }
                
                if (changes > 0) {
                    saveAllTimelines(merged);
                    updateCurrentMovie(merged);
                    refreshAllCards();
                    
                    if (showNotify) notify(`📥 Загружено ${changes} таймлайнов`);
                } else {
                    if (showNotify) notify('✅ Данные актуальны');
                }
                
                cfg.lastSync = Date.now();
                saveConfig(cfg);
                resolve(true);
            })
            .catch(err => {
                logError('Load error:', err);
                if (showNotify) notify('❌ Ошибка загрузки');
                reject(err);
            });
        });
    }

    // ============== ПРИМЕНЕНИЕ К ТЕКУЩЕМУ ФИЛЬМУ ==============
    function updateCurrentMovie(timelines) {
        const activity = Lampa.Activity.active();
        const movie = activity?.movie;
        if (!movie) return;
        
        const hash = generateHash(movie, activity?.season, activity?.episode);
        if (!hash || !timelines[hash]) return;
        
        const data = timelines[hash];
        updateTimelineViaAPI(hash, data.time, data.duration, data.percent);
    }

    // ============== ОБРАБОТЧИКИ СОБЫТИЙ ==============
    let saveTimer = null;
    let lastTimeline = null;

    function scheduleSave(hash, time, duration, percent, force = false) {
        clearTimeout(saveTimer);
        
        // Сохраняем локально через API Lampa
        updateTimelineViaAPI(hash, time, duration, percent);
        
        if (force || percent >= 90) {
            // Мгновенная синхронизация
            queueSync(false);
        } else {
            // Отложенная синхронизация
            saveTimer = setTimeout(() => {
                queueSync(false);
            }, SAVE_DELAY);
        }
    }

    function initPlayerListeners() {
        // Слушаем обновления таймлайна от Lampa
        Lampa.Listener.follow('timeline', function(e) {
            if (e.type === 'update') {
                const data = e.data;
                if (data && data.hash && data.road) {
                    const activity = Lampa.Activity.active();
                    const movie = activity?.movie;
                    
                    if (movie) {
                        const hash = generateHash(movie, activity?.season, activity?.episode);
                        if (hash === data.hash) {
                            const isEnd = data.road.percent >= 95;
                            scheduleSave(data.hash, data.road.time, data.road.duration, data.road.percent, isEnd);
                        }
                    }
                }
            }
        });
        
        // Слушаем уничтожение плеера - финальное сохранение
        Lampa.Player.listener.follow('destroy', function() {
            log('Player destroyed - final sync');
            clearTimeout(saveTimer);
            
            const playdata = Lampa.Player.playdata();
            if (playdata && playdata.timeline) {
                const activity = Lampa.Activity.active();
                const movie = activity?.movie;
                if (movie) {
                    const hash = generateHash(movie, activity?.season, activity?.episode);
                    if (hash) {
                        updateTimelineViaAPI(
                            hash,
                            playdata.timeline.time,
                            playdata.timeline.duration,
                            playdata.timeline.percent
                        );
                    }
                }
            }
            
            // Мгновенная синхронизация после закрытия
            setTimeout(() => queueSync(false), 1000);
        });
        
        log('Player listeners initialized');
    }

    function initActivityListeners() {
        // При открытии контента - загружаем данные из Gist
        Lampa.Listener.follow('full', function(e) {
            if (e.type === 'open') {
                const movie = e.data?.movie;
                if (movie) {
                    log('Content opened:', movie.title || movie.original_title);
                    
                    const cfg = getConfig();
                    if (cfg.token && cfg.gistId) {
                        // Загружаем из Gist с небольшой задержкой
                        setTimeout(() => {
                            syncFromGist(false).then(() => {
                                // Применяем к текущему фильму
                                const timelines = getAllTimelines();
                                updateCurrentMovie(timelines);
                            }).catch(() => {});
                        }, 500);
                    }
                }
            }
        });
        
        log('Activity listeners initialized');
    }

    // ============== ПЕРИОДИЧЕСКАЯ СИНХРОНИЗАЦИЯ ==============
    function startPeriodicSync() {
        setInterval(() => {
            const cfg = getConfig();
            if (cfg.token && cfg.gistId && cfg.autoSync) {
                const timelines = getAllTimelines();
                if (Object.keys(timelines).length > 0) {
                    queueSync(false);
                }
            }
        }, SYNC_INTERVAL);
        
        log('Periodic sync started');
    }

    // ============== МЕНЮ НАСТРОЕК ==============
    function showSetupMenu() {
        const cfg = getConfig();
        const timelines = getAllTimelines();
        const count = Object.keys(timelines).length;
        const lastSync = cfg.lastSync ? new Date(cfg.lastSync).toLocaleString() : 'Никогда';
        
        Lampa.Select.show({
            title: '☁️ GitHub Gist',
            items: [
                { 
                    title: '🔑 Токен: ' + (cfg.token ? '✅ Установлен' : '❌ Не установлен'), 
                    action: 'token' 
                },
                { 
                    title: '📄 Gist ID: ' + (cfg.gistId ? cfg.gistId.substring(0, 8) + '…' : '❌ Не создан'), 
                    action: 'gist_id' 
                },
                { title: '──────────', separator: true },
                { title: '📊 Таймлайнов: ' + count, action: 'info' },
                { title: '🔄 Последняя синхр.: ' + lastSync, action: 'info' },
                { title: '──────────', separator: true },
                { title: '📤 Выгрузить в Gist', action: 'upload' },
                { title: '📥 Загрузить из Gist', action: 'download' },
                { title: '──────────', separator: true },
                { 
                    title: '🔄 Автосинхр.: ' + (cfg.autoSync ? '✅ Вкл' : '❌ Выкл'), 
                    action: 'toggle_auto' 
                },
                { title: '──────────', separator: true },
                { title: '🔄 Обновить карточки', action: 'refresh' },
                { title: '──────────', separator: true },
                { title: '❌ Закрыть', action: 'close' }
            ],
            onSelect: function(item) {
                const newCfg = getConfig();
                
                switch(item.action) {
                    case 'token':
                        Lampa.Input.edit({
                            title: 'GitHub Token (права: gist)',
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
                        syncToGist(true).finally(() => {
                            Lampa.Loading.stop();
                            setTimeout(showSetupMenu, 500);
                        });
                        break;
                        
                    case 'download':
                        Lampa.Loading.start();
                        syncFromGist(true).finally(() => {
                            Lampa.Loading.stop();
                            setTimeout(showSetupMenu, 500);
                        });
                        break;
                        
                    case 'toggle_auto':
                        newCfg.autoSync = !newCfg.autoSync;
                        saveConfig(newCfg);
                        notify('Автосинхронизация ' + (newCfg.autoSync ? 'включена' : 'выключена'));
                        showSetupMenu();
                        break;
                        
                    case 'refresh':
                        refreshAllCards();
                        notify('🔄 Карточки обновлены');
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

    // ============== ИНИЦИАЛИЗАЦИЯ ==============
    function init() {
        log('========================================');
        log('Plugin starting...');
        log('Profile ID:', getProfileId() || 'none');
        log('Storage key:', getTimelineKey());
        
        const timelines = getAllTimelines();
        log('Local timelines:', Object.keys(timelines).length);
        log('========================================');
        
        // Инициализируем слушатели
        initPlayerListeners();
        initActivityListeners();
        startPeriodicSync();
        
        // Загружаем данные при старте
        const cfg = getConfig();
        if (cfg.token && cfg.gistId) {
            setTimeout(() => {
                syncFromGist(false)
                    .then(() => refreshAllCards())
                    .catch(() => {});
            }, 3000);
        }
        
        // Добавляем пункт в меню
        addMenuButton();
        
        log('Plugin ready!');
    }

    function addMenuButton() {
        // Пробуем добавить через Settings API
        try {
            if (Lampa.SettingsApi) {
                Lampa.SettingsApi.addComponent({
                    component: 'timeline_gist',
                    name: 'Синхронизация таймлайнов',
                    icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M13,7H11V13H17V11H13V7Z"/></svg>'
                });
                
                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: { name: 'timeline_gist_setup', type: 'button' },
                    field: {
                        name: 'Настройка Gist',
                        description: 'Синхронизация прогресса просмотра'
                    },
                    onChange: showSetupMenu
                });
                
                log('Added to Settings API');
                return;
            }
        } catch(e) {
            logError('Settings API error:', e);
        }
        
        // Fallback: добавляем в главное меню
        setTimeout(() => {
            const menuList = $('.menu__list').eq(0);
            if (!menuList.length) return;
            
            if ($('.timeline-gist-menu-item').length) return;
            
            const menuItem = $(`
                <li class="menu__item selector timeline-gist-menu-item">
                    <div class="menu__ico">
                        <svg viewBox="0 0 24 24" width="20" height="20">
                            <path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M13,7H11V13H17V11H13V7Z"/>
                        </svg>
                    </div>
                    <div class="menu__text">Синхр. таймлайнов</div>
                </li>
            `);
            
            menuItem.on('hover:enter', showSetupMenu);
            menuList.append(menuItem);
            
            log('Added to main menu (fallback)');
        }, 2000);
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
