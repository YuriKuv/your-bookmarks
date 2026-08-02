(function() {
    'use strict';

    if (window.favorites_standalone_loaded) {
        console.log('[Favorites] Already loaded');
        return;
    }
    window.favorites_standalone_loaded = true;

    const STORAGE_KEY = 'standalone_favorites';

    function log() {
        console.log.apply(console, ['[Favorites]'].concat(Array.from(arguments)));
    }

    function logError() {
        console.error.apply(console, ['[Favorites] ERROR:'].concat(Array.from(arguments)));
    }

    if (typeof Lampa === 'undefined') {
        console.error('[Favorites] Lampa not found');
        window.favorites_standalone_loaded = false;
        return;
    }

    // ============== РАБОТА С ХРАНИЛИЩЕМ ==============
    function getFavorites() {
        try {
            return Lampa.Storage.get(STORAGE_KEY, []) || [];
        } catch(e) {
            logError('Get favorites error:', e);
            return [];
        }
    }

    function saveFavorites(data) {
        try {
            Lampa.Storage.set(STORAGE_KEY, data);
            log('Saved', data.length, 'favorites');
        } catch(e) {
            logError('Save favorites error:', e);
        }
    }

    // ============== ГЕНЕРАЦИЯ ID ==============
    function makeKey(item) {
        if (!item) return null;
        try {
            if (item.original_title) {
                return 'movie_' + Lampa.Utils.hash(item.original_title);
            }
            if (item.original_name) {
                const season = item.season || 1;
                const episode = item.episode || 1;
                return 'tv_' + Lampa.Utils.hash(String(season) + ':' + String(episode) + item.original_name);
            }
            if (item.id) {
                return (item.media_type || 'unknown') + '_' + String(item.id);
            }
        } catch(e) {
            logError('Hash generation error:', e);
        }
        return null;
    }

    // ============== ПОЛУЧЕНИЕ ТЕКУЩЕГО КОНТЕНТА ==============
    function getCurrentContent() {
        try {
            const act = Lampa.Activity.active();
            if (!act) return null;
            
            if (act.component === 'actor' || act.component === 'person') {
                return {
                    id: act.id,
                    title: act.title || act.name || 'Персона',
                    original_title: act.title || act.name || '',
                    media_type: 'person',
                    source: act.source || 'tmdb'
                };
            }
            
            const movie = act.movie || act.card;
            if (movie) {
                const item = JSON.parse(JSON.stringify(movie));
                if (item.original_name) {
                    item.season = act.season || 1;
                    item.episode = act.episode || 1;
                }
                return item;
            }
            
            return null;
        } catch(e) {
            logError('Get current content error:', e);
            return null;
        }
    }

    // ============== ОСНОВНЫЕ ФУНКЦИИ ==============
    function toggleFavorite(item, showNotify) {
        if (showNotify === undefined) showNotify = true;
        if (!item) {
            if (showNotify) Lampa.Noty.show('⚠️ Нет данных');
            return false;
        }
        
        const key = makeKey(item);
        if (!key) {
            if (showNotify) Lampa.Noty.show('⚠️ Не удалось идентифицировать контент');
            return false;
        }
        
        let favorites = getFavorites();
        const exists = favorites.some(f => f.key === key);
        
        if (exists) {
            favorites = favorites.filter(f => f.key !== key);
            saveFavorites(favorites);
            updateUI(key, false);
            if (showNotify) Lampa.Noty.show('🗑️ Удалено из избранного');
        } else {
            const now = Date.now();
            favorites.push({
                key: key,
                id: item.id || key,
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
            });
            saveFavorites(favorites);
            updateUI(key, true);
            if (showNotify) Lampa.Noty.show('⭐ Добавлено в избранное');
        }
        
        return !exists;
    }

    function isFavorite(key) {
        if (!key) return false;
        return getFavorites().some(f => f.key === key);
    }

    function getFavoriteCount() {
        return getFavorites().length;
    }

    // ============== ОБНОВЛЕНИЕ UI ==============
    function updateUI(key, isFav) {
        try {
            $('.fav-btn[data-key="' + key + '"], .card-fav-btn[data-key="' + key + '"], .player-fav-btn[data-key="' + key + '"]').each(function() {
                $(this).toggleClass('active', isFav);
                $(this).attr('data-fav', isFav ? 'true' : 'false');
                if ($(this).find('span').length) {
                    $(this).find('span').text(isFav ? 'В избранном' : 'В избранное');
                }
            });
            updateMenuCounter();
        } catch(e) {
            logError('UI update error:', e);
        }
    }

    function updateMenuCounter() {
        try {
            const count = getFavoriteCount();
            $('.favorites-menu-item .menu__text').text('⭐ Избранное (' + count + ')');
        } catch(e) {}
    }

    // ============== КОМПОНЕНТ ИЗБРАННОГО ==============
    function createFavoritesComponent() {
        // Регистрируем компонент в Lampa
        Lampa.Component.add('standalone_favorites', function(object) {
            const items = getAllFavorites();
            
            // Создаем компонент через Lampa.Main (как в bookmarks.js)
            const comp = new Lampa.Main(object);
            
            comp.use({
                onCreate: function() {
                    const lines = [];
                    
                    if (items.length === 0) {
                        // Пустое состояние
                        comp.empty();
                        return;
                    }

                    // Группируем по типу (фильмы/сериалы)
                    const movies = items.filter(i => i.media_type === 'movie' || !i.original_name);
                    const tv = items.filter(i => i.media_type === 'tv' || i.original_name);

                    const groups = [];
                    if (movies.length) groups.push({ title: 'Фильмы', items: movies });
                    if (tv.length) groups.push({ title: 'Сериалы', items: tv });

                    groups.forEach(group => {
                        const cards = group.items.slice(0, 20).map(item => {
                            const card = {
                                id: item.id || item.key,
                                title: item.title || item.original_title || item.original_name || 'Без названия',
                                original_title: item.original_title || '',
                                original_name: item.original_name || '',
                                poster_path: item.poster_path || '',
                                backdrop_path: item.backdrop_path || '',
                                overview: item.overview || '',
                                release_date: item.release_date || '',
                                vote_average: item.vote_average || 0,
                                vote_count: item.vote_count || 0,
                                source: item.source || 'tmdb',
                                media_type: item.media_type || (item.original_name ? 'tv' : 'movie')
                            };

                            // Добавляем параметры для карточки
                            card.params = {
                                emit: {
                                    onEnter: Lampa.Router.call.bind(Lampa.Router, 'full', card),
                                    onFocus: function() {
                                        try {
                                            Lampa.Background.change(Lampa.Utils.cardImgBackground(card));
                                        } catch(e) {}
                                    }
                                }
                            };

                            return card;
                        });

                        // Создаем строку с карточками
                        lines.push({
                            title: group.title + ' (' + group.items.length + ')',
                            results: cards,
                            total_pages: Math.ceil(group.items.length / 20),
                            params: {
                                module: Lampa.LineModule.toggle(Lampa.LineModule.MASK.base, 'Event'),
                                items: {
                                    view: 20
                                }
                            }
                        });
                    });

                    // Строим компонент
                    if (lines.length) {
                        comp.build(lines);
                    } else {
                        comp.empty();
                    }
                }
            });

            return comp;
        });

        log('Favorites component registered');
    }

    function getAllFavorites() {
        const favorites = getFavorites();
        favorites.sort((a, b) => (b.added || 0) - (a.added || 0));
        return favorites;
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
                    Lampa.Activity.push({
                        url: '',
                        title: '⭐ Избранное',
                        component: 'standalone_favorites',
                        source: 'tmdb',
                        page: 1
                    });
                });
                
                ml.append(el);
                log('Menu item added');
            } catch(e) {
                logError('Menu item error:', e);
                setTimeout(addMenuItem, 3000);
            }
        }, 2000);
    }

    // ============== КНОПКА В КАРТОЧКЕ ==============
    function addCardButton() {
        try {
            const container = $('.full-start-new__buttons, .full-start__buttons').first();
            if (!container.length) {
                setTimeout(addCardButton, 2000);
                return;
            }
            
            if ($('.card-fav-btn').length) return;
            
            const btn = $(
                '<div class="full-start__button selector card-fav-btn" style="display:flex;align-items:center;gap:8px;padding:8px 16px;cursor:pointer;border-radius:4px;">' +
                    '<svg viewBox="0 0 24 24" width="20" height="20" style="fill:currentColor;">' +
                        '<path d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.63L12,2L9.19,8.63L2,9.24L7.46,13.97L5.82,21L12,17.27Z"/>' +
                    '</svg>' +
                    '<span style="font-size:14px;">В избранное</span>' +
                '</div>'
            );
            
            btn.on('hover:enter', function(e) {
                e.stopPropagation();
                const content = getCurrentContent();
                if (content) {
                    const key = makeKey(content);
                    if (key) {
                        toggleFavorite(content, true);
                        const newFav = isFavorite(key);
                        $(this).find('span').text(newFav ? 'В избранном' : 'В избранное');
                        $(this).toggleClass('active', newFav);
                        $(this).attr('data-fav', newFav ? 'true' : 'false');
                        $(this).attr('data-key', key);
                    }
                }
            });
            
            container.append(btn);
            log('Card button added');
        } catch(e) {
            logError('Card button error:', e);
            setTimeout(addCardButton, 3000);
        }
    }

    // ============== КНОПКА В ПЛЕЕРЕ ==============
    function addPlayerButton() {
        try {
            const container = $('.player__tools, .player-controls').first();
            if (!container.length) {
                setTimeout(addPlayerButton, 3000);
                return;
            }
            
            if ($('.player-fav-btn').length) return;
            
            const btn = $(
                '<div class="player-fav-btn selector" style="display:inline-block;padding:8px;cursor:pointer;margin:0 4px;" title="В избранное">' +
                    '<svg viewBox="0 0 24 24" width="28" height="28" style="fill:currentColor;">' +
                        '<path d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.63L12,2L9.19,8.63L2,9.24L7.46,13.97L5.82,21L12,17.27Z"/>' +
                    '</svg>' +
                '</div>'
            );
            
            btn.on('hover:enter', function(e) {
                e.stopPropagation();
                const content = getCurrentContent();
                if (content) {
                    const key = makeKey(content);
                    if (key) {
                        toggleFavorite(content, true);
                        const newFav = isFavorite(key);
                        $(this).toggleClass('active', newFav);
                        $(this).attr('data-fav', newFav ? 'true' : 'false');
                        $(this).attr('data-key', key);
                    }
                }
            });
            
            container.append(btn);
            log('Player button added');
        } catch(e) {
            logError('Player button error:', e);
            setTimeout(addPlayerButton, 5000);
        }
    }

    // ============== НАСТРОЙКИ ==============
    function setupSettings() {
        try {
            if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addComponent === 'function') {
                Lampa.SettingsApi.addComponent({
                    component: 'standalone_favorites',
                    name: '⭐ Избранное',
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
                        Lampa.Activity.push({
                            url: '',
                            title: '⭐ Избранное',
                            component: 'standalone_favorites',
                            source: 'tmdb',
                            page: 1
                        });
                    }
                });
            }

            log('Settings initialized');
        } catch(e) {
            logError('Settings setup error:', e);
        }
    }

    // ============== СОБЫТИЯ ==============
    function initEventListeners() {
        try {
            if (Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
                Lampa.Listener.follow('full', function(e) {
                    if (e.type === 'open' || e.type === 'complite') {
                        setTimeout(function() {
                            const content = getCurrentContent();
                            if (content) {
                                const key = makeKey(content);
                                if (key) {
                                    const fav = isFavorite(key);
                                    $('.card-fav-btn, .player-fav-btn').each(function() {
                                        $(this).toggleClass('active', fav);
                                        $(this).attr('data-fav', fav ? 'true' : 'false');
                                        $(this).attr('data-key', key);
                                        if ($(this).find('span').length) {
                                            $(this).find('span').text(fav ? 'В избранном' : 'В избранное');
                                        }
                                    });
                                }
                            }
                        }, 500);
                    }
                });

                Lampa.Listener.follow('app', function(e) {
                    if (e.type === 'ready') {
                        log('App ready');
                        setTimeout(function() {
                            createFavoritesComponent();
                            addMenuItem();
                            addCardButton();
                            addPlayerButton();
                            setupSettings();
                        }, 3000);
                    }
                });
            }

            log('Event listeners initialized');
        } catch(e) {
            logError('Event listeners error:', e);
        }
    }

    // ============== ИНИЦИАЛИЗАЦИЯ ==============
    function init() {
        log('===== FAVORITES INIT =====');
        log('Favorites count:', getFavoriteCount());
        log('==========================');

        createFavoritesComponent();
        setupSettings();
        initEventListeners();

        if (window.appready) {
            log('App already ready');
            setTimeout(function() {
                addMenuItem();
                addCardButton();
                addPlayerButton();
            }, 3000);
        }
    }

    try {
        init();
    } catch(e) {
        console.error('[Favorites] Init error:', e);
        window.favorites_standalone_loaded = false;
    }

})();
