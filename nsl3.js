/**
 * Favorites Plus - ТОЛЬКО КНОПКА НА КАРТОЧКЕ (тестовая версия)
 */

(function() {
    if (typeof Lampa === 'undefined') {
        console.log('[FavPlus] Waiting for Lampa...');
        return;
    }

    // Простое хранилище
    const STORAGE_KEY = 'favplus_test_v1';
    
    function getFavorites() {
        return Lampa.Storage.get(STORAGE_KEY, []);
    }
    
    function saveFavorites(fav) {
        Lampa.Storage.set(STORAGE_KEY, fav, true);
    }
    
    function addToFavorites(card, category) {
        const favorites = getFavorites();
        const exists = favorites.some(f => f.id === card.id && f.category === category);
        
        if (!exists) {
            favorites.push({
                id: card.id,
                title: card.title || card.name,
                category: category,
                added: Date.now(),
                data: card
            });
            saveFavorites(favorites);
            Lampa.Noty.show(`✅ Добавлено в ${category}`);
            return true;
        }
        return false;
    }
    
    function removeFromFavorites(cardId, category) {
        let favorites = getFavorites();
        favorites = favorites.filter(f => !(f.id === cardId && f.category === category));
        saveFavorites(favorites);
        Lampa.Noty.show(`🗑️ Удалено`);
    }
    
    function isInFavorites(cardId, category) {
        return getFavorites().some(f => f.id === cardId && f.category === category);
    }

    // Функция добавления кнопки на карточку
    function addButtonToCard() {
        // Ищем контейнер с кнопками на карточке
        const $buttonsContainer = $('.full-start-new__buttons, .full-start__buttons, .info-card__buttons').first();
        
        if (!$buttonsContainer.length) {
            console.log('[FavPlus] Buttons container not found');
            return false;
        }
        
        // Проверяем, не добавлена ли уже кнопка
        if ($buttonsContainer.find('.favplus-test-btn').length) {
            return true;
        }
        
        // Получаем данные фильма
        const movie = Lampa.Activity.active()?.movie || Lampa.Activity.active()?.card;
        if (!movie || !movie.id) {
            console.log('[FavPlus] Movie not found');
            return false;
        }
        
        // Проверяем статусы
        const isFavorite = isInFavorites(movie.id, 'favorite');
        const isWatching = isInFavorites(movie.id, 'watching');
        const isPlanned = isInFavorites(movie.id, 'planned');
        
        // Создаём кнопку
        const $btn = $(`
            <div class="full-start__button selector favplus-test-btn" style="position:relative;">
                <div style="font-size:18px;">⭐</div>
                <span>Избранное+</span>
                <div style="position:absolute;top:-5px;right:-5px;background:#4CAF50;border-radius:10px;padding:0 5px;font-size:10px;display:${isFavorite || isWatching || isPlanned ? 'block' : 'none'};">✓</div>
            </div>
        `);
        
        // Обработчик клика
        $btn.on('hover:enter', () => {
            // Создаём меню с категориями
            const categories = [
                { id: 'favorite', name: '⭐ Избранное', checked: isInFavorites(movie.id, 'favorite') },
                { id: 'watching', name: '👁️ Смотрю', checked: isInFavorites(movie.id, 'watching') },
                { id: 'planned', name: '📋 Буду смотреть', checked: isInFavorites(movie.id, 'planned') },
                { id: 'abandoned', name: '❌ Брошено', checked: isInFavorites(movie.id, 'abandoned') },
                { id: 'collection', name: '📦 Коллекция', checked: isInFavorites(movie.id, 'collection') },
                { id: 'completed', name: '✅ Просмотрено', checked: isInFavorites(movie.id, 'completed') }
            ];
            
            // Формируем пункты меню
            const menuItems = categories.map(cat => ({
                title: cat.name,
                checkbox: true,
                checked: cat.checked,
                category: cat.id
            }));
            
            menuItems.push({ title: '──────────', separator: true });
            menuItems.push({ title: '❌ Закрыть', action: 'close' });
            
            Lampa.Select.show({
                title: movie.title || movie.name,
                items: menuItems,
                onSelect: (item) => {
                    if (item.action === 'close') return;
                    
                    if (item.checked) {
                        // Удаляем
                        removeFromFavorites(movie.id, item.category);
                    } else {
                        // Добавляем
                        addToFavorites(movie, item.category);
                    }
                    
                    // Обновляем индикатор на кнопке
                    const hasAny = categories.some(c => 
                        (c.id === item.category ? !item.checked : isInFavorites(movie.id, c.id))
                    );
                    $btn.find('div:last-child').css('display', hasAny ? 'block' : 'none');
                }
            });
        });
        
        // Вставляем кнопку
        $buttonsContainer.append($btn);
        console.log('[FavPlus] Button added successfully');
        return true;
    }

    // Следим за открытием карточки
    function watchForCard() {
        // Перехватываем Activity.push
        const originalPush = Lampa.Activity.push;
        Lampa.Activity.push = function(params) {
            const result = originalPush.call(this, params);
            if (params.component === 'full') {
                setTimeout(() => addButtonToCard(), 500);
                setTimeout(() => addButtonToCard(), 1000);
                setTimeout(() => addButtonToCard(), 2000);
            }
            return result;
        };
        
        // Следим за DOM
        const observer = new MutationObserver(() => {
            if ($('.full-start-new__buttons, .full-start__buttons').length) {
                addButtonToCard();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        
        // Если карточка уже открыта
        if (Lampa.Activity.active()?.component === 'full') {
            setTimeout(() => addButtonToCard(), 500);
        }
    }

    // Пункт в меню
    function addMenuItem() {
        if ($('.favplus-test-menu').length) return;
        
        const $menu = $('.menu__list').first();
        if (!$menu.length) return;
        
        const $item = $(`
            <li class="menu__item selector favplus-test-menu">
                <div class="menu__ico">⭐</div>
                <div class="menu__text">Избранное+ (тест)</div>
            </li>
        `);
        
        $item.on('hover:enter', () => {
            const favorites = getFavorites();
            const grouped = {};
            favorites.forEach(f => {
                if (!grouped[f.category]) grouped[f.category] = [];
                grouped[f.category].push(f);
            });
            
            const items = Object.entries(grouped).map(([cat, items]) => ({
                title: `${cat}: ${items.length}`,
                onSelect: () => {
                    const listItems = items.map(i => ({ title: i.title, item: i }));
                    Lampa.Select.show({
                        title: cat,
                        items: listItems,
                        onSelect: (selected) => {
                            if (selected.item?.data) {
                                Lampa.Activity.push({
                                    component: 'full',
                                    movie: selected.item.data,
                                    title: selected.item.title
                                });
                            }
                        }
                    });
                }
            }));
            
            items.push({ title: '──────────', separator: true });
            items.push({ title: `📊 Всего: ${favorites.length}`, action: 'stats' });
            items.push({ title: '🗑️ Очистить всё', action: 'clear' });
            
            Lampa.Select.show({
                title: '⭐ Избранное+ (тест)',
                items: items,
                onSelect: (item) => {
                    if (item.action === 'clear') {
                        saveFavorites([]);
                        Lampa.Noty.show('Очищено');
                    }
                }
            });
        });
        
        $menu.append($item);
    }

    // Запуск
    function init() {
        console.log('[FavPlus] Test version starting...');
        addMenuItem();
        watchForCard();
        console.log('[FavPlus] Ready!');
    }
    
    if (window.appready) init();
    else Lampa.Listener.follow('app', (e) => { if (e.type === 'ready') init(); });
})();
