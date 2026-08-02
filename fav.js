(function() {
    'use strict';

    if (window.favorites_standalone_loaded) return;
    window.favorites_standalone_loaded = true;

    // ============== КЛЮЧИ ХРАНИЛИЩА ==============
    const STORAGE_KEY = 'standalone_favorites';
    const DEBUG = true;

    // ============== ЛОГГИРОВАНИЕ ==============
    function log() {
        if (DEBUG) {
            console.log.apply(console, ['[Favorites]'].concat(Array.from(arguments)));
        }
    }

    function logError() {
        console.error.apply(console, ['[Favorites] ERROR:'].concat(Array.from(arguments)));
    }

    // ============== РАБОТА С ХРАНИЛИЩЕМ ==============
    function getFavorites() {
        try {
            const data = Lampa.Storage.get(STORAGE_KEY, {});
            if (typeof data === 'object' && data !== null) {
                return data;
            }
            return {};
        } catch(e) {
            logError('Get favorites error:', e);
            return {};
        }
    }

    function saveFavorites(data) {
        try {
            Lampa.Storage.set(STORAGE_KEY, data);
        } catch(e) {
            logError('Save favorites error:', e);
        }
    }

    // ============== ГЕНЕРАЦИЯ ID ДЛЯ КОНТЕНТА ==============
    function generateContentId(item) {
        if (!item) return null;
        
        try {
            // Для фильмов
            if (item.original_title) {
                return 'movie_' + Lampa.Utils.hash(item.original_title);
            }
            // Для сериалов
            if (item.original_name) {
                const season = item.season || 1;
                const episode = item.episode || 1;
                return 'tv_' + Lampa.Utils.hash([season, episode, item.original_name].join(''));
            }
            // Для других типов
            if (item.id) {
                return (item.media_type || 'unknown') + '_' + item.id;
            }
            // Если есть title
            if (item.title) {
                return 'title_' + Lampa.Utils.hash(item.title);
            }
        } catch(e) {
            logError('Hash generation error:', e);
        }
        return null;
    }

    function getCurrentContent() {
        try {
            const activity = Lampa.Activity.active();
            const movie = activity?.movie;
            if (!movie) return null;
            
            // Определяем сезон и эпизод для сериалов
            let season = activity?.season || 1;
            let episode = activity?.episode || 1;
            
            // Клонируем карточку и добавляем данные о сезоне/эпизоде
            const item = JSON.parse(JSON.stringify(movie));
            if (item.original_name) {
                item.season = season;
                item.episode = episode;
            }
            
            return item;
        } catch(e) {
            logError('Get current content error:', e);
            return null;
        }
    }

    // ============== ОСНОВНЫЕ ФУНКЦИИ ==============
    function addToFavorites(item, showNotify = true) {
        if (!item) return false;
        
        const id = generateContentId(item);
        if (!id) {
            if (showNotify) notify('⚠️ Не удалось идентифицировать контент');
            return false;
        }
        
        const favorites = getFavorites();
        
        // Проверяем, есть ли уже в избранном
        if (favorites[id]) {
            if (showNotify) notify('ℹ️ Уже в избранном');
            return false;
        }
        
        // Сохраняем данные
        const now = Date.now();
        favorites[id] = {
            id: id,
            title: item.title || item.original_title || item.original_name || 'Без названия',
            original_title: item.original_title || '',
            original_name: item.original_name || item.name || '',
            media_type: item.media_type || (item.original_name ? 'tv' : 'movie'),
            poster_path: item.poster_path || item.poster || '',
            backdrop_path: item.backdrop_path || item.backdrop || '',
            overview: item.overview || '',
            release_date: item.release_date || item.first_air_date || '',
            vote_average: item.vote_average || 0,
            vote_count: item.vote_count || 0,
            season: item.season || 1,
            episode: item.episode || 1,
            added: now,
            updated: now,
            source: item.source || 'tmdb'
        };
        
        saveFavorites(favorites);
        updateUI(id, true);
        
        if (showNotify) notify('⭐ Добавлено в избранное: ' + favorites[id].title);
        log('Added to favorites:', id, favorites[id].title);
        return true;
    }

    function removeFromFavorites(id, showNotify = true) {
        if (!id) return false;
        
        const favorites = getFavorites();
        if (!favorites[id]) {
            if (showNotify) notify('⚠️ Не найдено в избранном');
            return false;
        }
        
        const title = favorites[id].title || '';
        delete favorites[id];
        saveFavorites(favorites);
        updateUI(id, false);
        
        if (showNotify) notify('🗑️ Удалено из избранного: ' + title);
        log('Removed from favorites:', id);
        return true;
    }

    function toggleFavorite(item, showNotify = true) {
        if (!item) return false;
        
        const id = generateContentId(item);
        if (!id) {
            if (showNotify) notify('⚠️ Не удалось идентифицировать контент');
            return false;
        }
        
        const favorites = getFavorites();
        if (favorites[id]) {
            return removeFromFavorites(id, showNotify);
        } else {
            return addToFavorites(item, showNotify);
        }
    }

    function isFavorite(id) {
        if (!id) return false;
        const favorites = getFavorites();
        return !!favorites[id];
    }

    function getAllFavorites() {
        const favorites = getFavorites();
        const result = [];
        for (const id in favorites) {
            result.push(favorites[id]);
        }
        // Сортируем по дате добавления (новые сначала)
        result.sort((a, b) => (b.added || 0) - (a.added || 0));
        return result;
    }

    function getFavoriteCount() {
        return Object.keys(getFavorites()).length;
    }

    function clearAllFavorites(showNotify = true) {
        saveFavorites({});
        updateUI(null, false, true);
        if (showNotify) notify('🗑️ Всё избранное очищено');
        log('All favorites cleared');
    }

    // ============== ОБНОВЛЕНИЕ UI ==============
    function updateUI(id, isFav, forceAll = false) {
        try {
            if (forceAll) {
                // Обновляем все кнопки
                $('.fav-btn, .favorite-btn, .card-fav-btn').each(function() {
                    const btnId = $(this).attr('data-content-id');
                    if (btnId) {
                        const fav = isFavorite(btnId);
                        $(this).toggleClass('active', fav);
                        $(this).attr('data-fav', fav ? 'true' : 'false');
                    }
                });
                return;
            }
            
            if (!id) return;
            
            // Обновляем кнопки с этим ID
            $('.fav-btn[data-content-id="' + id + '"], .favorite-btn[data-content-id="' + id + '"], .card-fav-btn[data-content-id="' + id + '"]').each(function() {
                $(this).toggleClass('active', isFav);
                $(this).attr('data-fav', isFav ? 'true' : 'false');
            });
            
            // Обновляем кнопку в плеере
            const currentContent = getCurrentContent();
            if (currentContent) {
                const currentId = generateContentId(currentContent);
                if (currentId === id) {
                    const fav = isFavorite(id);
                    $('.player-fav-btn, .player__fav, .full-start__button--fav').each(function() {
                        $(this).toggleClass('active', fav);
                        $(this).attr('data-fav', fav ? 'true' : 'false');
                    });
                }
            }
            
            // Отправляем событие обновления
            Lampa.Listener.send('favorites:update', {
                type: 'update',
                data: { id: id, isFav: isFav, favorites: getAllFavorites() }
            });
            
        } catch(e) {
            logError('UI update error:', e);
        }
    }

    // ============== УВЕДОМЛЕНИЯ ==============
    function notify(text) {
        try {
            Lampa.Noty.show(text);
        } catch(e) {
            console.log('[Favorites]', text);
        }
    }

    // ============== ПОКАЗ СПИСКА ИЗБРАННОГО ==============
    function showFavoritesList() {
        const items = getAllFavorites();
        const count = items.length;
        
        if (count === 0) {
            notify('⭐ Избранное пусто');
            return;
        }
        
        // Создаем список для отображения через Select
        const menuItems = items.map(function(item, index) {
            const title = item.title || item.original_title || item.original_name || 'Без названия';
            const date = item.added ? new Date(item.added).toLocaleDateString() : '';
            return {
                title: (index + 1) + '. ' + title + (date ? ' (' + date + ')' : ''),
                action: 'open_' + item.id,
                data: item
            };
        });
        
        menuItems.push({ title: '──────────', separator: true });
        menuItems.push({ title: '🗑️ Очистить всё (' + count + ')', action: 'clear_all' });
        menuItems.push({ title: '❌ Закрыть', action: 'cancel' });
        
        try {
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
                                    clearAllFavorites(true);
                                }
                                showFavoritesList();
                            }
                        });
                    } else if (item.action && item.action.startsWith('open_')) {
                        const data = item.data;
                        if (data) {
                            try {
                                Lampa.Activity.push({
                                    url: '',
                                    title: data.title || data.original_title || data.original_name || 'Без названия',
                                    component: 'category_full',
                                    source: data.source || 'tmdb',
                                    page: 1,
                                    movie: data
                                });
                            } catch(e) {
                                logError('Open content error:', e);
                            }
                        }
                    } else if (item.action !== 'cancel') {
                        showFavoritesList();
                    }
                },
                onBack: function() {
                    try {
                        Lampa.Controller.toggle('content');
                    } catch(e) {}
                }
            });
        } catch(e) {
            logError('Show favorites list error:', e);
        }
    }

    // ============== ДОБАВЛЕНИЕ КНОПКИ В КАРТОЧКУ ==============
    function addFavoriteButtonToCard() {
        try {
            // Ищем контейнер для кнопок в карточке
            const container = $('.full-start-new__buttons, .full-start__buttons, .card__actions');
            if (!container.length) {
                setTimeout(addFavoriteButtonToCard, 2000);
                return;
            }
            
            if ($('.fav-btn').length) return;
            
            // Создаем кнопку
            const btn = $(
                '<div class="full-start__button selector fav-btn" style="display:flex;align-items:center;gap:8px;padding:8px 16px;cursor:pointer;border-radius:4px;">' +
                    '<svg viewBox="0 0 24 24" width="24" height="24" style="fill:currentColor;">' +
                        '<path d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.63L12,2L9.19,8.63L2,9.24L7.46,13.97L5.82,21L12,17.27Z"/>' +
                    '</svg>' +
                    '<span style="font-size:14px;">В избранное</span>' +
                '</div>'
            );
            
            // Обработчик клика
            btn.on('hover:enter', function() {
                const content = getCurrentContent();
                if (content) {
                    const id = generateContentId(content);
                    if (id) {
                        const fav = isFavorite(id);
                        if (fav) {
                            removeFromFavorites(id, true);
                        } else {
                            addToFavorites(content, true);
                        }
                        // Обновляем текст кнопки
                        const newFav = isFavorite(id);
                        $(this).find('span').text(newFav ? 'В избранном' : 'В избранное');
                        $(this).toggleClass('active', newFav);
                        $(this).attr('data-fav', newFav ? 'true' : 'false');
                    }
                }
            });
            
            container.append(btn);
            log('Favorite button added to card');
        } catch(e) {
            logError('Add button to card error:', e);
        }
    }

    // ============== ДОБАВЛЕНИЕ КНОПКИ В ПЛЕЕР ==============
    function addFavoriteButtonToPlayer() {
        try {
            const container = $('.player__tools, .player-controls, .player__actions');
            if (!container.length) {
                setTimeout(addFavoriteButtonToPlayer, 3000);
                return;
            }
            
            if ($('.player-fav-btn').length) return;
            
            const btn = $(
                '<div class="player-fav-btn selector" style="display:inline-block;padding:8px;cursor:pointer;margin:0 4px;">' +
                    '<svg viewBox="0 0 24 24" width="28" height="28" style="fill:currentColor;">' +
                        '<path d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.63L12,2L9.19,8.63L2,9.24L7.46,13.97L5.82,21L12,17.27Z"/>' +
                    '</svg>' +
                '</div>'
            );
            
            btn.on('hover:enter', function() {
                const content = getCurrentContent();
                if (content) {
                    const id = generateContentId(content);
                    if (id) {
                        const fav = isFavorite(id);
                        toggleFavorite(content, true);
                        $(this).toggleClass('active', !fav);
                        $(this).attr('data-fav', !fav ? 'true' : 'false');
                    }
                }
            });
            
            container.append(btn);
            log('Favorite button added to player');
        } catch(e) {
            logError('Add button to player error:', e);
        }
    }

    // ============== ДОБАВЛЕНИЕ ПУНКТА В МЕНЮ ==============
    function addMenuItem() {
        setTimeout(function() {
            try {
                const ml = $('.menu__list').eq(0);
                if (!ml.length) {
                    setTimeout(addMenuItem, 2000);
                    return;
                }
                
                if ($('.favorites-menu-item').length) return;
                
                const count = getFavoriteCount();
                const el = $(
                    '<li class="menu__item selector favorites-menu-item">' +
                        '<div class="menu__ico">' +
                            '<svg viewBox="0 0 24 24" width="20" height="20">' +
                                '<path fill="currentColor" d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.63L12,2L9.19,8.63L2,9.24L7.46,13.97L5.82,21L12,17.27Z"/>' +
                            '</svg>' +
                        '</div>' +
                        '<div class="menu__text">⭐ Избранное (' + count + ')</div>' +
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

    // ============== НАСТРОЙКИ ==============
    function setupSettings() {
        try {
            if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addComponent === 'function') {
                Lampa.SettingsApi.addComponent({
                    component: 'standalone_favorites',
                    name: '⭐ Избранное (автономное)',
                    icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.63L12,2L9.19,8.63L2,9.24L7.46,13.97L5.82,21L12,17.27Z"/></svg>'
                });
            }

            if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addParam === 'function') {
                Lampa.SettingsApi.addParam({
                    component: 'standalone_favorites',
                    param: {
                        name: 'standalone_favorites_show',
                        type: 'button'
                    },
                    field: {
                        name: 'Показать избранное',
                        description: 'Открыть список избранного (' + getFavoriteCount() + ' элементов)'
                    },
                    onChange: function() {
                        showFavoritesList();
                    }
                });
                
                Lampa.SettingsApi.addParam({
                    component: 'standalone_favorites',
                    param: {
                        name: 'standalone_favorites_clear',
                        type: 'button'
                    },
                    field: {
                        name: 'Очистить всё избранное',
                        description: 'Удалить все элементы из избранного'
                    },
                    onChange: function() {
                        Lampa.Select.show({
                            title: '⚠️ Очистить всё избранное?',
                            items: [
                                { title: '✅ Да, очистить всё', action: 'confirm' },
                                { title: '❌ Нет, отмена', action: 'cancel' }
                            ],
                            onSelect: function(item) {
                                if (item.action === 'confirm') {
                                    clearAllFavorites(true);
                                    // Обновляем счетчик в меню
                                    $('.favorites-menu-item .menu__text').text('⭐ Избранное (0)');
                                }
                            }
                        });
                    }
                });
            }

            log('Settings initialized');
        } catch(e) {
            logError('Settings setup error:', e);
            addMenuItem();
        }
    }

    // ============== ОБРАБОТЧИКИ СОБЫТИЙ ==============
    function initEventListeners() {
        try {
            // Слушаем открытие контента для обновления UI
            Lampa.Listener.follow('full', function(e) {
                if (e.type === 'open' || e.type === 'complite') {
                    setTimeout(function() {
                        const content = getCurrentContent();
                        if (content) {
                            const id = generateContentId(content);
                            if (id) {
                                const fav = isFavorite(id);
                                // Обновляем все кнопки
                                $('.fav-btn, .player-fav-btn, .full-start__button--fav').each(function() {
                                    $(this).toggleClass('active', fav);
                                    $(this).attr('data-fav', fav ? 'true' : 'false');
                                    if ($(this).find('span').length) {
                                        $(this).find('span').text(fav ? 'В избранном' : 'В избранное');
                                    }
                                });
                            }
                        }
                    }, 500);
                }
            });
            
            // Слушаем изменения избранного
            Lampa.Listener.follow('favorites:update', function(e) {
                if (e.type === 'update') {
                    // Обновляем счетчик в меню
                    const count = getFavoriteCount();
                    $('.favorites-menu-item .menu__text').text('⭐ Избранное (' + count + ')');
                    
                    // Обновляем настройки
                    if (Lampa.SettingsApi) {
                        const params = Lampa.SettingsApi.getParams();
                        if (params && params.standalone_favorites_show) {
                            Lampa.SettingsApi.updateParam('standalone_favorites_show', {
                                field: {
                                    description: 'Открыть список избранного (' + count + ' элементов)'
                                }
                            });
                        }
                    }
                }
            });

            // Слушаем готовность приложения
            Lampa.Listener.follow('app', function(e) {
                if (e.type === 'ready') {
                    setTimeout(function() {
                        addMenuItem();
                        addFavoriteButtonToCard();
                        addFavoriteButtonToPlayer();
                    }, 3000);
                }
            });

            // Слушаем изменение активности для обновления кнопок
            Lampa.Storage.listener.follow('change', function(e) {
                if (e.name === 'activity') {
                    setTimeout(function() {
                        const content = getCurrentContent();
                        if (content) {
                            const id = generateContentId(content);
                            if (id) {
                                const fav = isFavorite(id);
                                $('.fav-btn, .player-fav-btn').each(function() {
                                    $(this).toggleClass('active', fav);
                                    $(this).attr('data-fav', fav ? 'true' : 'false');
                                    if ($(this).find('span').length) {
                                        $(this).find('span').text(fav ? 'В избранном' : 'В избранное');
                                    }
                                });
                            }
                        }
                    }, 300);
                }
            });

            log('Event listeners initialized');
        } catch(e) {
            logError('Event listeners error:', e);
        }
    }

    // ============== КОМПОНЕНТ ДЛЯ ОТОБРАЖЕНИЯ ИЗБРАННОГО ==============
    function createFavoritesComponent() {
        try {
            if (!Lampa.Component) return;
            
            Lampa.Component.add('standalone_favorites', function(data) {
                const items = getAllFavorites();
                
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
                                source: item.source || 'tmdb',
                                page: 1,
                                movie: item
                            }
                        };
                    },
                    onClick: function(item) {
                        if (item && item.id) {
                            try {
                                Lampa.Activity.push({
                                    url: '',
                                    title: item.title || item.original_title || item.original_name || 'Без названия',
                                    component: 'category_full',
                                    source: item.source || 'tmdb',
                                    page: 1,
                                    movie: item
                                });
                            } catch(e) {
                                logError('Open from component error:', e);
                            }
                        }
                    }
                };
            });
            
            log('Favorites component created');
        } catch(e) {
            logError('Component creation error:', e);
        }
    }

    // ============== ЗАГРУЗКА ПРИ СТАРТЕ ==============
    function loadOnStart() {
        setTimeout(function() {
            addMenuItem();
            addFavoriteButtonToCard();
            addFavoriteButtonToPlayer();
            createFavoritesComponent();
            
            // Обновляем UI для текущего контента
            const content = getCurrentContent();
            if (content) {
                const id = generateContentId(content);
                if (id) {
                    updateUI(id, isFavorite(id));
                }
            }
            
            log('Favorites ready, count:', getFavoriteCount());
        }, 3000);
    }

    // ============== ИНИЦИАЛИЗАЦИЯ ==============
    function init() {
        log('===== FAVORITES INIT =====');
        log('Favorites count:', getFavoriteCount());
        log('==========================');

        setupSettings();
        initEventListeners();
        createFavoritesComponent();

        if (window.appready) {
            loadOnStart();
        } else {
            Lampa.Listener.follow('app', function(e) {
                if (e.type === 'ready') {
                    loadOnStart();
                }
            });
        }
    }

    // ============== ЗАПУСК ==============
    try {
        // Проверяем, что Lampa доступен
        if (typeof Lampa === 'undefined') {
            console.error('[Favorites] Lampa not found');
            return;
        }

        // Проверяем, не запущен ли уже плагин
        if (Lampa.Storage.get('standalone_favorites_loaded', false)) {
            log('Already loaded');
            return;
        }
        Lampa.Storage.set('standalone_favorites_loaded', true);

        init();
    } catch(e) {
        console.error('[Favorites] Init error:', e);
    }

})();
