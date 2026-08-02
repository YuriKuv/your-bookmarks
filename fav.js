(function() {
    'use strict';

    if (window.favorites_gist_loaded) return;
    window.favorites_gist_loaded = true;

    // ============== КОНФИГУРАЦИЯ ==============
    const CFG_KEY = 'favorites_gist_config';
    const GIST_API = 'https://api.github.com/gists';
    const SYNC_INTERVAL = 60000;
    const SAVE_DELAY = 2000;
    const DEBUG = true;

    // ============== ЛОГГИРОВАНИЕ ==============
    function log() {
        if (DEBUG) {
            console.log.apply(console, ['[FavoritesSync]'].concat(Array.from(arguments)));
        }
    }

    function logError() {
        console.error.apply(console, ['[FavoritesSync] ERROR:'].concat(Array.from(arguments)));
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

    // ============== ГЕНЕРАЦИЯ ID ДЛЯ КОНТЕНТА ==============
    function generateContentId(item) {
        if (!item) return null;
        
        try {
            if (item.original_title) {
                return 'movie_' + Lampa.Utils.hash(item.original_title);
            }
            if (item.original_name) {
                const season = item.season || 1;
                const episode = item.episode || 1;
                return 'tv_' + Lampa.Utils.hash([season, episode, item.original_name].join(''));
            }
            if (item.id) {
                return (item.media_type || 'unknown') + '_' + item.id;
            }
        } catch(e) {
            logError('Hash generation error:', e);
        }
        return null;
    }

    // ============== ПОЛУЧЕНИЕ ВСЕХ КЛЮЧЕЙ ИЗБРАННОГО ==============
    function getAllFavoriteKeys() {
        const keys = ['favorites', 'bookmarks', 'fav', 'favourite'];
        const profileId = getProfileId();
        if (profileId) {
            keys.push('favorites_' + profileId);
            keys.push('bookmarks_' + profileId);
        }
        
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && (k.startsWith('fav_') || k.startsWith('bookmark_') || k.startsWith('favorite_'))) {
                if (!keys.includes(k)) {
                    keys.push(k);
                }
            }
        }
        
        return keys;
    }

    // ============== ПОЛУЧЕНИЕ ВСЕХ ИЗБРАННЫХ ==============
    function getAllFavorites() {
        const allFavorites = {};
        const keys = getAllFavoriteKeys();
        
        keys.forEach(key => {
            try {
                const data = Lampa.Storage.get(key, {});
                if (typeof data === 'object' && data !== null) {
                    for (const id in data) {
                        const item = data[id];
                        if (!item) continue;
                        
                        const updated = item.updated || item.timestamp || Date.now();
                        const added = item.added || updated;
                        
                        if (item.title || item.original_title || item.original_name) {
                            if (allFavorites[id]) {
                                if (updated > allFavorites[id].updatedAt) {
                                    allFavorites[id] = {
                                        ...item,
                                        updatedAt: updated,
                                        source: key
                                    };
                                }
                            } else {
                                allFavorites[id] = {
                                    ...item,
                                    updatedAt: updated,
                                    addedAt: added,
                                    source: key
                                };
                            }
                        }
                    }
                }
            } catch(e) {
                logError('Error reading', key, ':', e);
            }
        });
        
        return allFavorites;
    }

    // ============== СОХРАНЕНИЕ ИЗБРАННЫХ ==============
    function saveFavoritesToAllStorages(favorites) {
        const keys = getAllFavoriteKeys();
        let saved = 0;

        const dataByKey = {};
        keys.forEach(key => {
            dataByKey[key] = {};
        });

        for (const id in favorites) {
            const item = favorites[id];
            const data = {
                ...item,
                updated: item.updatedAt || Date.now(),
                added: item.addedAt || Date.now()
            };
            
            delete data.updatedAt;
            delete data.addedAt;
            delete data.source;
            
            for (const key in dataByKey) {
                dataByKey[key][id] = data;
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

    // ============== ОПЕРАЦИИ С ИЗБРАННЫМ ==============
    function addToFavorites(item, showNotify = true) {
        if (!item) return false;
        
        const id = generateContentId(item);
        if (!id) {
            if (showNotify) notify('⚠️ Не удалось идентифицировать контент');
            return false;
        }
        
        const now = Date.now();
        const keys = getAllFavoriteKeys();
        
        const favoriteData = {
            id: id,
            title: item.title || item.original_title || item.original_name || 'Без названия',
            original_title: item.original_title || item.title || '',
            original_name: item.original_name || item.name || '',
            media_type: item.media_type || (item.original_name ? 'tv' : 'movie'),
            poster_path: item.poster_path || '',
            backdrop_path: item.backdrop_path || '',
            overview: item.overview || '',
            release_date: item.release_date || item.first_air_date || '',
            vote_average: item.vote_average || 0,
            vote_count: item.vote_count || 0,
            added: now,
            updated: now
        };
        
        if (item.season) favoriteData.season = item.season;
        if (item.episode) favoriteData.episode = item.episode;
        
        keys.forEach(key => {
            try {
                const data = Lampa.Storage.get(key, {});
                data[id] = favoriteData;
                Lampa.Storage.set(key, data);
            } catch(e) {
                logError('Error saving to', key, ':', e);
            }
        });
        
        forceFavoritesUIUpdate();
        if (showNotify) notify('⭐ Добавлено в избранное: ' + favoriteData.title);
        
        scheduleSync();
        return true;
    }

    function removeFromFavorites(id, showNotify = true) {
        if (!id) return false;
        
        const keys = getAllFavoriteKeys();
        let title = '';
        
        keys.forEach(key => {
            try {
                const data = Lampa.Storage.get(key, {});
                if (data[id]) {
                    title = data[id].title || '';
                    delete data[id];
                    Lampa.Storage.set(key, data);
                }
            } catch(e) {
                logError('Error removing from', key, ':', e);
            }
        });
        
        forceFavoritesUIUpdate();
        if (showNotify) notify('🗑️ Удалено из избранного: ' + (title || ''));
        
        scheduleSync();
        return true;
    }

    function isFavorite(id) {
        if (!id) return false;
        const keys = getAllFavoriteKeys();
        for (const key of keys) {
            try {
                const data = Lampa.Storage.get(key, {});
                if (data[id]) return true;
            } catch(e) {}
        }
        return false;
    }

    // ============== ОБНОВЛЕНИЕ UI ==============
    function forceFavoritesUIUpdate() {
        try {
            const activity = Lampa.Activity.active();
            const movie = activity?.movie;
            if (movie) {
                const id = generateContentId(movie);
                if (id) {
                    const isFav = isFavorite(id);
                    
                    // Обновляем кнопку в карточке
                    $('.button--book, .card-fav-btn, .full-start__button.button--book').each(function() {
                        const path = $(this).find('path');
                        if (path.length) {
                            path.attr('fill', isFav ? 'currentColor' : 'transparent');
                        }
                        $(this).toggleClass('active', isFav);
                        $(this).attr('data-fav', isFav ? 'true' : 'false');
                    });
                    
                    // Обновляем иконку звезды
                    $('.icon--star, .card__icon.icon--star').each(function() {
                        $(this).toggleClass('active', isFav);
                    });
                }
            }
            
            // Отправляем событие
            if (Lampa.Listener) {
                Lampa.Listener.send('favorites', {
                    type: 'update',
                    data: { favorites: getAllFavorites() }
                });
            }
            
            log('Favorites UI updated');
        } catch(e) {
            logError('UI update error:', e);
        }
    }

    // ============== ХРАНИЛИЩЕ КОНФИГА ==============
    function getConfig() {
        return Lampa.Storage.get(CFG_KEY, {
            token: '',
            gistId: '',
            lastSync: 0,
            enabled: true,
            autoSync: true,
            syncOnStart: true
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

        const favorites = getAllFavorites();
        const count = Object.keys(favorites).length;
        
        if (count === 0) {
            if (showNotify) notify('⚠️ Нет избранного для синхронизации');
            return false;
        }

        log('SYNC TO GIST:', count, 'favorites');

        const data = {
            description: 'Lampa Favorites Sync',
            public: false,
            files: {
                'favorites.json': {
                    content: JSON.stringify({
                        version: 2,
                        profile: getProfileId() || 'default',
                        updated: new Date().toISOString(),
                        count: count,
                        favorites: favorites
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
            if (showNotify) notify('✅ Синхронизировано ' + count + ' элементов');
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
        const favorites = getAllFavorites();
        const count = Object.keys(favorites).length;
        
        if (count === 0) {
            if (showNotify) notify('⚠️ Нет избранного для синхронизации');
            return false;
        }

        const data = {
            description: 'Lampa Favorites Sync',
            public: false,
            files: {
                'favorites.json': {
                    content: JSON.stringify({
                        version: 2,
                        profile: getProfileId() || 'default',
                        updated: new Date().toISOString(),
                        count: count,
                        favorites: favorites
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
                const content = data.files && data.files['favorites.json'] ? data.files['favorites.json'].content : null;
                
                if (!content) {
                    if (showNotify) notify('⚠️ Файл favorites.json не найден');
                    return;
                }

                const remote = JSON.parse(content);
                const remoteFavorites = remote.favorites || {};
                
                log('Gist has', Object.keys(remoteFavorites).length, 'favorites');
                
                if (Object.keys(remoteFavorites).length === 0) {
                    if (showNotify) notify('⚠️ В Gist нет избранного');
                    return;
                }

                const localFavorites = getAllFavorites();
                let changes = 0;
                let merged = { ...localFavorites };

                for (const id in remoteFavorites) {
                    const remoteData = remoteFavorites[id];
                    const localData = merged[id];
                    
                    if (!localData) {
                        merged[id] = remoteData;
                        changes++;
                        log('New from Gist:', id);
                        continue;
                    }
                    
                    const remoteUpdated = remoteData.updated || remoteData.updatedAt || 0;
                    const localUpdated = localData.updated || localData.updatedAt || 0;
                    
                    if (remoteUpdated > localUpdated) {
                        merged[id] = remoteData;
                        changes++;
                        log('Updated from Gist:', id);
                    }
                }

                if (changes > 0) {
                    saveFavoritesToAllStorages(merged);
                    forceFavoritesUIUpdate();
                    
                    if (showNotify) notify('📥 Загружено ' + changes + ' элементов');
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

    // ============== ФОРСИРОВАННОЕ ДОБАВЛЕНИЕ КНОПКИ ==============
    function forceAddFavoriteButton() {
        // Ждем загрузки карточки
        Lampa.Listener.follow('full', function(e) {
            if (e.type === 'open' || e.type === 'complite') {
                setTimeout(function() {
                    addFavoriteButtonToCard();
                }, 500);
            }
        });

        // Периодическая проверка для надежности
        setInterval(function() {
            const activity = Lampa.Activity.active();
            if (activity && activity.component === 'full') {
                addFavoriteButtonToCard();
            }
        }, 3000);
    }

    function addFavoriteButtonToCard() {
        const activity = Lampa.Activity.active();
        if (!activity) return;
        
        const movie = activity.movie;
        if (!movie) return;

        // Проверяем наличие контейнера с кнопками
        let container = $('.full-start__buttons, .full-start-new__buttons, .player__tools, .card__actions');
        if (!container.length) return;

        // Проверяем, есть ли уже кнопка избранного
        if ($('.favorites-custom-btn, .button--book').length > 0) {
            // Обновляем состояние существующей кнопки
            updateFavoriteButtonState();
            return;
        }

        const id = generateContentId(movie);
        if (!id) return;

        const isFav = isFavorite(id);

        // Создаем кнопку
        const btn = $(`
            <div class="full-start__button selector favorites-custom-btn" style="cursor:pointer;display:flex;align-items:center;gap:8px;padding:8px 16px;border-radius:8px;background:rgba(255,255,255,0.05);transition:all 0.2s;">
                <svg viewBox="0 0 24 24" width="24" height="24" style="fill:${isFav ? 'currentColor' : 'transparent'};stroke:currentColor;stroke-width:2;stroke-linejoin:round;">
                    <path d="M12 17.27L18.18 21L16.54 13.97L22 9.24L14.81 8.63L12 2L9.19 8.63L2 9.24L7.46 13.97L5.82 21L12 17.27Z"/>
                </svg>
                <span style="font-size:0.9em;font-weight:300;">${isFav ? 'В избранном' : 'В избранное'}</span>
            </div>
        `);

        btn.on('hover:enter', function() {
            const currentMovie = Lampa.Activity.active()?.movie;
            if (!currentMovie) return;

            const currentId = generateContentId(currentMovie);
            if (!currentId) return;

            if (isFavorite(currentId)) {
                removeFromFavorites(currentId, true);
                $(this).find('path').attr('fill', 'transparent');
                $(this).find('span').text('В избранное');
                $(this).attr('data-fav', 'false');
            } else {
                addToFavorites(currentMovie, true);
                $(this).find('path').attr('fill', 'currentColor');
                $(this).find('span').text('В избранном');
                $(this).attr('data-fav', 'true');
            }
            
            // Обновляем все кнопки
            updateFavoriteButtonState();
        });

        // Добавляем кнопку перед существующими
        container.prepend(btn);
        log('Favorite button added to card');
    }

    function updateFavoriteButtonState() {
        const activity = Lampa.Activity.active();
        if (!activity) return;
        
        const movie = activity.movie;
        if (!movie) return;

        const id = generateContentId(movie);
        if (!id) return;

        const isFav = isFavorite(id);

        $('.favorites-custom-btn, .button--book, .full-start__button.button--book').each(function() {
            const path = $(this).find('path');
            if (path.length) {
                path.attr('fill', isFav ? 'currentColor' : 'transparent');
            }
            const span = $(this).find('span');
            if (span.length) {
                span.text(isFav ? 'В избранном' : 'В избранное');
            }
            $(this).attr('data-fav', isFav ? 'true' : 'false');
            $(this).toggleClass('active', isFav);
        });
    }

    // ============== КОМПОНЕНТ ИЗБРАННОГО ==============
    function createFavoritesComponent() {
        try {
            if (!Lampa.Component) return;
            
            Lampa.Component.add('favorites_list', function(data) {
                const favorites = getAllFavorites();
                const items = Object.values(favorites);
                
                items.sort((a, b) => (b.added || b.addedAt || 0) - (a.added || a.addedAt || 0));
                
                return {
                    type: 'collection',
                    title: '⭐ Избранное (' + items.length + ')',
                    items: items,
                    template: function(item) {
                        return {
                            title: item.title || item.original_title || item.original_name || 'Без названия',
                            img: Lampa.Api.img(item.poster_path || item.backdrop_path, 'w300'),
                            params: {
                                style: { name: 'card' },
                                module: Lampa.Maker.module('Card').only('category_full', 'hover:enter', 'onEnter')
                            },
                            data: {
                                url: '',
                                title: item.title || item.original_title || item.original_name || 'Без названия',
                                component: 'category_full',
                                source: 'tmdb',
                                page: 1,
                                movie: item
                            }
                        };
                    }
                };
            });
            
            log('Favorites component created');
        } catch(e) {
            logError('Component creation error:', e);
        }
    }

    // ============== ДОБАВЛЕНИЕ ПУНКТА В МЕНЮ ==============
    function addMenuItem() {
        setTimeout(function() {
            try {
                var ml = $('.menu__list').eq(0);
                if (!ml.length) {
                    setTimeout(addMenuItem, 2000);
                    return;
                }
                
                if ($('.favorites-menu-item').length) return;
                
                var el = $(
                    '<li class="menu__item selector favorites-menu-item">' +
                        '<div class="menu__ico">' +
                            '<svg viewBox="0 0 24 24" width="20" height="20">' +
                                '<path fill="currentColor" d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.63L12,2L9.19,8.63L2,9.24L7.46,13.97L5.82,21L12,17.27Z"/>' +
                            '</svg>' +
                        '</div>' +
                        '<div class="menu__text">⭐ Избранное</div>' +
                    '</li>'
                );
                
                el.on('hover:enter', function(e) {
                    e.stopPropagation();
                    showFavoritesList();
                });
                
                ml.append(el);
                log('Menu item added');
            } catch(e) {
                logError('Menu item error:', e);
            }
        }, 2000);
    }

    // ============== ОТОБРАЖЕНИЕ СПИСКА ИЗБРАННОГО ==============
    function showFavoritesList() {
        const favorites = getAllFavorites();
        const items = Object.values(favorites);
        const count = items.length;
        
        if (count === 0) {
            notify('⭐ Избранное пусто');
            return;
        }
        
        items.sort((a, b) => (b.added || b.addedAt || 0) - (a.added || a.addedAt || 0));
        
        const menuItems = items.map(function(item) {
            const title = item.title || item.original_title || item.original_name || 'Без названия';
            const date = item.added ? new Date(item.added).toLocaleDateString() : '';
            return {
                title: '⭐ ' + title + (date ? ' (' + date + ')' : ''),
                action: 'open_' + item.id,
                data: item
            };
        });
        
        menuItems.push({ title: '──────────', separator: true });
        menuItems.push({ title: '🗑️ Очистить всё', action: 'clear_all' });
        menuItems.push({ title: '❌ Закрыть', action: 'cancel' });
        
        Lampa.Select.show({
            title: '⭐ Избранное (' + count + ')',
            items: menuItems,
            onSelect: function(item) {
                if (item.action === 'clear_all') {
                    Lampa.Select.show({
                        title: '⚠️ Очистить всё избранное?',
                        items: [
                            { title: '✅ Да, очистить всё', action: 'confirm' },
                            { title: '❌ Нет, отмена', action: 'cancel' }
                        ],
                        onSelect: function(confirmItem) {
                            if (confirmItem.action === 'confirm') {
                                const keys = getAllFavoriteKeys();
                                keys.forEach(key => {
                                    try {
                                        Lampa.Storage.set(key, {});
                                    } catch(e) {
                                        logError('Error clearing', key, ':', e);
                                    }
                                });
                                forceFavoritesUIUpdate();
                                notify('🗑️ Очищено всё избранное');
                                scheduleSync();
                            }
                            showFavoritesList();
                        }
                    });
                } else if (item.action && item.action.startsWith('open_')) {
                    const data = item.data;
                    if (data) {
                        Lampa.Activity.push({
                            url: '',
                            title: data.title || data.original_title || data.original_name || 'Без названия',
                            component: 'category_full',
                            source: 'tmdb',
                            page: 1,
                            movie: data
                        });
                    }
                } else if (item.action !== 'cancel') {
                    showFavoritesList();
                }
            },
            onBack: function() {
                Lampa.Controller.toggle('content');
            }
        });
    }

    // ============== СОБЫТИЯ ==============
    var syncTimer = null;
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

    // ============== ОБРАБОТЧИКИ СОБЫТИЙ ==============
    function initEventListeners() {
        // Слушаем добавление в избранное
        if (Lampa.Listener) {
            Lampa.Listener.follow('favorites', function(e) {
                if (e.type === 'add') {
                    const item = e.data?.movie || e.data;
                    if (item) addToFavorites(item, true);
                } else if (e.type === 'remove') {
                    const id = e.data?.id || e.data;
                    if (id) removeFromFavorites(id, true);
                } else if (e.type === 'toggle') {
                    const item = e.data?.movie || e.data;
                    if (item) {
                        const id = generateContentId(item);
                        if (id) {
                            if (isFavorite(id)) {
                                removeFromFavorites(id, true);
                            } else {
                                addToFavorites(item, true);
                            }
                        }
                    }
                }
            });
        }

        // Слушаем события избранного от Lampa
        Lampa.Listener.follow('state:changed', function(e) {
            if (e.target === 'favorite' && e.reason === 'update') {
                setTimeout(function() {
                    forceFavoritesUIUpdate();
                    scheduleSync();
                }, 500);
            }
        });

        // Слушаем открытие карточки
        Lampa.Listener.follow('full', function(e) {
            if (e.type === 'open' || e.type === 'complite') {
                setTimeout(function() {
                    forceFavoritesUIUpdate();
                    addFavoriteButtonToCard();
                }, 300);
            }
        });

        log('Event listeners initialized');
    }

    // ============== НАСТРОЙКИ ==============
    function setupSettings() {
        try {
            if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addComponent === 'function') {
                Lampa.SettingsApi.addComponent({
                    component: 'favorites_gist',
                    name: 'Избранное (синхр.)',
                    icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.63L12,2L9.19,8.63L2,9.24L7.46,13.97L5.82,21L12,17.27Z"/></svg>'
                });
            }

            if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addParam === 'function') {
                Lampa.SettingsApi.addParam({
                    component: 'favorites_gist',
                    param: {
                        name: 'favorites_gist_setup',
                        type: 'button'
                    },
                    field: {
                        name: 'Настройка Gist',
                        description: 'GitHub Gist для синхронизации избранного'
                    },
                    onChange: function() {
                        showGistSetup();
                    }
                });
            }

            log('Settings initialized');
        } catch(e) {
            logError('Settings setup error:', e);
        }
    }

    // ============== ДИАЛОГ НАСТРОЕК GIST ==============
    function showGistSetup() {
        const cfg = getConfig();
        const favorites = getAllFavorites();
        const count = Object.keys(favorites).length;
        const lastSync = cfg.lastSync ? new Date(cfg.lastSync).toLocaleString() : 'Никогда';
        const profileId = getProfileId() || 'не задан';
        
        Lampa.Select.show({
            title: '☁️ GitHub Gist (Избранное)',
            items: [
                { title: '🔑 Токен: ' + (cfg.token ? '✅ Установлен' : '❌ Не установлен'), action: 'token' },
                { title: '📄 Gist ID: ' + (cfg.gistId ? cfg.gistId.substring(0, 8) + '…' : '❌ Не создан'), action: 'id' },
                { title: '👤 Profile ID: ' + profileId, action: 'status' },
                { title: '──────────', separator: true },
                { title: '⭐ Избранного: ' + count, action: 'status' },
                { title: '🔄 Последняя синхр.: ' + lastSync, action: 'status' },
                { title: '──────────', separator: true },
                { title: '📤 Выгрузить в Gist', action: 'upload' },
                { title: '📥 Загрузить из Gist', action: 'download' },
                { title: '──────────', separator: true },
                { title: '🔄 Автосинхр.: ' + (cfg.autoSync ? '✅ Вкл' : '❌ Выкл'), action: 'toggle_auto' },
                { title: '──────────', separator: true },
                { title: '🧹 Очистить старые ключи', action: 'cleanup' },
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
                    setTimeout(function() { showGistSetup(); }, 2000);
                } else if (item.action === 'download') {
                    syncFromGist(true, true);
                    setTimeout(function() { showGistSetup(); }, 2000);
                } else if (item.action === 'toggle_auto') {
                    newCfg.autoSync = !newCfg.autoSync;
                    saveConfig(newCfg);
                    notify('Автосинхронизация ' + (newCfg.autoSync ? 'включена' : 'выключена'));
                    showGistSetup();
                } else if (item.action === 'cleanup') {
                    const cleaned = cleanupOldData();
                    notify('🧹 Очищено ' + cleaned + ' старых ключей');
                    setTimeout(function() { showGistSetup(); }, 1000);
                } else if (item.action === 'status') {
                    showGistSetup();
                }
            },
            onBack: function() {
                Lampa.Controller.toggle('content');
            }
        });
    }

    // ============== ОЧИСТКА СТАРЫХ ДАННЫХ ==============
    function cleanupOldData() {
        let cleaned = 0;
        const keysToRemove = [];
        
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && (
                k.startsWith('fav_old_') || 
                k.startsWith('bookmark_old_') ||
                k === 'favorites_gist_data' ||
                k === 'favorites_backup'
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

    // ============== ПЕРИОДИЧЕСКАЯ СИНХРОНИЗАЦИЯ ==============
    function startPeriodicSync() {
        setInterval(function() {
            const cfg = getConfig();
            if (cfg.token && cfg.gistId && cfg.autoSync && !isSyncing) {
                const favorites = getAllFavorites();
                if (Object.keys(favorites).length > 0) {
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
        if (cfg.syncOnStart && cfg.token && cfg.gistId) {
            setTimeout(function() {
                syncFromGist(false, true);
            }, 3000);
        }
    }

    // ============== ИНИЦИАЛИЗАЦИЯ ==============
    function init() {
        const cfg = getConfig();
        if (!cfg.enabled) {
            log('Disabled');
            return;
        }

        cleanupOldData();

        const favorites = getAllFavorites();
        const count = Object.keys(favorites).length;
        
        log('===== FAVORITES SYNC INIT =====');
        log('Profile:', getProfileId() || 'default');
        log('Found', count, 'favorites');
        log('Token:', cfg.token ? '✓' : '✗');
        log('Gist ID:', cfg.gistId ? '✓' : '✗');
        log('Auto sync:', cfg.autoSync ? '✓' : '✗');
        log('================================');

        setupSettings();
        createFavoritesComponent();
        initEventListeners();
        startPeriodicSync();
        loadOnStart();
        addMenuItem();
        forceAddFavoriteButton();

        // Добавляем кнопку в плеер
        setTimeout(function() {
            addPlayerFavButton();
        }, 5000);

        log('Favorites sync ready');
    }

    // ============== КНОПКА В ПЛЕЕРЕ ==============
    function addPlayerFavButton() {
        try {
            var container = $('.player__tools, .player-controls, .player__actions').first();
            if (!container.length) {
                setTimeout(addPlayerFavButton, 3000);
                return;
            }
            
            if ($('.player-fav-btn').length) return;
            
            var btn = $(
                '<div class="player-fav-btn selector" style="display:inline-block;padding:8px;cursor:pointer;margin:0 4px;">' +
                    '<svg viewBox="0 0 24 24" width="28" height="28" style="fill:transparent;stroke:currentColor;stroke-width:2;stroke-linejoin:round;">' +
                        '<path d="M12 17.27L18.18 21L16.54 13.97L22 9.24L14.81 8.63L12 2L9.19 8.63L2 9.24L7.46 13.97L5.82 21L12 17.27Z"/>' +
                    '</svg>' +
                '</div>'
            );
            
            btn.on('hover:enter', function() {
                var activity = Lampa.Activity.active();
                var movie = activity?.movie;
                if (movie) {
                    var id = generateContentId(movie);
                    if (id) {
                        if (isFavorite(id)) {
                            removeFromFavorites(id, true);
                            $(this).find('path').attr('fill', 'transparent');
                            $(this).removeClass('active');
                        } else {
                            addToFavorites(movie, true);
                            $(this).find('path').attr('fill', 'currentColor');
                            $(this).addClass('active');
                        }
                    }
                }
            });
            
            container.append(btn);
            log('Player favorite button added');
        } catch(e) {
            logError('Player button error:', e);
        }
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
