(function() {
    'use strict';

    // ============== ЗАЩИТА ОТ ПОВТОРНОЙ ЗАГРУЗКИ ==============
    if (window.favorites_standalone_loaded) {
        console.log('[Favorites] Already loaded');
        return;
    }
    window.favorites_standalone_loaded = true;

    // ============== КОНСТАНТЫ ==============
    const STORAGE_KEY = 'standalone_favorites';

    // ============== ЛОГГИРОВАНИЕ ==============
    function log() {
        console.log.apply(console, ['[Favorites]'].concat(Array.from(arguments)));
    }

    function logError() {
        console.error.apply(console, ['[Favorites] ERROR:'].concat(Array.from(arguments)));
    }

    // ============== ПРОВЕРКА НАЛИЧИЯ LAMPA ==============
    if (typeof Lampa === 'undefined') {
        console.error('[Favorites] Lampa not found');
        window.favorites_standalone_loaded = false;
        return;
    }

    // ============== РАБОТА С ХРАНИЛИЩЕМ ==============
    function getFavorites() {
        try {
            const data = Lampa.Storage.get(STORAGE_KEY, []);
            if (Array.isArray(data)) {
                return data;
            }
            return [];
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
            // Для фильмов
            if (item.original_title) {
                return 'movie_' + Lampa.Utils.hash(item.original_title);
            }
            // Для сериалов
            if (item.original_name) {
                const season = item.season || 1;
                const episode = item.episode || 1;
                return 'tv_' + Lampa.Utils.hash(String(season) + ':' + String(episode) + item.original_name);
            }
            // Для актеров/персон
            if (item.id && item.known_for_department) {
                return 'person_' + String(item.id);
            }
            // Если есть ID
            if (item.id) {
                return (item.media_type || 'unknown') + '_' + String(item.id);
            }
        } catch(e) {
            logError('Hash generation error:', e);
        }
        return null;
    }

    // ============== ПОЛУЧЕНИЕ ТЕКУЩЕГО КОНТЕНТА (как в ybt.js) ==============
    function getCurrentContent() {
        try {
            const act = Lampa.Activity.active();
            if (!act) {
                log('No active activity');
                return null;
            }
            
            log('Activity:', act.component, act.url || act.title || '');
            
            // Для актеров/персон
            if (act.component === 'actor' || act.component === 'person') {
                return {
                    id: act.id,
                    title: act.title || act.name || 'Персона',
                    original_title: act.title || act.name || '',
                    media_type: 'person',
                    known_for_department: act.job || 'actor',
                    source: act.source || 'tmdb'
                };
            }
            
            // Для фильмов/сериалов
            const movie = act.movie || act.card;
            if (movie) {
                const item = JSON.parse(JSON.stringify(movie));
                if (item.original_name) {
                    item.season = act.season || 1;
                    item.episode = act.episode || 1;
                }
                return item;
            }
            
            // Если есть url - пробуем извлечь из него
            if (act.url && act.url.indexOf('?') !== -1) {
                // Для discover и других параметризованных url
                return {
                    id: act.id || Lampa.Utils.hash(act.url),
                    title: act.title || act.name || 'Закладка',
                    original_title: act.title || act.name || '',
                    media_type: 'unknown',
                    url: act.url,
                    source: act.source || 'tmdb'
                };
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
            log('Removed from favorites:', key);
        } else {
            const now = Date.now();
            const newItem = {
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
            };
            
            favorites.push(newItem);
            saveFavorites(favorites);
            updateUI(key, true);
            if (showNotify) Lampa.Noty.show('⭐ Добавлено в избранное');
            log('Added to favorites:', key);
        }
        
        return !exists;
    }

    function isFavorite(key) {
        if (!key) return false;
        const favorites = getFavorites();
        return favorites.some(f => f.key === key);
    }

    function getAllFavorites() {
        const favorites = getFavorites();
        favorites.sort(function(a, b) {
            return (b.added || 0) - (a.added || 0);
        });
        return favorites;
    }

    function getFavoriteCount() {
        return getFavorites().length;
    }

    function clearAllFavorites(showNotify) {
        if (showNotify === undefined) showNotify = true;
        saveFavorites([]);
        updateUI(null, false, true);
        if (showNotify) Lampa.Noty.show('🗑️ Всё избранное очищено');
        updateMenuCounter();
    }

    // ============== ОБНОВЛЕНИЕ UI ==============
    function updateUI(key, isFav, forceAll) {
        try {
            if (forceAll) {
                $('.fav-btn, .favorite-btn, .card-fav-btn, .player-fav-btn').each(function() {
                    const btnKey = $(this).attr('data-key');
                    if (btnKey) {
                        const fav = isFavorite(btnKey);
                        $(this).toggleClass('active', fav);
                        $(this).attr('data-fav', fav ? 'true' : 'false');
                        if ($(this).find('span').length) {
                            $(this).find('span').text(fav ? 'В избранном' : 'В избранное');
                        }
                    }
                });
                updateMenuCounter();
                return;
            }
            
            if (!key) return;
            
            $('.fav-btn[data-key="' + key + '"], .favorite-btn[data-key="' + key + '"], .card-fav-btn[data-key="' + key + '"], .player-fav-btn[data-key="' + key + '"]').each(function() {
                $(this).toggleClass('active', isFav);
                $(this).attr('data-fav', isFav ? 'true' : 'false');
                if ($(this).find('span').length) {
                    $(this).find('span').text(isFav ? 'В избранном' : 'В избранное');
                }
            });
            
            updateMenuCounter();
            
            if (Lampa.Listener && typeof Lampa.Listener.send === 'function') {
                Lampa.Listener.send('favorites:update', {
                    type: 'update',
                    data: { key: key, isFav: isFav }
                });
            }
        } catch(e) {
            logError('UI update error:', e);
        }
    }

    function updateMenuCounter() {
        try {
            const count = getFavoriteCount();
            $('.favorites-menu-item .menu__text').text('⭐ Избранное (' + count + ')');
        } catch(e) {
            logError('Update menu counter error:', e);
        }
    }

    // ============== ПОКАЗ СПИСКА ==============
    function showFavoritesList() {
        try {
            const items = getAllFavorites();
            const count = items.length;
            
            if (count === 0) {
                Lampa.Noty.show('⭐ Избранное пусто');
                return;
            }
            
            const menuItems = items.map(function(item, index) {
                const title = item.title || item.original_title || item.original_name || 'Без названия';
                const date = item.added ? new Date(item.added).toLocaleDateString() : '';
                return {
                    title: (index + 1) + '. ' + title + (date ? ' (' + date + ')' : ''),
                    action: 'open_' + item.key,
                    data: item
                };
            });
            
            menuItems.push({ title: '──────────', separator: true });
            menuItems.push({ title: '🗑️ Очистить всё (' + count + ')', action: 'clear_all' });
            menuItems.push({ title: '❌ Закрыть', action: 'cancel' });
            
            Lampa.Select.show({
                title: '⭐ Избранное (' + count + ')',
                items: menuItems,
                onSelect: function(item) {
                    if (item.action === 'clear_all') {
                        Lampa.Select.show({
                            title: '⚠️ Очистить всё избранное?',
                            items: [
                                { title: '✅ Да', action: 'confirm' },
                                { title: '❌ Нет', action: 'cancel' }
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
                            Lampa.Activity.push({
                                url: '',
                                title: data.title || data.original_title || data.original_name || 'Без названия',
                                component: 'category_full',
                                source: data.source || 'tmdb',
                                page: 1,
                                movie: data
                            });
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

    // ============== КНОПКА В ПЛЕЕРЕ ==============
    function addPlayerButton() {
        try {
            const container = $('.player__tools, .player-controls, .player__actions').first();
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
                log('Player favorite button clicked');
                
                const content = getCurrentContent();
                log('Content:', content);
                
                if (content) {
                    const key = makeKey(content);
                    log('Key:', key);
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

    // ============== КНОПКА В КАРТОЧКЕ ==============
    function addCardButton() {
        try {
            const container = $('.full-start-new__buttons, .full-start__buttons, .card__actions, .card__buttons').first();
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
                log('Card favorite button clicked');
                
                const content = getCurrentContent();
                log('Content:', content);
                
                if (content) {
                    const key = makeKey(content);
                    log('Key:', key);
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

    // ============== ПУНКТ МЕНЮ ==============
    function addMenuItem() {
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
                log('Menu item clicked');
                showFavoritesList();
            });
            
            ml.append(el);
            log('Menu item added');
        } catch(e) {
            logError('Menu item error:', e);
            setTimeout(addMenuItem, 3000);
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
                            addMenuItem();
                            addCardButton();
                            addPlayerButton();
                        }, 3000);
                    }
                });
            }

            if (Lampa.Storage && Lampa.Storage.listener) {
                Lampa.Storage.listener.follow('change', function(e) {
                    if (e.name === 'activity') {
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
                        }, 300);
                    }
                });
            }

            log('Event listeners initialized');
        } catch(e) {
            logError('Event listeners error:', e);
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
                        showFavoritesList();
                    }
                });
            }

            log('Settings initialized');
        } catch(e) {
            logError('Settings setup error:', e);
        }
    }

    // ============== ИНИЦИАЛИЗАЦИЯ ==============
    function init() {
        log('===== FAVORITES INIT =====');
        log('Favorites count:', getFavoriteCount());
        log('==========================');

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

    // ============== ЗАПУСК ==============
    try {
        init();
    } catch(e) {
        console.error('[Favorites] Init error:', e);
        window.favorites_standalone_loaded = false;
    }

})();
