(function() {
    'use strict';

    if (window.favorites_force_loaded) return;
    window.favorites_force_loaded = true;

    const DEBUG = true;

    function log() {
        if (DEBUG) {
            console.log.apply(console, ['[FavoritesForce]'].concat(Array.from(arguments)));
        }
    }

    function logError() {
        console.error.apply(console, ['[FavoritesForce] ERROR:'].concat(Array.from(arguments)));
    }

    // ============== ГЕНЕРАЦИЯ ID ==============
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

    // ============== РАБОТА С ИЗБРАННЫМ ==============
    function getFavorites() {
        try {
            return Lampa.Storage.get('favorites', {});
        } catch(e) {
            return {};
        }
    }

    function saveFavorites(data) {
        try {
            Lampa.Storage.set('favorites', data);
        } catch(e) {
            logError('Save error:', e);
        }
    }

    function isFavorite(id) {
        if (!id) return false;
        const favs = getFavorites();
        return !!favs[id];
    }

    function addToFavorites(item) {
        if (!item) return;
        const id = generateContentId(item);
        if (!id) return;

        const favs = getFavorites();
        favs[id] = {
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
            added: Date.now()
        };
        saveFavorites(favs);
        updateUI();
        Lampa.Noty.show('⭐ Добавлено в избранное');
    }

    function removeFromFavorites(id) {
        if (!id) return;
        const favs = getFavorites();
        delete favs[id];
        saveFavorites(favs);
        updateUI();
        Lampa.Noty.show('🗑️ Удалено из избранного');
    }

    function toggleFavorite(item) {
        if (!item) return;
        const id = generateContentId(item);
        if (!id) return;

        if (isFavorite(id)) {
            removeFromFavorites(id);
        } else {
            addToFavorites(item);
        }
    }

    // ============== ОБНОВЛЕНИЕ UI ==============
    function updateUI() {
        try {
            const activity = Lampa.Activity.active();
            const movie = activity?.movie;
            if (movie) {
                const id = generateContentId(movie);
                if (id) {
                    const isFav = isFavorite(id);
                    
                    // Обновляем все кнопки избранного
                    $('.button--book, .full-start__button.button--book, .fav-btn, .favorites-custom-btn').each(function() {
                        const path = $(this).find('path');
                        if (path.length) {
                            path.attr('fill', isFav ? 'currentColor' : 'transparent');
                        }
                        $(this).toggleClass('active', isFav);
                        $(this).attr('data-fav', isFav ? 'true' : 'false');
                        
                        // Обновляем текст
                        const span = $(this).find('span');
                        if (span.length) {
                            span.text(isFav ? 'В избранном' : 'В избранное');
                        }
                    });
                }
            }
        } catch(e) {
            logError('UI update error:', e);
        }
    }

    // ============== ФОРСИРОВАННОЕ ДОБАВЛЕНИЕ КНОПКИ ==============
    function injectFavoriteButton() {
        const activity = Lampa.Activity.active();
        if (!activity) return;
        
        const movie = activity.movie;
        if (!movie) return;

        // Проверяем наличие кнопки
        if ($('.favorites-custom-btn, .button--book').length > 0) {
            updateUI();
            return;
        }

        const id = generateContentId(movie);
        if (!id) return;

        const isFav = isFavorite(id);

        // Ищем контейнер для кнопок
        let container = $('.full-start__buttons, .full-start-new__buttons, .player__tools, .full-start__tools');
        if (!container.length) {
            // Если контейнера нет, создаем его
            const buttonsWrap = $('.full-start__buttons-wrap, .full-start-new__buttons-wrap, .full-start__actions');
            if (buttonsWrap.length) {
                container = buttonsWrap;
            } else {
                // Пробуем найти любой контейнер с кнопками
                container = $('.full-start__body, .full-start-new__body, .full-start__content');
                if (container.length) {
                    // Создаем контейнер для кнопок
                    const newContainer = $('<div class="full-start__buttons" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;"></div>');
                    container.append(newContainer);
                    container = newContainer;
                }
            }
        }

        if (!container.length) {
            log('Container not found');
            return;
        }

        // Создаем кнопку
        const btn = $(`
            <div class="full-start__button selector favorites-custom-btn" 
                 style="cursor:pointer;display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:6px;background:rgba(255,255,255,0.08);transition:all 0.2s;border:1px solid rgba(255,255,255,0.1);">
                <svg viewBox="0 0 24 24" width="22" height="22" style="fill:${isFav ? 'currentColor' : 'transparent'};stroke:currentColor;stroke-width:2;stroke-linejoin:round;">
                    <path d="M12 17.27L18.18 21L16.54 13.97L22 9.24L14.81 8.63L12 2L9.19 8.63L2 9.24L7.46 13.97L5.82 21L12 17.27Z"/>
                </svg>
                <span style="font-size:0.9em;font-weight:300;">${isFav ? 'В избранном' : 'В избранное'}</span>
            </div>
        `);

        // Обработчик клика
        btn.on('hover:enter', function(e) {
            e.stopPropagation();
            const currentMovie = Lampa.Activity.active()?.movie;
            if (currentMovie) {
                toggleFavorite(currentMovie);
                // Обновляем состояние кнопки
                const currentId = generateContentId(currentMovie);
                if (currentId) {
                    const fav = isFavorite(currentId);
                    $(this).find('path').attr('fill', fav ? 'currentColor' : 'transparent');
                    $(this).find('span').text(fav ? 'В избранном' : 'В избранное');
                    $(this).toggleClass('active', fav);
                }
            }
        });

        // Добавляем кнопку
        container.prepend(btn);
        log('Favorite button injected');
    }

    // ============== ДОБАВЛЕНИЕ КНОПКИ В МЕНЮ КАРТОЧКИ ==============
    function extendCardMenu() {
        try {
            // Перехватываем создание меню карточки
            const originalShow = Lampa.Select.show;
            Lampa.Select.show = function(config) {
                if (config.items && config.title === Lampa.Lang.translate('settings_input_links')) {
                    // Добавляем пункт избранного в меню
                    const activity = Lampa.Activity.active();
                    const movie = activity?.movie;
                    if (movie) {
                        const id = generateContentId(movie);
                        if (id) {
                            const isFav = isFavorite(id);
                            // Добавляем пункт в начало
                            config.items.unshift({
                                title: isFav ? '⭐ Удалить из избранного' : '⭐ Добавить в избранное',
                                action: 'toggle_favorite',
                                onSelect: function() {
                                    toggleFavorite(movie);
                                }
                            });
                        }
                    }
                }
                return originalShow.call(this, config);
            };
            log('Card menu extended');
        } catch(e) {
            logError('Menu extension error:', e);
        }
    }

    // ============== ДОБАВЛЕНИЕ КНОПКИ В ИНТЕРФЕЙС ==============
    function addFavoriteToCardInterface() {
        // Слушаем открытие карточки
        Lampa.Listener.follow('full', function(e) {
            if (e.type === 'open' || e.type === 'complite') {
                setTimeout(function() {
                    injectFavoriteButton();
                    updateUI();
                }, 300);
            }
        });

        // Слушаем изменение состояния избранного
        Lampa.Listener.follow('state:changed', function(e) {
            if (e.target === 'favorite' || e.target === 'favorites') {
                setTimeout(function() {
                    updateUI();
                }, 200);
            }
        });

        // Периодическая проверка для надежности (каждые 3 секунды)
        let checkCount = 0;
        const checkInterval = setInterval(function() {
            const activity = Lampa.Activity.active();
            if (activity && activity.component === 'full') {
                if ($('.favorites-custom-btn').length === 0 && $('.button--book').length === 0) {
                    injectFavoriteButton();
                } else {
                    updateUI();
                }
                checkCount = 0;
            } else {
                checkCount++;
                if (checkCount > 10) {
                    // Если долго нет карточки, сбрасываем счетчик
                    checkCount = 0;
                }
            }
        }, 3000);

        log('Card interface hooks added');
    }

    // ============== ПУНКТ МЕНЮ ИЗБРАННОГО ==============
    function addFavoritesMenuItem() {
        setTimeout(function() {
            try {
                const ml = $('.menu__list').eq(0);
                if (!ml.length) {
                    setTimeout(addFavoritesMenuItem, 2000);
                    return;
                }
                
                if ($('.favorites-menu-item').length) return;
                
                const el = $(
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

    // ============== СПИСОК ИЗБРАННОГО ==============
    function showFavoritesList() {
        const favs = getFavorites();
        const items = Object.values(favs);
        
        if (items.length === 0) {
            Lampa.Noty.show('⭐ Избранное пусто');
            return;
        }
        
        items.sort((a, b) => (b.added || 0) - (a.added || 0));
        
        const menuItems = items.map(function(item) {
            const title = item.title || 'Без названия';
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
            title: '⭐ Избранное (' + items.length + ')',
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
                                saveFavorites({});
                                updateUI();
                                Lampa.Noty.show('🗑️ Избранное очищено');
                            }
                            showFavoritesList();
                        }
                    });
                } else if (item.action && item.action.startsWith('open_')) {
                    const data = item.data;
                    if (data) {
                        Lampa.Activity.push({
                            url: '',
                            title: data.title || 'Без названия',
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

    // ============== ИНИЦИАЛИЗАЦИЯ ==============
    function init() {
        log('Initializing...');
        
        // Расширяем меню карточки
        extendCardMenu();
        
        // Добавляем кнопку в интерфейс
        addFavoriteToCardInterface();
        
        // Добавляем пункт меню
        addFavoritesMenuItem();
        
        // Обновляем UI при старте
        setTimeout(function() {
            updateUI();
        }, 1000);
        
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
